import type { SourceSearch } from "../store/sources.js";
import { permittedPointRead } from "../store/authorization.js";
import type { AgentAnalysis } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, notFound, requireUser } from "../access.js";
import { analyzeAccount, type AnalyzeDeps } from "../agent/analyze.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import type { AnalysisStore } from "../store/analyses.js";
import { containsPersonalPayroll } from "../dataPolicy.js";

export type AnalyzeHandlerInput = {
  user: SignedInUser | null;
  body: unknown;
};

const MAX_FOCUS_CHARS = 300;

/** POST /api/agent/analyze: grounded cross-source findings for one account. */
export async function handleAnalyze(input: AnalyzeHandlerInput, deps: AnalyzeDeps): Promise<HandlerResult<AgentAnalysis>> {
  try {
    const body = (input.body ?? {}) as { accountId?: unknown; focus?: unknown };
    if (typeof body.accountId !== "string" || !body.accountId) throw new ApiFailure("BAD_REQUEST", "accountId is required.");
    if (body.focus !== undefined && (typeof body.focus !== "string" || body.focus.length > MAX_FOCUS_CHARS)) {
      throw new ApiFailure("BAD_REQUEST", `focus must be text of at most ${MAX_FOCUS_CHARS} characters.`);
    }
    const focus = typeof body.focus === "string" ? body.focus.trim() || undefined : undefined;
    return { status: 200, body: await analyzeAccount({ user: input.user, accountId: body.accountId, focus }, deps) };
  } catch (err) {
    return toErrorResult(err);
  }
}

/**
 * GET /api/accounts/:id/analysis: the caller's latest stored analysis, for the UI, morning brief,
 * action items, and Linear drafts. Reads Cosmos only; it never calls the model.
 */
export async function handleGetLatestAnalysis(
  input: { user: SignedInUser | null; accountId: string },
  deps: { accounts: AccountDirectory; analyses: AnalysisStore; search?: SourceSearch },
): Promise<HandlerResult<AgentAnalysis>> {
  try {
    const user = requireUser(input.user);
    const account = await authorizeAccount(user, input.accountId, deps.accounts);
    const analysis = await deps.analyses.latest(account.id, user.userId).catch((err: unknown) => {
      console.error("Loading the analysis failed", err);
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Could not load the analysis. Please try again.");
    });
    if (!analysis || containsPersonalPayroll(JSON.stringify(analysis))) throw notFound();
    if (deps.search?.get) for (const id of analysis.analyzedSourceIds) await permittedPointRead(deps.search, account, user.userId, id);
    return { status: 200, body: analysis };
  } catch (err) {
    return toErrorResult(err);
  }
}
