import { AdapterError } from "../http.js";
import type { TextGenerator } from "./types.js";

/**
 * Uses `secondary` when `primary` is throttled, overloaded, unreachable or times out.
 * Other failures (bad request, bad key, cut-off reply) are returned as is, since retrying elsewhere won't fix them.
 * The result's `provider` shows which backend answered.
 */
export function withFallback(primary: TextGenerator, secondary: TextGenerator): TextGenerator {
  return {
    async generateText(request) {
      request.signal?.throwIfAborted();
      try {
        return await primary.generateText(request);
      } catch (error) {
        request.signal?.throwIfAborted();
        if (!isTransient(error)) throw error;
        console.warn(`Primary model unavailable, using fallback: ${(error as Error).message.split("\n")[0]}`);
        return secondary.generateText(request);
      }
    },
  };
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof AdapterError) || error.service === "config") return false;
  // No status means the request timed out or never reached the service.
  return error.status === undefined ? error.cause !== undefined : error.status === 429 || error.status >= 500;
}
