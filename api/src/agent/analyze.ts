import type { Account, AgentAnalysis, PublicSource, SourceRecord } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser } from "../access.js";
import { ApiFailure } from "../errors.js";
import { safeId } from "../ingest/text.js";
import type { AnalysisStore } from "../store/analyses.js";
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
  analyses: AnalysisStore;
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

async function retrieve(search: SourceSearch, req: Parameters<SourceSearch["search"]>[0]): Promise<SourceRecord[]> {
  try {
    return await search.search(req);
  } catch (err) {
    console.error("Source retrieval failed", err);
    throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Source retrieval is unavailable right now. Please try again.");
  }
}

async function callModel(model: ChatModel, system: string, user: string): Promise<string> {
  try {
    return await model.complete({ system, user, maxTokens: MAX_OUTPUT_TOKENS });
  } catch (err) {
    console.error("Analysis model call failed", err);
    throw new ApiFailure("INTEGRATION_UNAVAILABLE", "The analysis model is unavailable right now. Please try again.");
  }
}

/**
 * Authorized sources (SourceSearch) -> analysis model (ChatModel) -> grounded findings (AnalysisStore).
 * 1. Authenticate and authorize the account (before any retrieval).
 * 2. Retrieve with account and user filters, add any extra sources, and verify isolation.
 * 3. Ask the model once (one retry if the reply is not valid JSON).
 * 4. Keep only findings whose citations check out against the exact sources the model saw.
 * 5. Save the result, so the UI, morning brief, action items, and Linear drafts can read it back.
 * The model gets no tools: it cannot request more data, so it cannot get around these checks.
 */
export async function analyzeAccount(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AgentAnalysis> {
  const user = requireUser(input.user);
  const account = await authorizeAccount(user, input.accountId, deps.accounts);
  const now = (deps.now ?? (() => new Date()))();

  const retrieved = await retrieve(deps.search, {
    accountId: account.id,
    userId: user.userId,
    query: input.focus ?? "",
    top: MAX_CONTEXT_SOURCES,
  });
  // Extra sources first (a just-reviewed meeting beats an older indexed copy), each ID once.
  const unique = new Map<string, SourceRecord>();
  for (const s of [...(input.extraSources ?? []), ...retrieved]) if (!unique.has(s.id)) unique.set(s.id, s);
  const sources = [...unique.values()].slice(0, MAX_CONTEXT_SOURCES);
  assertContextIsolated(sources, account, user.userId);
  const byId = new Map(sources.map((s) => [s.id, s])); // citations may only point at what the model saw

  const generatedAt = now.toISOString();
  const base = {
    id: safeId("analysis", account.id, user.userId, generatedAt),
    accountId: account.id,
    createdBy: user.userId,
    analyzedSourceIds: sources.map((s) => s.id),
    generatedAt,
  };
  if (sources.length === 0) {
    // Not saved: there is nothing to analyze, so there is nothing for downstream features to read.
    return {
      ...base,
      summary: "No sources are available for this account yet.",
      findings: [],
      sources: [],
      validation: { droppedCitations: 0, droppedFindings: 0 },
    };
  }

  const userPrompt = buildUserPrompt(account, sources, now.toISOString().slice(0, 10), input.focus);
  let output: ModelOutput | null = parseModelOutput(await callModel(deps.model, SYSTEM_PROMPT, userPrompt));
  if (!output) {
    output = parseModelOutput(await callModel(deps.model, SYSTEM_PROMPT, `${userPrompt}\n\n${RETRY_NOTE}`));
  }
  if (!output) throw new ApiFailure("INVALID_MODEL_OUTPUT", "The analysis model returned an unreadable result. Please try again.");

  const grounded = groundFindings(output.findings, { accountId: account.id, userId: user.userId, sourcesById: byId });
  const analysis: AgentAnalysis = {
    ...base,
    summary: grounded.findings.length > 0 ? output.summary : "No findings could be supported with evidence from this account's sources.",
    findings: grounded.findings,
    sources: citedSources(grounded.findings.flatMap((f) => f.relatedSourceIds), byId),
    validation: { droppedCitations: grounded.droppedCitations, droppedFindings: grounded.droppedFindings },
  };

  // A failed save should not throw away a good analysis the user is waiting for: return it, and
  // let the next run save again. Downstream features just see the previous analysis until then.
  try {
    await deps.analyses.save(analysis);
  } catch (err) {
    console.error("Saving the analysis failed", err);
  }
  return analysis;
}

/** The cited sources, without access lists, in first-cited order: what UI cards and drafts display. */
function citedSources(ids: string[], byId: Map<string, SourceRecord>): PublicSource[] {
  return [...new Set(ids)].map((id) => {
    const { allowedUserIds: _hidden, ...source } = byId.get(id)!;
    return source;
  });
}
