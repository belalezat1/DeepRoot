import type { Account, SourceRecord, TranscribeResponse, TranscriptSegment } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import { normalizeText, safeId } from "./text.js";

/**
 * What ingest needs from Teammate 1's Speech adapter (Azure fast transcription with diarization).
 * Speaker labels are whatever Speech returns ("1", "Guest-1"); `speakerNames` maps them to people.
 * Placeholder until Teammate 1 publishes the real adapter interface.
 */
export type TranscribeAudio = (audio: Uint8Array) => Promise<TranscriptSegment[]>;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // a 30 s 16 kHz mono WAV is about 1 MB

/** Rejects anything that is not a RIFF/WAVE file, before it costs a Speech call. */
export function assertWav(audio: Uint8Array): void {
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new ApiFailure("BAD_REQUEST", "Audio file is larger than 25 MB.");
  }
  const tag = (start: number) => String.fromCharCode(...audio.subarray(start, start + 4));
  if (audio.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new ApiFailure(
      "BAD_REQUEST",
      "Upload a WAV file. Convert Zoom recordings with: ffmpeg -i audio.m4a -ac 1 -ar 16000 meeting.wav",
    );
  }
}

/**
 * Turns diarized segments into "Name: text" lines, merging consecutive segments from the same
 * speaker. This is the same shape as the prepared transcript, so both paths look identical downstream.
 */
export function formatTranscript(
  segments: TranscriptSegment[],
  speakerNames: Record<string, string> = {},
): string {
  const lines: Array<{ speaker: string | undefined; text: string }> = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const last = lines.at(-1);
    if (last && last.speaker === seg.speaker) last.text += ` ${text}`;
    else lines.push({ speaker: seg.speaker, text });
  }
  return normalizeText(
    lines
      .map(({ speaker, text }) =>
        speaker === undefined ? text : `${speakerNames[speaker] ?? `Speaker ${speaker}`}: ${text}`,
      )
      .join("\n"),
  );
}

export type TranscribeMeetingInput = {
  audio: Uint8Array;
  transcribe: TranscribeAudio;
  speakerNames?: Record<string, string>;
  /** The prepared transcript. Used only when Speech fails, and the response says so. */
  fallbackTranscript?: string;
};

/** WAV in, transcript out. Speech failures fall back to the prepared transcript when one is given. */
export async function transcribeMeeting(input: TranscribeMeetingInput): Promise<TranscribeResponse> {
  assertWav(input.audio); // a bad upload is the user's to fix, so it never falls back

  let segments: TranscriptSegment[] = [];
  try {
    segments = await input.transcribe(input.audio);
  } catch (err) {
    console.warn("Speech transcription failed", err);
  }

  const transcript = formatTranscript(segments, input.speakerNames);
  if (transcript) return { transcript, segments, origin: "azure-speech" };

  if (input.fallbackTranscript) {
    return {
      transcript: normalizeText(input.fallbackTranscript),
      segments: [],
      origin: "prepared-fallback",
    };
  }
  throw new ApiFailure("TRANSCRIPTION_FAILED", "Transcription failed and no prepared transcript is set.");
}

export type MeetingSourceInput = {
  account: Account;
  /** The report this meeting belongs to; the source ID is derived from it so citations stay stable. */
  reportId: string;
  transcript: string; // the presenter-reviewed transcript, not the raw Speech output
  occurredAt: string;
  title?: string;
  author?: string;
};

/**
 * The reviewed transcript as a citable SourceRecord. Report citations into the meeting point at
 * this record, so it must be stored before (or with) the report that cites it.
 */
export function meetingToSource(input: MeetingSourceInput): SourceRecord {
  const body = normalizeText(input.transcript);
  if (!body) throw new ApiFailure("BAD_REQUEST", "Transcript is empty.");

  return {
    id: safeId(input.account.id, "meeting", input.reportId),
    accountId: input.account.id,
    kind: "meeting",
    title: input.title ?? `${input.account.name} meeting`,
    author: input.author ?? "Meeting transcript",
    occurredAt: input.occurredAt,
    body,
    allowedUserIds: [...input.account.allowedUserIds],
  };
}
