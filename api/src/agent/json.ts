import type { ChatModel } from "./model.js";
import { ApiFailure } from "../errors.js";
import { RETRY_NOTE } from "./prompt.js";

/** Model JSON may have a markdown fence; arrays and primitives are never objects. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const json: unknown = JSON.parse(unfenced);
    return json && typeof json === "object" && !Array.isArray(json) ? json as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** One retry for unreadable JSON or an unusable shape; outages fail without an extra model call. */
export async function callJsonModel(
  model: ChatModel,
  system: string,
  user: string,
  maxTokens: number,
  usable: (value: Record<string, unknown>) => boolean = () => true,
  modelLabel = "AI",
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  for (const prompt of [user, `${user}\n\n${RETRY_NOTE}`]) {
    signal?.throwIfAborted();
    let text: string;
    try {
      text = await model.complete({ system, user: prompt, maxTokens, signal });
      signal?.throwIfAborted();
    } catch (err) {
      if (signal?.aborted) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "The evidence check timed out. Please retry.");
      console.error("Model call failed", err);
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", `The ${modelLabel} model is unavailable right now. Please try again.`);
    }
    const parsed = parseJsonObject(text);
    if (parsed && usable(parsed)) return parsed;
  }
  throw new ApiFailure("INVALID_MODEL_OUTPUT", `The ${modelLabel} model returned an unreadable result. Please try again.`);
}
