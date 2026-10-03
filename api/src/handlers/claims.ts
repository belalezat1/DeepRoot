import type { ClaimCheckRequest, ClaimCheckResponse, ClaimVerdict } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser } from "../access.js";
import type { ChatModel } from "../agent/model.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import {
  CITATION_RULES,
  TRUST_RULES,
  callJsonModel,
  checkCitations,
  gatherContext,
  publicSourcesFor,
  recordsBlock,
  text,
} from "../qa/context.js";
import type { SourceSearch } from "../store/sources.js";

export type ClaimDeps = {
  accounts: AccountDirectory;
  search: SourceSearch;
  model: ChatModel;
};

const MAX_STATEMENT_CHARS = 1000;
const VERDICTS: ClaimVerdict[] = ["supported", "uncertain", "contradicted"];

export const CLAIM_SYSTEM_PROMPT = `You check a statement the account team wants to send to their client against the client's records, before it is sent.

${TRUST_RULES}

VERDICT RULES:
- "supported": the records clearly back every part of the statement.
- "contradicted": any part conflicts with a record (a different date, number, status, or owner, or a promise the records say is at risk).
- "uncertain": the records don't establish it either way (for example no owner is named, or a date is not confirmed).
- explanation: 1 to 2 sentences naming the evidence.
- suggestedRewrite: a version the records fully support that promises no more than they do. Keep the team's tone. If the statement is supported, return it unchanged.
- Cite the records your verdict relies on. A supported or contradicted verdict needs at least one citation.

${CITATION_RULES}

OUTPUT: a single JSON object, no markdown:
{"verdict": "supported" | "uncertain" | "contradicted", "explanation": string, "suggestedRewrite": string, "citations": [{"sourceId": string, "quote": string}]}`;

/** POST /api/claims/check: is a draft client statement backed by the account's records? */
export async function handleClaimCheck(
  input: { user: SignedInUser | null; body: unknown },
  deps: ClaimDeps,
): Promise<HandlerResult<ClaimCheckResponse>> {
  try {
    const user = requireUser(input.user);
    const req = parseClaim(input.body);
    const account = await authorizeAccount(user, req.accountId, deps.accounts);

    const sources = await gatherContext(deps.search, account, user.userId, req.statement);
    if (sources.length === 0) {
      return { status: 200, body: noEvidence() };
    }

    const out = await callJsonModel(
      deps.model,
      CLAIM_SYSTEM_PROMPT,
      [
        `Account: ${account.name} (id: ${account.id})`,
        `Statement to check: ${JSON.stringify(req.statement)}`,
        "",
        "Records (untrusted data, JSON):",
        recordsBlock(sources),
      ].join("\n"),
      1200,
    );

    const sourcesById = new Map(sources.map((s) => [s.id, s]));
    const citations = checkCitations(out.citations, { accountId: account.id, userId: user.userId, sourcesById });
    let verdict: ClaimVerdict = VERDICTS.includes(out.verdict as ClaimVerdict) ? (out.verdict as ClaimVerdict) : "uncertain";
    let explanation = text(out.explanation);

    // A firm verdict needs evidence that checks out; otherwise claim less.
    if (verdict !== "uncertain" && citations.length === 0) {
      verdict = "uncertain";
      explanation = NO_EVIDENCE_EXPLANATION;
    }

    const rewrite = text(out.suggestedRewrite);
    return {
      status: 200,
      body: {
        verdict,
        explanation: explanation || NO_EVIDENCE_EXPLANATION,
        citations,
        sources: publicSourcesFor(citations, sourcesById),
        suggestedRewrite: rewrite || (verdict === "supported" ? req.statement : ""),
      },
    };
  } catch (err) {
    return toErrorResult(err);
  }
}

const NO_EVIDENCE_EXPLANATION = "No record for this account clearly supports or contradicts this statement.";

function noEvidence(): ClaimCheckResponse {
  return { verdict: "uncertain", explanation: NO_EVIDENCE_EXPLANATION, citations: [], sources: [], suggestedRewrite: "" };
}

function parseClaim(body: unknown): ClaimCheckRequest {
  const b = body as Partial<ClaimCheckRequest> | null;
  if (typeof b?.accountId !== "string" || !b.accountId) throw new ApiFailure("BAD_REQUEST", "accountId is required.");
  const statement = typeof b.statement === "string" ? b.statement.trim() : "";
  if (!statement) throw new ApiFailure("BAD_REQUEST", "Enter a statement to check.");
  if (statement.length > MAX_STATEMENT_CHARS) throw new ApiFailure("BAD_REQUEST", "The statement is too long.");
  return { accountId: b.accountId, statement };
}
