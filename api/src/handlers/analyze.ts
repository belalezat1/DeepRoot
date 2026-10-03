import type { AgentAnalysis } from "@deeproot/shared";
import type { SignedInUser } from "../access.js";
import { analyzeAccount, type AnalyzeDeps } from "../agent/analyze.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";

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
