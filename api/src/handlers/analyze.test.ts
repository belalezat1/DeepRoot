import { ACCOUNTS, DEMO_USERS } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import type { AnalyzeDeps } from "../agent/analyze.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { InMemoryAccountDirectory } from "../store/reports.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { ALL_SOURCES, IDS, QUOTES, reply, scriptedModel } from "../testing/agent.js";
import { handleAnalyze, handleGetLatestAnalysis } from "./analyze.js";

const user = { userId: DEMO_USERS.presenter };
const deps = (model = scriptedModel(reply([]))): AnalyzeDeps => ({
  accounts: new InMemoryAccountDirectory(ACCOUNTS),
  search: new InMemorySourceSearch(ALL_SOURCES),
  model,
  analyses: new InMemoryAnalysisStore(),
});

describe("POST /api/agent/analyze", () => {
  it("returns 200 with grounded findings", async () => {
    const model = scriptedModel(
      reply([{ type: "blocker", title: "Blocked", description: "d", severity: "high", citations: [{ sourceId: IDS.tracker, quote: QUOTES.trackerBlocked }] }]),
    );
    const result = await handleAnalyze({ user, body: { accountId: "northstar" } }, deps(model));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accountId: "northstar", findings: [{ type: "blocker", severity: "high" }] });
  });

  it("validates the body", async () => {
    for (const body of [null, {}, { accountId: 5 }, { accountId: "northstar", focus: 3 }, { accountId: "northstar", focus: "x".repeat(301) }]) {
      expect((await handleAnalyze({ user, body }, deps())).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("uses the shared error shape for auth and access failures", async () => {
    expect(await handleAnalyze({ user: null, body: { accountId: "northstar" } }, deps())).toMatchObject({
      status: 401,
      body: { error: { code: "UNAUTHENTICATED" } },
    });
    expect(await handleAnalyze({ user, body: { accountId: "betaco" } }, deps())).toMatchObject({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Not found." } },
    });
  });

  it("maps a model outage to 503 and a malformed reply to 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await handleAnalyze({ user, body: { accountId: "northstar" } }, deps(scriptedModel(new Error("ECONNRESET"))));
    expect(down).toMatchObject({ status: 503, body: { error: { code: "INTEGRATION_UNAVAILABLE" } } });
    const garbled = await handleAnalyze({ user, body: { accountId: "northstar" } }, deps(scriptedModel("nope", "nope")));
    expect(garbled).toMatchObject({ status: 502, body: { error: { code: "INVALID_MODEL_OUTPUT" } } });
  });

  it("hides isolation failures behind a generic 500 that names no account or source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = { ...deps(), search: { search: async () => ALL_SOURCES } }; // a Search filter bug
    const result = await handleAnalyze({ user, body: { accountId: "northstar" } }, leaky);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toMatch(/betaco/i);
  });
});

describe("GET /api/accounts/:id/analysis", () => {
  it("returns the latest analysis after one has run, and 404 before", async () => {
    const d = deps(scriptedModel(reply([{ type: "fact", title: "t", description: "d", citations: [{ sourceId: IDS.tracker, quote: QUOTES.trackerBlocked }] }])));
    expect((await handleGetLatestAnalysis({ user, accountId: "northstar" }, d)).status).toBe(404);
    const ran = await handleAnalyze({ user, body: { accountId: "northstar" } }, d);
    expect(await handleGetLatestAnalysis({ user, accountId: "northstar" }, d)).toEqual({ status: 200, body: ran.body });
  });

  it("checks access first", async () => {
    expect((await handleGetLatestAnalysis({ user: null, accountId: "northstar" }, deps())).status).toBe(401);
    expect((await handleGetLatestAnalysis({ user, accountId: "betaco" }, deps())).status).toBe(404);
  });
});
