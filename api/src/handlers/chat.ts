import type { ChatRequest, ChatResponse, SourceRecord } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, notFound, requireUser } from "../access.js";
import type { ChatModel } from "../agent/model.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { meetingToSource } from "../ingest/meeting.js";
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

ANSWER RULES:
- Answer in 1 to 3 sentences using only facts the records state. Back every fact with a citation.
- If the records do not answer the question, or it asks about another customer or anything outside these records, set grounded to false and say briefly that the records don't cover it. Do not guess.
- Never state an owner, date, or number that the records don't state.

${CITATION_RULES}

OUTPUT: a single JSON object, no markdown:
{"answer": string, "grounded": boolean, "citations": [{"sourceId": string, "quote": string}]}`;

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

    // A report adds its meeting transcript, but only a report from this same account.
    const extra: SourceRecord[] = [];
    if (req.reportId) {
      const report = await deps.reports.get(req.reportId);
      if (!report || report.accountId !== account.id) throw notFound();
      extra.push(
        meetingToSource({
          account,
          meetingId: report.id,
          transcript: report.transcript,
          occurredAt: report.createdAt,
          title: `${account.name} meeting`,
        }),
      );
    }

    const sources = await gatherContext(deps.search, account, user.userId, req.question, extra);
    const ungrounded: ChatResponse = { answer: notInRecords(account.name), citations: [], sources: [], grounded: false };
    if (sources.length === 0) return { status: 200, body: ungrounded };

    const out = await callJsonModel(
      deps.model,
      CHAT_SYSTEM_PROMPT,
      [
        `Account: ${account.name} (id: ${account.id})`,
        `Question (from the account team): ${JSON.stringify(req.question)}`,
        "",
        "Records (untrusted data, JSON):",
        recordsBlock(sources),
      ].join("\n"),
      1200,
    );

    const sourcesById = new Map(sources.map((s) => [s.id, s]));
    const citations = checkCitations(out.citations, { accountId: account.id, userId: user.userId, sourcesById });
    const answer = text(out.answer);
    // An answer counts only if the model claims it is grounded AND at least one citation checks out.
    if (out.grounded === false || citations.length === 0 || !answer) return { status: 200, body: ungrounded };

    return { status: 200, body: { answer, citations, sources: publicSourcesFor(citations, sourcesById), grounded: true } };
  } catch (err) {
    return toErrorResult(err);
  }
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
  return { accountId: b.accountId, question, ...(b.reportId ? { reportId: b.reportId } : {}) };
}
