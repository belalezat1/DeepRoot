import type { TranscribeResponse } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser } from "../access.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { transcribeMeeting, type TranscribeAudio } from "../ingest/meeting.js";

/**
 * What the Azure Functions wrapper passes in after parsing multipart/form-data. `user` comes from
 * the Static Web Apps principal header (null when signed out), never from the request body.
 */
export type TranscribeRequest = {
  user: SignedInUser | null;
  accountId: unknown;
  audio: unknown; // the uploaded file's bytes (a Node Buffer is a Uint8Array)
  fileName?: unknown;
};

export type TranscribeDeps = {
  accounts: AccountDirectory;
  transcribeAudio: TranscribeAudio;
  /** Prepared transcripts by account ID, so a Speech outage never serves one account another's. */
  fallbackTranscripts?: Record<string, string>;
  /** Speech diarization labels to display names, by account ID. */
  speakerNames?: Record<string, Record<string, string>>;
};

/** POST /api/meetings/transcribe: validate, authorize, then hand off to the meeting service. */
export async function handleTranscribe(
  req: TranscribeRequest,
  deps: TranscribeDeps,
): Promise<HandlerResult<TranscribeResponse>> {
  try {
    const user = requireUser(req.user);
    if (typeof req.accountId !== "string" || !req.accountId) {
      throw new ApiFailure("BAD_REQUEST", "accountId is required.");
    }
    if (!(req.audio instanceof Uint8Array)) throw new ApiFailure("BAD_REQUEST", "Attach a WAV file as `audio`.");
    if (req.fileName !== undefined && typeof req.fileName !== "string") {
      throw new ApiFailure("BAD_REQUEST", "fileName must be a string.");
    }

    const account = await authorizeAccount(user, req.accountId, deps.accounts);

    const body = await transcribeMeeting({
      audio: req.audio,
      fileName: req.fileName,
      transcribe: deps.transcribeAudio,
      speakerNames: deps.speakerNames?.[account.id],
      fallbackTranscript: deps.fallbackTranscripts?.[account.id],
    });
    return { status: 200, body };
  } catch (err) {
    return toErrorResult(err);
  }
}
