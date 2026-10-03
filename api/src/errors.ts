import type { ApiError, ApiErrorCode } from "@deeproot/shared";

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
    return { error: { code: this.code, message: this.message, fallbackUrl: this.fallbackUrl } };
  }
}
