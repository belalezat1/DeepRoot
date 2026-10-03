import type { AccountBrief, AccountBriefResponse, AgentAnalysis } from "@deeproot/shared";
import { type SignedInUser, authorizeAccount, filterPermittedSources, requireUser } from "../access.js";
import { type AnalyzeDeps, analyzeAccount } from "../agent/analyze.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { toPublicSource } from "../qa/context.js";

const MAX_EMAILS = 10;
const MAX_ITEMS = 6;

export type BriefDeps = AnalyzeDeps;

/**
 * GET /api/accounts/:id/brief: recent emails plus a cited pre-meeting brief.
 * Reuses the caller's latest stored analysis; only runs the agent (which stores its result) when
 * there is none yet, so reloading the page doesn't call the model again.
 */
export async function handleGetBrief(
  input: { user: SignedInUser | null; accountId: string },
  deps: BriefDeps,
): Promise<HandlerResult<AccountBriefResponse>> {
  try {
    const user = requireUser(input.user);
    const account = await authorizeAccount(user, input.accountId, deps.accounts);

    const recent = filterPermittedSources(
      await deps.search.search({ accountId: account.id, userId: user.userId, query: "", top: 25 }),
      account.id,
      user.userId,
    );
    const emails = recent
      .filter((s) => s.kind === "email")
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, MAX_EMAILS)
      .map(toPublicSource);

    let brief: AccountBrief;
    try {
      const stored = await deps.analyses.latest(account.id, user.userId).catch((err: unknown) => {
        console.error("Loading the latest analysis failed; running a new one", err);
        return null;
      });
      brief = toBrief(stored ?? (await analyzeAccount({ user, accountId: account.id }, deps)));
    } catch (err) {
      // The emails are still useful when the model is down; show them with an honest note.
      if (!(err instanceof ApiFailure) || (err.code !== "INTEGRATION_UNAVAILABLE" && err.code !== "INVALID_MODEL_OUTPUT")) {
        throw err;
      }
      brief = { summary: "The brief couldn't be generated right now. The emails below are current.", items: [], openQuestions: [] };
    }

    return { status: 200, body: { account: { id: account.id, name: account.name }, emails, brief } };
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
