import { BETACO_CANARY, DEMO_USERS } from "@deeproot/demo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSeedSources } from "../ingest/seed.js";
import { createAdapters } from "./index.js";
import { createInMemorySourceSearch, permittedFilter } from "./search.js";
import { createAzureSpeechTranscriber } from "./speech.js";
import { createGeminiTextGenerator, createStubTextGenerator, withFallback } from "./text/index.js";
import { AdapterError } from "./http.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("search access", () => {
  it("escapes quotes so an ID cannot widen the filter", () => {
    expect(permittedFilter("northstar", "x' or true or '")).toBe(
      "accountId eq 'northstar' and allowedUserIds/any(u: u eq 'x'' or true or ''')",
    );
  });

  it("never returns BetaCo content to the presenter, even when asked for it", async () => {
    const search = createInMemorySourceSearch(buildSeedSources());
    for (const accountId of ["northstar", "betaco"]) {
      const results = await search.searchPermittedSources({
        accountId,
        userId: DEMO_USERS.presenter,
        text: `BetaCo payroll ${BETACO_CANARY}`,
        top: 50,
      });
      expect(results.every((s) => s.accountId === "northstar")).toBe(true);
      expect(JSON.stringify(results)).not.toContain(BETACO_CANARY);
    }
  });
});

describe("createAdapters", () => {
  it("runs entirely offline when no settings are present", async () => {
    const adapters = createAdapters({});
    expect(adapters.backends).toEqual({ speech: "stub", model: "stub", storage: "memory", search: "memory" });
    expect(await adapters.accounts.getAccount("northstar")).toMatchObject({ id: "northstar" });
    expect(await adapters.transcribeAudio(new Uint8Array())).toEqual([]);
  });
});

describe("Azure Speech", () => {
  it("turns diarized phrases into transcript segments", async () => {
    const fetchMock = stubFetch({
      status: 200,
      body: {
        phrases: [
          { offsetMilliseconds: 100, durationMilliseconds: 900, text: "Hi.", speaker: 1 },
          { offsetMilliseconds: 1200, durationMilliseconds: 500, text: "Hello." },
        ],
      },
    });
    const transcribe = createAzureSpeechTranscriber({ region: "eastus2", key: "k" });

    expect(await transcribe(new Uint8Array([1, 2, 3]))).toEqual([
      { startMs: 100, endMs: 1000, speaker: "1", text: "Hi." },
      { startMs: 1200, endMs: 1700, text: "Hello." },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("eastus2.api.cognitive.microsoft.com");
    expect(JSON.parse((init.body as FormData).get("definition") as string)).toMatchObject({
      diarization: { enabled: true },
    });
  });
});

describe("model fallback", () => {
  const request = { messages: [{ role: "user" as const, content: "hi" }] };
  const failing = (error: AdapterError) => ({ generateText: () => Promise.reject(error) });

  it("answers from the fallback when the primary is rate limited or down", async () => {
    for (const status of [429, 503]) {
      const result = await withFallback(failing(new AdapterError("busy", "Gemini", status)), createStubTextGenerator())
        .generateText(request);
      expect(result.provider).toBe("stub");
    }
  });

  it("does not hide a bad request or a missing key behind the fallback", async () => {
    const fallback = createStubTextGenerator();
    await expect(withFallback(failing(new AdapterError("bad", "Gemini", 400)), fallback).generateText(request))
      .rejects.toThrow("bad");
    await expect(withFallback(failing(new AdapterError("GEMINI_API_KEY is not set", "config")), fallback)
      .generateText(request)).rejects.toThrow("not set");
  });

  it("rejects a Gemini reply that was cut off instead of returning part of it", async () => {
    stubFetch({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: "A payroll export is" }] }, finishReason: "MAX_TOKENS" }] },
    });
    const gemini = createGeminiTextGenerator({ apiKey: "k", model: "m" });
    await expect(gemini.generateText(request)).rejects.toThrow("cut off");
  });
});
