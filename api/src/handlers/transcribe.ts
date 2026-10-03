import type { Account, TranscribeResponse } from "@deeproot/shared";
import { requireAccountAccess } from "../access.js";
import { ApiFailure } from "../errors.js";
import { transcribeMeeting, type TranscribeAudio } from "../ingest/meeting.js";

/**
 * What the Azure Functions wrapper passes in after parsing multipart/form-data. `userId` comes from
 * the Static Web Apps principal header (null when signed out), never from the request body.
 */
export type TranscribeRequest = {
  userId: string | null;
  accountId: unknown;
  audio: unknown;
  fileName?: unknown;
};

export type TranscribeDeps = {
  getAccount: (accountId: string) => Promise<Account | undefined> | Account | undefined;
  transcribeAudio: TranscribeAudio;
  /** Prepared transcripts by account ID, so a Speech outage never serves one account another's. */
  fallbackTranscripts?: Record<string, string>;
  /** Speech diarization labels to display names, by account ID. */
  speakerNames?: Record<string, Record<string, string>>;
};

/** POST /api/meetings/transcribe: validate, authorize, then hand off to the meeting service. */
export async function handleTranscribe(req: TranscribeRequest, deps: TranscribeDeps): Promise<TranscribeResponse> {
  if (!req.userId) throw new ApiFailure("UNAUTHENTICATED", "Sign in to upload a meeting.");
  if (typeof req.accountId !== "string" || !req.accountId) {
    throw new ApiFailure("BAD_REQUEST", "accountId is required.");
  }
  if (!(req.audio instanceof Uint8Array)) throw new ApiFailure("BAD_REQUEST", "Attach a WAV file as `audio`.");
  if (req.fileName !== undefined && typeof req.fileName !== "string") {
    throw new ApiFailure("BAD_REQUEST", "fileName must be a string.");
  }

  const account = requireAccountAccess(await deps.getAccount(req.accountId), req.userId);

  return transcribeMeeting({
    audio: req.audio,
    fileName: req.fileName,
    transcribe: deps.transcribeAudio,
    speakerNames: deps.speakerNames?.[account.id],
    fallbackTranscript: deps.fallbackTranscripts?.[account.id],
  });
}
