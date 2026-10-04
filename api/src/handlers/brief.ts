import type { AccountBrief, AccountBriefResponse, AgentAnalysis } from "@deeproot/shared";
import { type SignedInUser, authorizeAccount, filterPermittedSources, requireUser } from "../access.js";
import { type AnalyzeDeps, analyzeAccount, MAX_CONTEXT_SOURCES } from "../agent/analyze.js";
import { sourceFingerprint } from "../agent/fingerprint.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { toPublicSource } from "../qa/context.js";

const MAX_EMAILS = 10;
const MAX_ITEMS = 6;

export type BriefDeps = AnalyzeDeps & { pendingBriefs?: Map<string, Promise<AgentAnalysis>> };
const CACHE_MS = 5 * 60 * 1000;
// Direct handler consumers share by their analysis store; createBackend supplies its own map.
const pendingByStore = new WeakMap<AnalyzeDeps["analyses"], Map<string, Promise<AgentAnalysis>>>();

/**
 * GET /api/accounts/:id/brief: recent emails plus a cited pre-meeting brief.
 * Reuses a recent analysis only while its permitted source snapshot is unchanged.
 */
export async function handleGetBrief(
  input: { user: SignedInUser | null; accountId: string },
  deps: BriefDeps,
): Promise<HandlerResult<AccountBriefResponse>> {
  try {
    const user = requireUser(input.user);
    const account = await authorizeAccount(user, input.accountId, deps.accounts);

    const recent = filterPermittedSources(
      await deps.search.search({ accountId: account.id, userId: user.userId, query: "", top: MAX_CONTEXT_SOURCES }),
      account.id,
      user.userId,
    );
    const emails = recent
      .filter((s) => s.kind === "email")
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, MAX_EMAILS)
      .map(toPublicSource);

    let brief: AccountBrief;
    let sources: AccountBriefResponse["sources"] = [];
    try {
      const stored = await deps.analyses.latest(account.id, user.userId).catch((err: unknown) => {
        console.error("Loading the latest analysis failed; running a new one", err);
        return null;
      });
      const now = (deps.now ?? (() => new Date()))().getTime();
      const age = stored ? now - new Date(stored.generatedAt).getTime() : Infinity;
      const fingerprint = sourceFingerprint(recent);
      let analysis = stored;
      if (!analysis || !(age >= 0 && age < CACHE_MS) || analysis.sourceFingerprint !== fingerprint) {
        let pending = deps.pendingBriefs ?? pendingByStore.get(deps.analyses);
        if (!pending) {
          pending = new Map();
          pendingByStore.set(deps.analyses, pending);
        }
        const key = JSON.stringify([account.id, user.userId, fingerprint]);
        let generation = pending.get(key);
        if (!generation) {
          generation = analyzeAccount({ user, accountId: account.id, retrievedSources: recent }, deps);
          pending.set(key, generation);
        }
        try { analysis = await generation; }
        finally { if (pending.get(key) === generation) pending.delete(key); }
      }
      brief = toBrief(analysis);
      // Use the current permitted records, rather than exposing an old analysis snapshot.
      const ids = new Set(analysis.sources.map((s) => s.id));
      sources = recent.filter((s) => ids.has(s.id)).map(toPublicSource);
    } catch (err) {
      // The emails are still useful when the model is down; show them with an honest note.
      if (!(err instanceof ApiFailure) || (err.code !== "INTEGRATION_UNAVAILABLE" && err.code !== "INVALID_MODEL_OUTPUT")) {
        throw err;
      }
      brief = { summary: "The brief couldn't be generated right now. The emails below are current.", items: [], openQuestions: [] };
    }

    return { status: 200, body: { account: { id: account.id, name: account.name }, emails, sources, brief } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** Agent findings → brief: open questions listed separately, everything else as cited items. */
export function toBrief(analysis: AgentAnalysis): AccountBrief {
  const items = analysis.findings
    .filter((f) => f.type !== "open_question")
    .slice(0, MAX_ITEMS)
    .map((f) => ({ text: `${f.title}: ${f.description}`, citations: f.citations, type: f.type, severity: f.severity }));
  const openQuestions = analysis.findings.filter((f) => f.type === "open_question").map((f) => f.title);
  return { summary: analysis.summary, items, openQuestions };
}
