import { ACCOUNTS, DEMO_SPEAKER_NAMES, DEMO_USERS, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { wav } from "../testing/audio.js";
import { handleTranscribe, type TranscribeDeps } from "./transcribe.js";

function deps(overrides: Partial<TranscribeDeps> = {}): TranscribeDeps {
  return {
    getAccount: (id) => ACCOUNTS.find((a) => a.id === id),
    transcribeAudio: vi.fn(async () => [
      { startMs: 0, endMs: 1000, speaker: "1", text: "Where are we on the launch?" },
      { startMs: 1000, endMs: 2000, speaker: "2", text: "State tax is the open item." },
    ]),
    fallbackTranscripts: { northstar: NORTHSTAR_MEETING_TRANSCRIPT },
    speakerNames: DEMO_SPEAKER_NAMES,
    ...overrides,
  };
}

const request = { userId: DEMO_USERS.presenter, accountId: "northstar", audio: wav(), fileName: "meeting.wav" };

describe("POST /api/meetings/transcribe", () => {
  it("returns a speaker-labelled transcript for a permitted account", async () => {
    const result = await handleTranscribe(request, deps());
    expect(result.origin).toBe("azure-speech");
    expect(result.transcript).toBe("Maya: Where are we on the launch?\nSam: State tax is the open item.");
    expect(result.segments).toHaveLength(2);
  });

  it("marks the prepared fallback when Speech is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const transcribeAudio = vi.fn(async () => Promise.reject(new Error("Speech 503")));
    const result = await handleTranscribe(request, deps({ transcribeAudio }));
    expect(result).toMatchObject({ origin: "prepared-fallback", transcript: NORTHSTAR_MEETING_TRANSCRIPT });
  });

  it("validates the request before anything else", async () => {
    const d = deps();
    await expect(handleTranscribe({ ...request, userId: null }, d)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(handleTranscribe({ ...request, accountId: 7 }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(handleTranscribe({ ...request, audio: "base64..." }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(handleTranscribe({ ...request, fileName: 3 }, d)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(d.transcribeAudio).not.toHaveBeenCalled();
  });

  it("rejects an m4a upload with conversion guidance", async () => {
    await expect(handleTranscribe({ ...request, fileName: "zoom.m4a" }, deps())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: expect.stringContaining("ffmpeg"),
    });
  });

  it("returns NOT_FOUND for an account the user cannot see, before calling Speech", async () => {
    const d = deps();
    for (const accountId of ["betaco", "does-not-exist"]) {
      await expect(handleTranscribe({ ...request, accountId }, d)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(d.transcribeAudio).not.toHaveBeenCalled();
  });

  it("never serves one account's prepared transcript to another", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const transcribeAudio = vi.fn(async () => Promise.reject(new Error("Speech 503")));
    const betaco = { ...request, userId: DEMO_USERS.betacoLead, accountId: "betaco" };
    await expect(handleTranscribe(betaco, deps({ transcribeAudio }))).rejects.toMatchObject({
      code: "TRANSCRIPTION_FAILED",
    });
  });
});
