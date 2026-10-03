import { ACCOUNTS, ACME_MEETING_DATE, ACME_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { TranscriptSegment } from "@deeproot/shared";
import { describe, expect, it, vi } from "vitest";
import { assertWav, formatTranscript, meetingToSource, transcribeMeeting } from "./meeting.js";

const acme = ACCOUNTS.find((a) => a.id === "acme")!;

/** A minimal valid WAV header; the content does not matter to ingest. */
function wav(): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 2000, speaker: "1", text: "Thanks for making time." },
  { startMs: 2000, endMs: 4000, speaker: "1", text: "When can we have it?" },
  { startMs: 4000, endMs: 6000, speaker: "2", text: "By Friday." },
];

describe("assertWav", () => {
  it("accepts a RIFF/WAVE header", () => {
    expect(() => assertWav(wav())).not.toThrow();
  });

  it("rejects a Zoom m4a with conversion instructions", () => {
    const m4a = new Uint8Array(44);
    m4a.set(new TextEncoder().encode("ftypM4A "), 4);
    expect(() => assertWav(m4a)).toThrow(/ffmpeg/);
  });
});

describe("formatTranscript", () => {
  it("merges consecutive lines from one speaker and applies names", () => {
    expect(formatTranscript(segments, { "1": "Dana", "2": "Marcus" })).toBe(
      "Dana: Thanks for making time. When can we have it?\nMarcus: By Friday.",
    );
  });

  it("labels unnamed speakers instead of guessing", () => {
    expect(formatTranscript(segments.slice(2))).toBe("Speaker 2: By Friday.");
  });
});

describe("transcribeMeeting", () => {
  it("returns the Speech transcript when it works", async () => {
    const result = await transcribeMeeting({
      audio: wav(),
      transcribe: async () => segments,
      speakerNames: { "1": "Dana", "2": "Marcus" },
      fallbackTranscript: ACME_MEETING_TRANSCRIPT,
    });
    expect(result.origin).toBe("azure-speech");
    expect(result.transcript).toContain("Marcus: By Friday.");
  });

  it("uses the prepared transcript when Speech fails, and says so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeMeeting({
      audio: wav(),
      transcribe: async () => {
        throw new Error("Speech 503");
      },
      fallbackTranscript: ACME_MEETING_TRANSCRIPT,
    });
    expect(result).toEqual({ transcript: ACME_MEETING_TRANSCRIPT, segments: [], origin: "prepared-fallback" });
  });

  it("fails clearly when Speech returns nothing and there is no fallback", async () => {
    await expect(transcribeMeeting({ audio: wav(), transcribe: async () => [] })).rejects.toMatchObject({
      code: "TRANSCRIPTION_FAILED",
    });
  });

  it("never sends a non-WAV upload to Speech", async () => {
    const transcribe = vi.fn(async () => segments);
    await expect(transcribeMeeting({ audio: new Uint8Array(10), transcribe })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe("meetingToSource", () => {
  it("makes the reviewed transcript a citable source owned by the account", () => {
    const source = meetingToSource({
      account: acme,
      reportId: "rpt-1",
      transcript: ACME_MEETING_TRANSCRIPT,
      occurredAt: ACME_MEETING_DATE,
    });
    expect(source).toMatchObject({
      id: "acme-meeting-rpt-1",
      kind: "meeting",
      accountId: "acme",
      title: "Acme Corporation meeting",
      allowedUserIds: acme.allowedUserIds,
    });
    expect(source.body).toContain("ready for you by Friday");
  });
});
