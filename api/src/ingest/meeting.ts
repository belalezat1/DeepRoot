import type { Account, SourceRecord, TranscribeResponse, TranscriptSegment } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import { normalizeText, safeId, toIsoDate } from "./text.js";

/**
 * Transcription, implemented by the Azure teammate (Azure Speech). See docs/AZURE_INTEGRATION.md.
 *
 * - Input: a WAV file's bytes, already validated (RIFF/WAVE, at most 25 MB) before this is called.
 * - Output: segments in time order. Set `speaker` to the service's raw diarization label ("1",
 *   "Guest-1"); `speakerNames` maps labels to people. Omit `speaker` if diarization is unavailable.
 * - Throw on failure. The backend falls back to the account's prepared transcript (marked
 *   "prepared-fallback"), or returns TRANSCRIPTION_FAILED (502) if there is none.
 */
export type TranscribeAudio = (audio: Uint8Array) => Promise<TranscriptSegment[]>;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // a 30 s 16 kHz mono WAV is about 1 MB

const CONVERT_HINT = "Convert it with: ffmpeg -i <input> -ac 1 -ar 16000 meeting.wav";

/** Names the common non-WAV formats by their magic bytes, so the error can say what was uploaded. */
export function sniffAudioFormat(audio: Uint8Array): string | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...audio.subarray(start, start + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (ascii(4, 4) === "ftyp") return "m4a/mp4"; // Zoom's audio and video recordings
  if (ascii(0, 3) === "ID3" || (audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) return "webm";
  return null;
}

/**
 * Rejects anything that is not a RIFF/WAVE file, before it costs a Speech call. The file name is
 * checked too when the client sends one, but the bytes decide: a renamed .m4a is still rejected.
 */
export function assertWav(audio: Uint8Array, fileName?: string): void {
  if (audio.byteLength === 0) throw new ApiFailure("BAD_REQUEST", "The audio file is empty.");
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new ApiFailure("BAD_REQUEST", "Audio file is larger than 25 MB.");
  }
  const format = sniffAudioFormat(audio);
  if (format !== "wav") {
    const seen = format ? `This looks like ${format} audio.` : "This is not a recognized audio file.";
    throw new ApiFailure("BAD_REQUEST", `Upload a WAV file. ${seen} ${CONVERT_HINT}`);
  }
  if (fileName !== undefined && !/\.wav$/i.test(fileName.trim())) {
    throw new ApiFailure("BAD_REQUEST", `Upload a .wav file, not "${fileName}". ${CONVERT_HINT}`);
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
    // Without diarization there is no way to know two segments share a speaker: keep them as lines.
    if (last && seg.speaker !== undefined && last.speaker === seg.speaker) last.text += ` ${text}`;
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
  fileName?: string;
  transcribe: TranscribeAudio;
  speakerNames?: Record<string, string>;
  /** The prepared transcript. Used only when Speech fails, and the response says so. */
  fallbackTranscript?: string;
};

/** WAV in, transcript out. Speech failures fall back to the prepared transcript when one is given. */
export async function transcribeMeeting(input: TranscribeMeetingInput): Promise<TranscribeResponse> {
  assertWav(input.audio, input.fileName); // a bad upload is the user's to fix, so it never falls back

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
  /**
   * Stable ID for this meeting (the downstream report ID works). The source ID is derived from it, so
   * re-saving a corrected transcript replaces the old version instead of adding a second meeting.
   */
  meetingId: string;
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
  const occurredAt = toIsoDate(input.occurredAt);
  if (!occurredAt) throw new ApiFailure("BAD_REQUEST", "Meeting date is not a valid date.");

  return {
    id: safeId(input.account.id, "meeting", input.meetingId),
    accountId: input.account.id,
    kind: "meeting",
    title: input.title ?? `${input.account.name} meeting`,
    author: input.author ?? "Meeting transcript",
    occurredAt,
    body,
    allowedUserIds: [...input.account.allowedUserIds],
  };
}
