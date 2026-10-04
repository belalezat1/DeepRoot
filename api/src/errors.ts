import type { ApiError, ApiErrorCode } from "@deeproot/shared";

/** What every handler returns. Teammate 1's Azure Functions wrapper turns this into an HTTP response. */
export type HandlerResult<T> = { status: number; body: T | ApiError };

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  TRANSCRIPTION_FAILED: 502,
  INVALID_MODEL_OUTPUT: 502,
  INTEGRATION_UNAVAILABLE: 503,
};

/** Thrown by handlers and ingest code; the Functions wrapper turns it into an ApiError response. */
export class ApiFailure extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fallbackUrl?: string,
  ) {
    super(message);
    this.name = "ApiFailure";
    this.status = STATUS[code];
  }

  toBody(): ApiError {
    const body: ApiError = { error: { code: this.code, message: this.message } };
    if (this.fallbackUrl) body.error.fallbackUrl = this.fallbackUrl;
    return body;
  }
}

/** Turns anything a handler throws into the shared error shape; unexpected errors become a generic 500. */
export function toErrorResult(err: unknown): HandlerResult<never> {
  if (err instanceof ApiFailure) return { status: err.status, body: err.toBody() };
  if (err instanceof DOMException && ["AbortError", "TimeoutError"].includes(err.name)) return toErrorResult(new ApiFailure("INTEGRATION_UNAVAILABLE", "The evidence check timed out. Please retry."));
  console.error("Unexpected handler error", err);
  return {
    status: 500,
    body: { error: { code: "INTEGRATION_UNAVAILABLE", message: "Something went wrong. Please try again." } },
  };
}
