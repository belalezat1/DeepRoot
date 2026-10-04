import { ACCOUNTS, DEMO_SPEAKER_NAMES, DEMO_USERS, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { TranscribeResponse } from "@deeproot/shared";
import { describe, expect, it, vi } from "vitest";
import { InMemoryAccountDirectory } from "../store/reports.js";
import { wav } from "../testing/audio.js";
import { handleTranscribe, type TranscribeDeps } from "./transcribe.js";

function deps(overrides: Partial<TranscribeDeps> = {}): TranscribeDeps {
  return {
    accounts: new InMemoryAccountDirectory(ACCOUNTS),
    transcribeAudio: vi.fn(async () => [
      { startMs: 0, endMs: 1000, speaker: "1", text: "Where are we on the launch?" },
      { startMs: 1000, endMs: 2000, speaker: "2", text: "State tax is the open item." },
    ]),
    fallbackTranscripts: { northstar: NORTHSTAR_MEETING_TRANSCRIPT },
    speakerNames: DEMO_SPEAKER_NAMES,
    ...overrides,
  };
}

const request = { user: { userId: DEMO_USERS.presenter }, accountId: "northstar", audio: wav(), fileName: "meeting.wav" };
const failingSpeech = () => vi.fn(async () => Promise.reject(new Error("Speech 503")));

describe("POST /api/meetings/transcribe", () => {
  it("returns a speaker-labelled transcript for a permitted account", async () => {
    const result = await handleTranscribe(request, deps());
    expect(result.status).toBe(200);
    const body = result.body as TranscribeResponse;
    expect(body.origin).toBe("azure-speech");
    expect(body.transcript).toBe("Maya: Where are we on the launch?\nSam: State tax is the open item.");
    expect(body.segments).toHaveLength(2);
  });

  it("marks the prepared fallback when Speech is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await handleTranscribe({ ...request, allowPreparedFallback: true }, deps({ transcribeAudio: failingSpeech() }));
    expect(result.body).toMatchObject({ origin: "prepared-fallback", transcript: NORTHSTAR_MEETING_TRANSCRIPT });
  });

  it("validates the request before anything else", async () => {
    const d = deps();
    expect(await handleTranscribe({ ...request, user: null }, d)).toMatchObject({ status: 401, body: { error: { code: "UNAUTHENTICATED" } } });
    for (const bad of [{ accountId: 7 }, { audio: "base64..." }, { fileName: 3 }]) {
      expect((await handleTranscribe({ ...request, ...bad }, d)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(d.transcribeAudio).not.toHaveBeenCalled();
  });

  it("rejects an m4a upload with conversion guidance", async () => {
    const result = await handleTranscribe({ ...request, fileName: "zoom.m4a" }, deps());
    expect(result).toMatchObject({ status: 400, body: { error: { code: "BAD_REQUEST", message: expect.stringContaining("ffmpeg") } } });
  });

  it("returns NOT_FOUND for an account the user cannot see, before calling Speech", async () => {
    const d = deps();
    for (const accountId of ["betaco", "does-not-exist"]) {
      expect(await handleTranscribe({ ...request, accountId }, d)).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
    }
    expect(d.transcribeAudio).not.toHaveBeenCalled();
  });

  it("never serves one account's prepared transcript to another", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const betaco = { ...request, user: { userId: DEMO_USERS.betacoLead }, accountId: "betaco" };
    expect(await handleTranscribe(betaco, deps({ transcribeAudio: failingSpeech() }))).toMatchObject({
      status: 502,
      body: { error: { code: "TRANSCRIPTION_FAILED" } },
    });
  });
});
