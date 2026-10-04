import type { ChatMessage, ChatRequest, ChatResponse } from "@deeproot/shared";
import { ASSISTANT_ROLE_RULES, assistantBoundary, assistantRefusalMessage } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser, notFound } from "../access.js";
import type { ChatModel } from "../agent/model.js";
import { investigate, verifyCandidates } from "../qa/investigate.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { reportContext } from "../qa/reportContext.js";
import {
  CITATION_RULES,
  TRUST_RULES,
  checkCitations,
  publicSourcesFor,
  text,
} from "../qa/context.js";
import type { ReportStore } from "../store/reports.js";
import type { SourceSearch } from "../store/sources.js";

export type ChatDeps = {
  accounts: AccountDirectory;
  search: SourceSearch;
  reports: ReportStore;
  model: ChatModel;
};

const MAX_QUESTION_CHARS = 500;

export const CHAT_SYSTEM_PROMPT = `You answer questions about one client account for its account team, using only the records provided.

${TRUST_RULES}
${ASSISTANT_ROLE_RULES}

ANSWER RULES:
- Answer in 1 to 3 sentences using only facts the records state. Back every fact with a citation.
- If the records do not answer the question, or it asks about another customer or anything outside these records, set grounded to false and say briefly that the records don't cover it. Do not guess.
- Never state an owner, date, or number that the records don't state.

${CITATION_RULES}

OUTPUT: a single JSON object, no markdown:
{"answer": string, "grounded": boolean, "responseType": "answer" | "not_found" | "out_of_scope" | "restricted", "citations": [{"sourceId": string, "quote": string}]}
For a refusal set grounded to false, use the appropriate responseType and leave citations empty.`;

/** What the user sees when the answer can't be backed by evidence. Names nothing outside the account. */
export function notInRecords(accountName: string): string {
  return `I couldn't find an answer to that in ${accountName}'s records.`;
}

/** POST /api/chat: a cited answer from the account's permitted sources, or an honest "not found". */
export async function handleChat(
  input: { user: SignedInUser | null; body: unknown },
  deps: ChatDeps,
): Promise<HandlerResult<ChatResponse>> {
  try {
    const user = requireUser(input.user);
    const req = parseChat(input.body);
    const account = await authorizeAccount(user, req.accountId, deps.accounts);

    if (req.reportId) { const report = await deps.reports.get(req.reportId); if (!report || report.accountId !== account.id) throw notFound(); }
    const boundary = assistantBoundary(req.question);
    if (boundary) return { status: 200, body: refusal(boundary) };
    const investigation = await investigate({ question: req.question, mode: "ask", history: req.history,
      extra: () => reportContext(deps.reports, account, req.reportId, user.userId, deps.search),
    }, { ...deps, account, userId: user.userId, system: CHAT_SYSTEM_PROMPT });
    if (investigation.boundary) return { status: 200, body: refusal(investigation.boundary) };
    const { sources, draft: out, steps, signal } = investigation;
    const ungrounded: ChatResponse = { answer: notInRecords(account.name), citations: [], sources: [], grounded: false, responseType: "not_found", steps };
    if (out.responseType === "restricted" || out.responseType === "out_of_scope") return { status: 200, body: refusal(out.responseType) };
    const byId = new Map(sources.map(s => [s.id, s]));
    const facts = Array.isArray(out.facts) ? out.facts : [{ text: out.answer, citations: out.citations }];
    if (out.grounded !== true || facts.length === 0 || facts.length > 8 || facts.some(f => !f || typeof f !== "object")) return { status: 200, body: ungrounded };
    const candidates = facts.map((f: { text?: unknown; citations?: unknown }, i: number) => ({ id: String(i), text: text(f.text), citations: checkCitations(f.citations, { accountId: account.id, userId: user.userId, sourcesById: byId }) }));
    const boundaryOutput = assistantBoundary(candidates.map(c => c.text).join(" "));
    if (boundaryOutput) return { status: 200, body: refusal(boundaryOutput) };
    if (candidates.some(c => !c.text || !c.citations.length)) return { status: 200, body: ungrounded };
    const checked = await verifyCandidates(deps.model, candidates, sources, account, user.userId, signal);
    steps.push({ action: "verify", label: "Checked every answer statement against its cited evidence", sourceCount: checked.size });
    if (candidates.some(c => checked.get(c.id)?.verdict !== "supported")) return { status: 200, body: ungrounded };
    const citations = checkCitations([...checked.values()].flatMap(v => v.citations), { accountId: account.id, userId: user.userId, sourcesById: byId });
    return { status: 200, body: { answer: candidates.map(c => c.text).join(" "), citations, sources: publicSourcesFor(citations, byId), grounded: true, responseType: "answer", steps } };
  } catch (err) {
    return toErrorResult(err);
  }
}

function refusal(reason: "restricted" | "out_of_scope"): ChatResponse {
  return { answer: assistantRefusalMessage(reason), grounded: false, responseType: reason, citations: [], sources: [] };
}

function parseChat(body: unknown): ChatRequest {
  const b = body as Partial<ChatRequest> | null;
  if (typeof b?.accountId !== "string" || !b.accountId) throw new ApiFailure("BAD_REQUEST", "accountId is required.");
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question) throw new ApiFailure("BAD_REQUEST", "Ask a question.");
  if (question.length > MAX_QUESTION_CHARS) throw new ApiFailure("BAD_REQUEST", "The question is too long.");
  if (b.reportId !== undefined && (typeof b.reportId !== "string" || !b.reportId)) {
    throw new ApiFailure("BAD_REQUEST", "reportId must be text.");
  }
  const history: ChatMessage[] = [];
  if (b.history !== undefined) {
    if (!Array.isArray(b.history) || b.history.length > 10) throw new ApiFailure("BAD_REQUEST", "history must contain at most 10 messages.");
    for (const item of b.history) {
      if (!item || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 2000) {
        throw new ApiFailure("BAD_REQUEST", "history messages must have a user or assistant role and 1–2000 characters of text.");
      }
      if (assistantBoundary(item.content) !== "restricted") history.push({ role: item.role, content: item.content.trim() });
    }
  }
  return { accountId: b.accountId, question, ...(b.reportId ? { reportId: b.reportId } : {}), ...(history.length ? { history } : {}) };
}
