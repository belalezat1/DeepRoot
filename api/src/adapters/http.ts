// Shared HTTP handling for Azure and model adapters: timeouts, retries and readable errors.

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdapterError";
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export type RequestOptions = {
  /** Per-attempt limit. Static Web Apps managed Functions stop long requests, so keep this well under a minute. */
  timeoutMs?: number;
  /** Extra attempts after a brief throttle or server error. Timeouts and exhausted quotas are not retried. */
  retries?: number;
};

export function postJson(
  service: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson(
    service,
    url,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
    options,
  );
}

/** Sends a request and parses a JSON reply. The body must be re-sendable (a string or FormData) for retries. */
export async function requestJson(
  service: string,
  url: string,
  init: RequestInit,
  { timeoutMs = 25_000, retries = 2 }: RequestOptions = {},
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      if (!timedOut && attempt < retries) {
        await backoff(attempt);
        continue;
      }
      const reason = timedOut ? `timed out after ${timeoutMs} ms` : "request failed";
      throw new AdapterError(`${service} ${reason}`, service, undefined, { cause: error });
    }

    if (response.ok) return response.json();

    const retryAfter = response.headers.get("retry-after");
    // A 429 without a short Retry-After usually means a quota window, so fail fast and let a fallback answer.
    const quotaExhausted = response.status === 429 && !(Number(retryAfter) > 0 && Number(retryAfter) <= 5);
    if (RETRYABLE_STATUSES.has(response.status) && !quotaExhausted && attempt < retries) {
      await backoff(attempt, retryAfter);
      continue;
    }
    const detail = (await response.text()).slice(0, 500);
    throw new AdapterError(`${service} returned ${response.status}: ${detail}`, service, response.status);
  }
}

function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const requested = Number(retryAfter) * 1000;
  const ms = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 5_000) : 1_000 * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
