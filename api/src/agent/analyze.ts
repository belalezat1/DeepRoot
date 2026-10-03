import type { Account, AgentAnalysis, SourceRecord } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser } from "../access.js";
import { ApiFailure } from "../errors.js";
import type { SourceSearch } from "../store/sources.js";
import { groundFindings, parseModelOutput, type ModelOutput } from "./findings.js";
import type { ChatModel } from "./model.js";
import { RETRY_NOTE, SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export const MAX_CONTEXT_SOURCES = 25;
const MAX_OUTPUT_TOKENS = 4000;

export type AnalyzeDeps = {
  accounts: AccountDirectory;
  search: SourceSearch;
  model: ChatModel;
  now?: () => Date;
};

export type AnalyzeInput = {
  user: SignedInUser | null;
  accountId: string;
  focus?: string;
  /**
   * Authorized sources not yet in Search, such as a just-reviewed meeting transcript. They pass
   * through the same isolation check as retrieved sources.
   */
  extraSources?: SourceRecord[];
};

/**
 * A source from another account, or one this user may not see, reached the model's context.
 * That means an upstream filter failed, so the request stops before the model call and fails as
 * a server error (500) rather than being quietly filtered.
 */
export class ContextIsolationError extends Error {
  constructor(readonly accountId: string, readonly offendingSourceIds: string[]) {
    super(`Refusing to analyze ${accountId}: context contains sources outside the account or user's access (${offendingSourceIds.join(", ")})`);
    this.name = "ContextIsolationError";
  }
}

export function assertContextIsolated(sources: SourceRecord[], account: Account, userId: string): void {
  const offending = sources.filter((s) => s.accountId !== account.id || !s.allowedUserIds.includes(userId));
  if (offending.length > 0) throw new ContextIsolationError(account.id, offending.map((s) => s.id));
}

async function callModel(model: ChatModel, system: string, user: string): Promise<string> {
  try {
    return await model.complete({ system, user, maxTokens: MAX_OUTPUT_TOKENS });
  } catch (err) {
    console.error("Azure model call failed", err);
    throw new ApiFailure("INTEGRATION_UNAVAILABLE", "The analysis model is unavailable right now. Please try again.");
  }
}

/**
 * Authorized sources -> Azure model -> grounded findings.
 * 1. Authenticate and authorize the account (before any retrieval).
 * 2. Retrieve with account and user filters, add any extra sources, and verify isolation.
 * 3. Ask the model once (one retry if the reply is not valid JSON).
 * 4. Keep only findings whose citations check out against the exact sources the model saw.
 * The model gets no tools: it cannot request more data, so it cannot get around these checks.
 */
export async function analyzeAccount(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AgentAnalysis> {
  const user = requireUser(input.user);
  const account = await authorizeAccount(user, input.accountId, deps.accounts);
  const now = (deps.now ?? (() => new Date()))();

  const retrieved = await deps.search.search({
    accountId: account.id,
    userId: user.userId,
    query: input.focus ?? "",
    top: MAX_CONTEXT_SOURCES,
  });
  const byId = new Map<string, SourceRecord>();
  for (const s of [...(input.extraSources ?? []), ...retrieved]) if (!byId.has(s.id)) byId.set(s.id, s);
  const sources = [...byId.values()].slice(0, MAX_CONTEXT_SOURCES);
  assertContextIsolated(sources, account, user.userId);

  const base = { accountId: account.id, analyzedSourceIds: sources.map((s) => s.id), generatedAt: now.toISOString() };
  if (sources.length === 0) {
    return { ...base, summary: "No sources are available for this account yet.", findings: [], validation: { droppedCitations: 0, droppedFindings: 0 } };
  }

  const userPrompt = buildUserPrompt(account, sources, now.toISOString().slice(0, 10), input.focus);
  let output: ModelOutput | null = parseModelOutput(await callModel(deps.model, SYSTEM_PROMPT, userPrompt));
  if (!output) {
    output = parseModelOutput(await callModel(deps.model, SYSTEM_PROMPT, `${userPrompt}\n\n${RETRY_NOTE}`));
  }
  if (!output) throw new ApiFailure("INVALID_MODEL_OUTPUT", "The analysis model returned an unreadable result. Please try again.");

  const grounded = groundFindings(output.findings, { accountId: account.id, userId: user.userId, sourcesById: byId });
  return {
    ...base,
    summary: grounded.findings.length > 0 ? output.summary : "No findings could be supported with evidence from this account's sources.",
    findings: grounded.findings,
    validation: { droppedCitations: grounded.droppedCitations, droppedFindings: grounded.droppedFindings },
  };
}
