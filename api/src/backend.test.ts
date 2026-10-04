// Adapter contract tests: any adapters that behave as docs/AZURE_INTEGRATION.md describes plug into
// createBackend unchanged. These pin OUR assumptions about the adapters, not Azure's behavior.
import { ACCOUNTS, BETACO_CANARY, DEMO_USERS, NORTHSTAR_CUSTOMER_EMAIL, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { AgentAnalysis, SourceRecord, TranscribeResponse } from "@deeproot/shared";
import { describe, expect, it, vi } from "vitest";
import { createBackend, type BackendAdapters } from "./backend.js";
import { InMemoryAnalysisStore } from "./store/analyses.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "./store/reports.js";
import { InMemorySourceSearch, type SourceSearch } from "./store/sources.js";
import { ALL_SOURCES, IDS, QUOTES, reply, scriptedModel } from "./testing/agent.js";
import { wav } from "./testing/audio.js";
import { checkSourceSearchIsolation, checkTranscriptSegments } from "./testing/conformance.js";

const user = { userId: DEMO_USERS.presenter };
const oneFinding = reply([{ type: "blocker", title: "Tax setup blocked", description: "d", severity: "high", citations: [{ sourceId: IDS.tracker, quote: QUOTES.trackerBlocked }] }]);
const diarized = [
  { startMs: 0, endMs: 3000, speaker: "1", text: "Where are we on the launch?" },
  { startMs: 3000, endMs: 6000, speaker: "2", text: "State tax is the open item." },
];

function adapters(overrides: Partial<BackendAdapters> = {}): BackendAdapters {
  return {
    accounts: new InMemoryAccountDirectory(ACCOUNTS),
    sources: new InMemorySourceSearch(ALL_SOURCES),
    analyses: new InMemoryAnalysisStore(),
    model: scriptedModel(oneFinding),
    transcribeAudio: async () => diarized,
    reports: new InMemoryReportStore(),
    ...overrides,
  };
}
const analyze = (a: BackendAdapters) => createBackend(a).analyze({ user, body: { accountId: "northstar" } });
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("SourceSearch contract", () => {
  it("a search returning permitted Northstar records lets the agent run", async () => {
    const search: SourceSearch = { search: async ({ accountId, userId }) => ALL_SOURCES.filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId)) };
    const result = await analyze(adapters({ sources: Object.assign(new InMemorySourceSearch(), search) }));
    expect(result.status).toBe(200);
    expect((result.body as AgentAnalysis).findings).toHaveLength(1);
  });

  it("a search that throws becomes 503 INTEGRATION_UNAVAILABLE, and the model is not called", async () => {
    quiet();
    const model = scriptedModel(oneFinding);
    const sources = Object.assign(new InMemorySourceSearch(), { search: async () => Promise.reject(new Error("Search 503: index unavailable")) });
    expect(await analyze(adapters({ sources, model }))).toEqual({
      status: 503,
      body: { error: { code: "INTEGRATION_UNAVAILABLE", message: "Source retrieval is unavailable right now. Please try again." } },
    });
    expect(model.calls).toHaveLength(0);
  });

  it("a search missing its account filter is a 500 that names nothing, and the model is not called", async () => {
    quiet();
    const model = scriptedModel(oneFinding);
    const sources = Object.assign(new InMemorySourceSearch(), { search: async () => ALL_SOURCES });
    const result = await analyze(adapters({ sources, model }));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toMatch(/betaco|BLUEHERON|northstar-/i);
    expect(model.calls).toHaveLength(0);
  });

  it("the conformance check passes a correct adapter and catches a leaky one", async () => {
    await expect(checkSourceSearchIsolation(new InMemorySourceSearch(ALL_SOURCES))).resolves.toBeUndefined();
    const leaky: SourceSearch = { search: async ({ top }) => ALL_SOURCES.slice(0, top) };
    await expect(checkSourceSearchIsolation(leaky)).rejects.toThrow(/Returned betaco record|BetaCo/);
    const noUserFilter: SourceSearch = {
      search: async ({ accountId, top }) =>
        new InMemorySourceSearch(ALL_SOURCES.map((s) => ({ ...s, allowedUserIds: [DEMO_USERS.presenter] })))
          .search({ accountId, userId: DEMO_USERS.presenter, query: "", top }),
    };
    await expect(checkSourceSearchIsolation(noUserFilter)).rejects.toThrow(/allowedUserIds filter is missing/);
  });
});

describe("SourceWriter contract", () => {
  it("records written through ingestion come back through search", async () => {
    const backend = createBackend(adapters({ sources: new InMemorySourceSearch() }));
    expect((await backend.ingestEmails({ user, body: { emails: [NORTHSTAR_CUSTOMER_EMAIL] } })).status).toBe(200);
    const result = await backend.analyze({ user, body: { accountId: "northstar" } });
    expect((result.body as AgentAnalysis).analyzedSourceIds).toEqual([IDS.customerEmail]);
  });

  it("a write that throws becomes 503 INTEGRATION_UNAVAILABLE", async () => {
    quiet();
    const sources = Object.assign(new InMemorySourceSearch(), { save: async () => Promise.reject(new Error("Cosmos 429")) });
    expect(await createBackend(adapters({ sources })).ingestEmails({ user, body: { emails: [NORTHSTAR_CUSTOMER_EMAIL] } })).toMatchObject({
      status: 503,
      body: { error: { code: "INTEGRATION_UNAVAILABLE" } },
    });
  });
});

describe("ChatModel contract", () => {
  it("a model returning the JSON object (even fenced) produces an analysis", async () => {
    const result = await analyze(adapters({ model: scriptedModel("```json\n" + oneFinding + "\n```") }));
    expect(result.status).toBe(200);
  });

  it("a model that throws becomes 503 without exposing the error text", async () => {
    quiet();
    const result = await analyze(adapters({ model: scriptedModel(new Error("401 key sk-secret rejected")) }));
    expect(result).toMatchObject({ status: 503, body: { error: { code: "INTEGRATION_UNAVAILABLE" } } });
    expect(JSON.stringify(result.body)).not.toContain("sk-secret");
  });

  it("a model returning prose twice becomes 502 INVALID_MODEL_OUTPUT", async () => {
    expect(await analyze(adapters({ model: scriptedModel("I think...", "Still prose") }))).toMatchObject({
      status: 502,
      body: { error: { code: "INVALID_MODEL_OUTPUT" } },
    });
  });

  it("a model whose citations all fail validation is a 200 with nothing unsupported shown", async () => {
    const fabricated = reply([{ type: "risk", title: "t", description: "d", citations: [{ sourceId: IDS.tracker, quote: "Status: Done" }] }]);
    const result = await analyze(adapters({ model: scriptedModel(fabricated) }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ findings: [], sources: [], validation: { droppedCitations: 1, droppedFindings: 1 } });
  });
});

describe("AnalysisStore contract", () => {
  it("saved analyses come back from latestAnalysis for the same user only", async () => {
    const backend = createBackend(adapters());
    const ran = await backend.analyze({ user, body: { accountId: "northstar" } });
    expect(await backend.latestAnalysis({ user, accountId: "northstar" })).toEqual({ status: 200, body: ran.body });
  });

  it("a failed save still returns the analysis; a failed load is 503", async () => {
    quiet();
    const analyses = { save: async () => Promise.reject(new Error("Cosmos down")), latest: async () => Promise.reject(new Error("Cosmos down")) };
    const backend = createBackend(adapters({ analyses }));
    expect((await backend.analyze({ user, body: { accountId: "northstar" } })).status).toBe(200);
    expect(await backend.latestAnalysis({ user, accountId: "northstar" })).toMatchObject({ status: 503, body: { error: { code: "INTEGRATION_UNAVAILABLE" } } });
  });
});

describe("TranscribeAudio contract", () => {
  const upload = { user, accountId: "northstar", audio: wav(), fileName: "meeting.wav" };

  it("diarized segments become a named transcript", async () => {
    checkTranscriptSegments(diarized);
    const result = await createBackend(adapters()).transcribe(upload);
    expect(result.body).toMatchObject({ origin: "azure-speech", transcript: "Speaker 1: Where are we on the launch?\nSpeaker 2: State tax is the open item." });
  });

  it("segments without diarization still produce a transcript", async () => {
    const plain = diarized.map(({ speaker: _s, ...rest }) => rest);
    const result = await createBackend(adapters({ transcribeAudio: async () => plain })).transcribe(upload);
    expect((result.body as TranscribeResponse).transcript).toBe("Where are we on the launch?\nState tax is the open item.");
  });

  it("an adapter that throws uses the prepared transcript only when requested", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await createBackend(adapters({ transcribeAudio: async () => Promise.reject(new Error("Speech 503")) })).transcribe({ ...upload, allowPreparedFallback: true });
    expect(result.body).toMatchObject({ origin: "prepared-fallback", transcript: NORTHSTAR_MEETING_TRANSCRIPT });
  });

  it("the segment check rejects malformed adapter output", () => {
    expect(() => checkTranscriptSegments([{ startMs: 5, endMs: 1, text: "x" }])).toThrow(/invalid times/);
    expect(() => checkTranscriptSegments([{ startMs: 5, endMs: 6, text: "a" }, { startMs: 1, endMs: 2, text: "b" }])).toThrow(/out of order/);
  });
});

describe("error boundaries", () => {
  it("signed out is 401, an inaccessible account is 404, and neither touches an adapter", async () => {
    const search = vi.fn(async () => [] as SourceRecord[]);
    const model = scriptedModel();
    const backend = createBackend(adapters({ sources: Object.assign(new InMemorySourceSearch(), { search }), model }));
    expect(await backend.analyze({ user: null, body: { accountId: "northstar" } })).toMatchObject({ status: 401, body: { error: { code: "UNAUTHENTICATED" } } });
    expect(await backend.analyze({ user, body: { accountId: "betaco" } })).toEqual({ status: 404, body: { error: { code: "NOT_FOUND", message: "Not found." } } });
    expect(await backend.latestAnalysis({ user, accountId: "betaco" })).toMatchObject({ status: 404 });
    expect(search).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
    expect(JSON.stringify(await backend.analyze({ user, body: { accountId: "betaco" } }))).not.toContain(BETACO_CANARY);
  });
});
