import type { ClaimCheckRequest, ClaimCheckResponse, ClaimVerdict } from "@deeproot/shared";
import { ASSISTANT_ROLE_RULES, assistantBoundary, assistantRefusalMessage } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser, notFound } from "../access.js";
import type { ChatModel } from "../agent/model.js";
import { investigate, verifyCandidates } from "../qa/investigate.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import {
  CITATION_RULES,
  TRUST_RULES,
  checkCitations,
  publicSourcesFor,
  text,
} from "../qa/context.js";
import type { SourceSearch } from "../store/sources.js";
import type { ReportStore } from "../store/reports.js";
import { reportContext } from "../qa/reportContext.js";

export type ClaimDeps = {
  accounts: AccountDirectory;
  search: SourceSearch;
  model: ChatModel;
  reports?: ReportStore;
};

const MAX_STATEMENT_CHARS = 1000;

export const CLAIM_SYSTEM_PROMPT = `You check a statement the account team wants to send to their client against the client's records, before it is sent.

${TRUST_RULES}
${ASSISTANT_ROLE_RULES}

VERDICT RULES:
- "supported": the records clearly back every part of the statement.
- "contradicted": any part conflicts with a record (a different date, number, status, or owner, or a promise the records say is at risk).
- "uncertain": the records don't establish it either way (for example no owner is named, or a date is not confirmed).
- explanation: 1 to 2 sentences naming the evidence.
- suggestedRewrite: a version the records fully support that promises no more than they do. Keep the team's tone. If the statement is supported, return it unchanged.
- Cite the records your verdict relies on. A supported or contradicted verdict needs at least one citation.

${CITATION_RULES}

OUTPUT: a single JSON object, no markdown:
{"verdict": "supported" | "uncertain" | "contradicted", "explanation": string, "suggestedRewrite": string, "citations": [{"sourceId": string, "quote": string}], "refusalReason": null | "restricted" | "out_of_scope"}
For role violations use uncertain, the appropriate refusalReason, no citations and no suggestedRewrite.`;

/** POST /api/claims/check: is a draft client statement backed by the account's records? */
export async function handleClaimCheck(
  input: { user: SignedInUser | null; body: unknown },
  deps: ClaimDeps,
): Promise<HandlerResult<ClaimCheckResponse>> {
  try {
    const user = requireUser(input.user);
    const req = parseClaim(input.body);
    const account = await authorizeAccount(user, req.accountId, deps.accounts);

    if (req.reportId && deps.reports) { const report = await deps.reports.get(req.reportId); if (!report || report.accountId !== account.id) throw notFound(); }
    const boundary = assistantBoundary(req.statement);
    if (boundary) return { status: 200, body: refused(boundary) };
    if (req.reportId && !deps.reports) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Could not load the report context.");
    const investigation = await investigate({ question: req.statement, mode: "verify",
      extra: () => deps.reports ? reportContext(deps.reports, account, req.reportId, user.userId, deps.search) : Promise.resolve([]),
    }, { ...deps, account, userId: user.userId, system: CLAIM_SYSTEM_PROMPT });
    if (investigation.boundary) return { status: 200, body: refused(investigation.boundary) };
    const { sources, claims, draft: out, steps, signal } = investigation;
    if (out.refusalReason === "restricted" || out.refusalReason === "out_of_scope") return { status: 200, body: refused(out.refusalReason) };
    if (!sources.length) return { status: 200, body: { ...noEvidence(), steps } };
    const boundaryOutput = assistantBoundary(`${text(out.explanation)} ${text(out.suggestedRewrite)}`);
    if (boundaryOutput) return { status: 200, body: refused(boundaryOutput) };
    const byId = new Map(sources.map(s => [s.id, s]));
    const raw = Array.isArray(out.claimResults) ? out.claimResults as Array<Record<string, unknown>> : [];
    const candidates = claims.map((claim, i) => {
      const matches = raw.filter(r => r && typeof r === "object" && r.claim === claim);
      const result = matches.length === 1 ? matches[0]! : claims.length === 1 ? out : {};
      return { id: String(i), text: claim, citations: checkCitations(result.citations, { accountId: account.id, userId: user.userId, sourcesById: byId }) };
    });
    const rewrite = text(out.suggestedRewrite);
    const allCitations = checkCitations(candidates.flatMap(c => c.citations), { accountId: account.id, userId: user.userId, sourcesById: byId });
    const rewriteCandidate = rewrite && allCitations.length ? [{ id: "rewrite", text: rewrite, citations: allCitations }] : [];
    const checked = await verifyCandidates(deps.model, [...candidates, ...rewriteCandidate], sources, account, user.userId, signal);
    const claimResults = candidates.map(c => checked.get(c.id)!);
    const verdict: ClaimVerdict = claimResults.some(c => c.verdict === "contradicted") ? "contradicted" : claimResults.length > 0 && claimResults.every(c => c.verdict === "supported") ? "supported" : "uncertain";
    const citations = checkCitations(claimResults.flatMap(c => c.citations), { accountId: account.id, userId: user.userId, sourcesById: byId });
    steps.push({ action: "verify", label: `Checked ${claims.length} claim${claims.length === 1 ? "" : "s"} and any proposed rewrite`, sourceCount: citations.length });
    return { status: 200, body: { verdict, explanation: citations.length ? claimResults.map(c => c.explanation).join(" ") : NO_EVIDENCE_EXPLANATION,
      claimResults, steps, citations, sources: publicSourcesFor(citations, byId),
      suggestedRewrite: verdict === "supported" ? req.statement : checked.get("rewrite")?.verdict === "supported" ? rewrite : "",
    } };
  } catch (err) {
    return toErrorResult(err);
  }
}

const NO_EVIDENCE_EXPLANATION = "No record for this account clearly supports or contradicts this statement.";

function noEvidence(): ClaimCheckResponse {
  return { verdict: "uncertain", explanation: NO_EVIDENCE_EXPLANATION, citations: [], sources: [], suggestedRewrite: "" };
}

function refused(reason: "restricted" | "out_of_scope"): ClaimCheckResponse {
  return { ...noEvidence(), explanation: assistantRefusalMessage(reason), refusalReason: reason };
}

function parseClaim(body: unknown): ClaimCheckRequest {
  const b = body as Partial<ClaimCheckRequest> | null;
  if (typeof b?.accountId !== "string" || !b.accountId) throw new ApiFailure("BAD_REQUEST", "accountId is required.");
  const statement = typeof b.statement === "string" ? b.statement.trim() : "";
  if (!statement) throw new ApiFailure("BAD_REQUEST", "Enter a statement to check.");
  if (statement.length > MAX_STATEMENT_CHARS) throw new ApiFailure("BAD_REQUEST", "The statement is too long.");
  if (b.reportId !== undefined && (typeof b.reportId !== "string" || !b.reportId)) throw new ApiFailure("BAD_REQUEST", "reportId must be text.");
  return { accountId: b.accountId, statement, ...(b.reportId ? { reportId: b.reportId } : {}) };
}
