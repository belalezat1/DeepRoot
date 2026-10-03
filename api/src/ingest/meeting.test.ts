import { ACCOUNTS, NORTHSTAR_MEETING_DATE, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { TranscriptSegment } from "@deeproot/shared";
import { describe, expect, it, vi } from "vitest";
import { m4a, wav } from "../testing/audio.js";
import { assertWav, formatTranscript, meetingToSource, sniffAudioFormat, transcribeMeeting } from "./meeting.js";

const northstar = ACCOUNTS.find((a) => a.id === "northstar")!;
const ascii = (s: string) => new TextEncoder().encode(s);

const segments: TranscriptSegment[] = [
  { startMs: 0, endMs: 2000, speaker: "1", text: "Before we wrap up," },
  { startMs: 2000, endMs: 4000, speaker: "1", text: "where are we on the launch?" },
  { startMs: 4000, endMs: 6000, speaker: "2", text: "The open item is state tax setup." },
];

describe("assertWav", () => {
  it("accepts a RIFF/WAVE file", () => {
    expect(() => assertWav(wav(), "meeting.wav")).not.toThrow();
  });

  it("names a Zoom m4a and says how to convert it", () => {
    expect(() => assertWav(m4a(), "audio.m4a")).toThrow(/m4a\/mp4 audio.*ffmpeg -i <input> -ac 1 -ar 16000 meeting\.wav/);
  });

  it("rejects a WAV upload with the wrong extension", () => {
    expect(() => assertWav(wav(), "audio.m4a")).toThrow(/Upload a \.wav file, not "audio\.m4a"/);
  });

  it("checks the bytes, not just the name: a renamed m4a is still rejected", () => {
    expect(() => assertWav(m4a(), "meeting.wav")).toThrow(/m4a\/mp4/);
  });

  it("rejects empty and unrecognized files", () => {
    expect(() => assertWav(new Uint8Array(0))).toThrow(/empty/);
    expect(() => assertWav(ascii("hello, not audio"))).toThrow(/not a recognized audio file/);
  });

  it("recognizes other common formats", () => {
    expect(sniffAudioFormat(ascii("ID3\u0004"))).toBe("mp3");
    expect(sniffAudioFormat(ascii("OggS"))).toBe("ogg");
    expect(sniffAudioFormat(ascii("fLaC"))).toBe("flac");
  });
});

describe("formatTranscript", () => {
  it("merges consecutive segments from one speaker and applies names", () => {
    expect(formatTranscript(segments, { "1": "Maya", "2": "Sam" })).toBe(
      "Maya: Before we wrap up, where are we on the launch?\nSam: The open item is state tax setup.",
    );
  });

  it("labels unnamed speakers instead of guessing", () => {
    expect(formatTranscript(segments.slice(2))).toBe("Speaker 2: The open item is state tax setup.");
  });

  it("handles segments with no diarization", () => {
    expect(formatTranscript([{ startMs: 0, endMs: 1, text: " Hello. " }])).toBe("Hello.");
  });
});

describe("transcribeMeeting", () => {
  it("returns the Speech transcript and its segments", async () => {
    const result = await transcribeMeeting({
      audio: wav(),
      transcribe: async () => segments,
      speakerNames: { "1": "Maya", "2": "Sam" },
      fallbackTranscript: NORTHSTAR_MEETING_TRANSCRIPT,
    });
    expect(result).toEqual({
      transcript: "Maya: Before we wrap up, where are we on the launch?\nSam: The open item is state tax setup.",
      segments,
      origin: "azure-speech",
    });
  });

  it("uses the prepared transcript when Speech throws, and marks it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeMeeting({
      audio: wav(),
      transcribe: async () => {
        throw new Error("Speech 503");
      },
      fallbackTranscript: NORTHSTAR_MEETING_TRANSCRIPT,
    });
    expect(result).toEqual({ transcript: NORTHSTAR_MEETING_TRANSCRIPT, segments: [], origin: "prepared-fallback" });
  });

  it("uses the prepared transcript when Speech returns only silence", async () => {
    const result = await transcribeMeeting({
      audio: wav(),
      transcribe: async () => [{ startMs: 0, endMs: 1, speaker: "1", text: "   " }],
      fallbackTranscript: NORTHSTAR_MEETING_TRANSCRIPT,
    });
    expect(result.origin).toBe("prepared-fallback");
  });

  it("fails clearly when Speech returns nothing and there is no fallback", async () => {
    await expect(transcribeMeeting({ audio: wav(), transcribe: async () => [] })).rejects.toMatchObject({
      code: "TRANSCRIPTION_FAILED",
    });
  });

  it("never sends an unsupported upload to Speech, and never falls back for it", async () => {
    const transcribe = vi.fn(async () => segments);
    await expect(
      transcribeMeeting({ audio: m4a(), transcribe, fallbackTranscript: NORTHSTAR_MEETING_TRANSCRIPT }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe("meetingToSource", () => {
  const reviewed = NORTHSTAR_MEETING_TRANSCRIPT.replace("Almost", "Nearly"); // a presenter correction

  it("makes the reviewed transcript the citable source, owned by the account", () => {
    const source = meetingToSource({
      account: northstar,
      meetingId: "rpt-1",
      transcript: `${reviewed}\r\n\r\n`,
      occurredAt: NORTHSTAR_MEETING_DATE,
    });
    expect(source).toEqual({
      id: "northstar-meeting-rpt-1",
      accountId: "northstar",
      kind: "meeting",
      title: "Northstar Logistics meeting",
      author: "Meeting transcript",
      occurredAt: "2026-10-02T15:00:00.000Z",
      body: reviewed,
      allowedUserIds: northstar.allowedUserIds,
    });
  });

  it("gives a corrected transcript the same ID, so it replaces the earlier version", () => {
    const input = { account: northstar, meetingId: "rpt-1", occurredAt: NORTHSTAR_MEETING_DATE };
    const first = meetingToSource({ ...input, transcript: NORTHSTAR_MEETING_TRANSCRIPT });
    expect(meetingToSource({ ...input, transcript: reviewed }).id).toBe(first.id);
  });

  it("rejects an empty transcript or an invalid date", () => {
    const input = { account: northstar, meetingId: "m", occurredAt: NORTHSTAR_MEETING_DATE };
    expect(() => meetingToSource({ ...input, transcript: " \n " })).toThrow(/empty/);
    expect(() => meetingToSource({ ...input, transcript: "x", occurredAt: "Friday" })).toThrow(/valid date/);
  });
});
