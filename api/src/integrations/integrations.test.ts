import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS } from "@deeproot/demo";
import type { DemoAppRecord, IntegrationStatus, IntegrationsResponse } from "@deeproot/shared";
import { createBackend } from "../backend.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { InMemoryIntegrationStore } from "./store.js";
import { buildSeedSources } from "../ingest/seed.js";
import { INTERNAL_APP_CONNECTORS, IMPLEMENTATION_TRACKER } from "../ingest/connectors/index.js";
import { ingestInternalAppRecords } from "../ingest/internal-app.js";
import { integrationConfig, type IntegrationConfig } from "./config.js";
import { scriptedModel } from "../testing/agent.js";

const user = { userId: "presenter" }; const input = { user, accountId: "northstar", appId: "impl-tracker" };
const config = (): IntegrationConfig => ({ demoEnabled: true, demoAccounts: ["northstar"], demoToken: "test-token-for-demo-export", http: { "impl-tracker": { url: "http://localhost:7071/api/demo-apps/impl-tracker/export", token: "test-token-for-demo-export", sample: true } } });
let server: Server | undefined;
afterEach(async () => { vi.unstubAllGlobals(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });
function setup(c = config(), store = new InMemoryIntegrationStore()) {
  const sources = new InMemorySourceSearch(buildSeedSources()); const model = scriptedModel();
  const backend = createBackend({ sources, model, integrationStore: store, accounts: new InMemoryAccountDirectory(ACCOUNTS), reports: new InMemoryReportStore(), analyses: new InMemoryAnalysisStore(), transcribeAudio: async () => [] }, { integrationConfig: c });
  return { sources, model, backend, store };
}
async function upstream(d: ReturnType<typeof setup>, c: IntegrationConfig) {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const result = await d.backend.integrations.export({ appId: "impl-tracker", customerKey: url.searchParams.get("customerKey") ?? "", token: req.headers.authorization?.replace(/^Bearer /, "") ?? "" });
    res.writeHead(result.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(result.body));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number }; c.http["impl-tracker"]!.url = `http://127.0.0.1:${address.port}/export`;
}

describe("sample systems and HTTP connector", () => {
  it("removes a fixture deleted before the first sync and rejects Unicode credentials safely", async () => {
    const c = config(); const d = setup(c); await upstream(d, c);
    const rows = (await d.backend.integrations.demoRecords(input)).body as { records: DemoAppRecord[] };
    const record = rows.records[0]!;
    expect((await d.backend.integrations.delete({ ...input, recordId: record.id, body: { revision: record.revision } })).status).toBe(200);
    expect((await d.backend.integrations.sync(input)).status).toBe(200);
    expect(await d.sources.get("northstar", "northstar-impl-tracker-it-5120")).toBeNull();
    expect((await d.backend.integrations.export({ appId: input.appId, customerKey: "C-3107", token: "é".repeat(c.demoToken!.length) })).status).toBe(404);
  });
  it("keeps upstream edits separate, pulls them over HTTP, and updates the authoritative source", async () => {
    const c = config(); const d = setup(c); await upstream(d, c);
    const rows = (await d.backend.integrations.demoRecords(input)).body as { records: DemoAppRecord[] }; const record = rows.records[0]!;
    expect((await d.sources.get("northstar", "northstar-impl-tracker-it-5120"))?.body).toContain("Assignee: Unassigned");
    expect((await d.backend.integrations.edit({ ...input, recordId: record.id, body: { revision: record.revision, changes: { status: "In progress", assignee: "Sam" } } })).status).toBe(200);
    expect((await d.sources.get("northstar", "northstar-impl-tracker-it-5120"))?.body).toContain("Assignee: Unassigned");
    const sync = await d.backend.integrations.sync(input); expect(sync.status).toBe(200);
    expect((sync.body as IntegrationStatus).changedSourceIds).toContain("northstar-impl-tracker-it-5120");
    expect((await d.sources.get("northstar", "northstar-impl-tracker-it-5120"))?.body).toContain("Assignee: Sam");
    const repeated = await d.backend.integrations.sync(input); expect((repeated.body as IntegrationStatus).changedSourceIds).toEqual([]);
    const status = (await d.backend.integrations.list({ user, accountId: "northstar" })).body as IntegrationsResponse;
    expect(status.integrations[0]?.lastSuccessfulSync).toBeTruthy(); expect(JSON.stringify(status)).not.toMatch(/test-token|indexedSourceIds/);
  });
  it("coalesces simultaneous syncs and bounds ingestion to eight writes", async () => {
    const d = setup(); let active = 0, peak = 0;
    const raw = Array.from({ length: 25 }, (_, i) => ({ ticket_id: String(i), customer: { code: "C-3107" }, summary: "Dependency", status: "Blocked", updated_at: "2026-10-04" }));
    const fetch = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ records: raw }); }); vi.stubGlobal("fetch", fetch);
    const save = d.sources.save.bind(d.sources); vi.spyOn(d.sources, "save").mockImplementation(async s => { peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); await save(s); active--; });
    const results = await Promise.all([d.backend.integrations.sync(input), d.backend.integrations.sync(input)]);
    expect(results.every(r => r.status === 200)).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); expect(peak).toBe(8);
  });
  it("preserves the last successful sync after partial indexing failure and allows stable-ID retry", async () => {
    const d = setup(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ records: [{ ticket_id: "R1", customer: { code: "C-3107" }, summary: "Dependency", status: "Blocked", updated_at: "2026-10-04" }] })));
    const first = (await d.backend.integrations.sync(input)).body as IntegrationStatus;
    const save = vi.spyOn(d.sources, "save").mockRejectedValueOnce(new Error("Search document failed"));
    const failed = await d.backend.integrations.sync(input); expect(failed.status).toBe(503);
    expect((failed.body as IntegrationStatus).lastSuccessfulSync).toBe(first.lastSuccessfulSync); expect((failed.body as IntegrationStatus).state).toBe("failed");
    save.mockRestore(); expect((await d.backend.integrations.sync(input)).status).toBe(200);
  });
  it("persists raw records and receipts across backend instances and rejects stale edits", async () => {
    const c = config(), store = new InMemoryIntegrationStore(); const a = setup(c, store), b = setup(c, store);
    const record = ((await a.backend.integrations.demoRecords(input)).body as { records: DemoAppRecord[] }).records[0]!;
    const edit = { ...input, recordId: record.id, body: { revision: 0, changes: { assignee: "Sam" } } };
    const outcomes = await Promise.all([a.backend.integrations.edit(edit), b.backend.integrations.edit(edit)]);
    expect(outcomes.map(r => r.status).sort()).toEqual([200, 400]);
    expect(((await b.backend.integrations.demoRecords(input)).body as { records: DemoAppRecord[] }).records[0]?.raw.assignee).toBe("Sam");
  });
  it("supports creation/deletion and removes deleted upstream records after synchronization", async () => {
    const c = config(), d = setup(c); await upstream(d, c);
    const made = await d.backend.integrations.create({ ...input, body: { title: "Confirm implementation readiness" } }); expect(made.status).toBe(201);
    const record = (made.body as { record: DemoAppRecord }).record;
    await d.backend.integrations.sync(input);
    const id = `northstar-impl-tracker-${record.id.toLowerCase()}`;
    expect(await d.sources.get("northstar", id)).not.toBeNull();
    expect((await d.backend.integrations.delete({ ...input, recordId: record.id, body: { revision: record.revision } })).status).toBe(200);
    expect((await d.backend.integrations.sync(input)).status).toBe(200); expect(await d.sources.get("northstar", id)).toBeNull();
  });
  it("hides disabled sample tools, unauthorized accounts, bad credentials, and forbidden edit fields", async () => {
    const d = setup(); expect((await d.backend.integrations.demoRecords({ ...input, accountId: "betaco" })).status).toBe(404);
    expect((await d.backend.integrations.export({ appId: input.appId, customerKey: "C-3107", token: "wrong" })).status).toBe(404);
    expect((await d.backend.integrations.edit({ ...input, recordId: "IT-5120", body: { revision: 0, changes: { allowedUserIds: ["attacker"] } } })).status).toBe(400);
    const off = setup({ ...config(), demoEnabled: false }); expect((await off.backend.integrations.demoRecords(input)).status).toBe(404);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect((await d.backend.integrations.sync({ ...input, accountId: "betaco" })).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unsafe URL configuration and requires credentials for enabled sample APIs", () => {
    expect(() => integrationConfig({ ENABLE_DEMO_APPS: "true" })).toThrow(/TOKEN/);
    for (const url of ["http://internal.example/export", "https://user:password@example.com/export"]) expect(() => integrationConfig({ CONNECTOR_HTTP_JSON: JSON.stringify({ "impl-tracker": { url, tokenEnv: "KEY" } }), KEY: "secret" })).toThrow(/HTTPS/);
  });
});

describe("trusted upstream permissions and classification", () => {
  it("keeps newer content while intersecting ACLs from a stale export", async () => {
    const source = buildSeedSources().find(s => s.id === "northstar-impl-tracker-it-5120")!;
    const sources = new InMemorySourceSearch([{ ...source, occurredAt: "2026-10-05", allowedUserIds: ["presenter", "reviewer"] }]);
    await sources.save({ ...source, occurredAt: "2026-10-04", body: "Stale content", allowedUserIds: ["reviewer", "attacker"] });
    expect(await sources.get("northstar", source.id)).toMatchObject({ body: source.body, allowedUserIds: ["reviewer"] });
    expect(await sources.search({ accountId: "northstar", userId: "presenter", query: "", top: 20 })).toEqual([]);
  });
  const c = { ...IMPLEMENTATION_TRACKER, permissions: { path: "readers", users: { upstreamSam: "presenter", outsider: "external" } }, classification: { path: "classification", deliveryValues: ["delivery"] } };
  const raw = { ticket_id: "secure", customer: { code: "C-3107" }, summary: "Delivery status", status: "Blocked", updated_at: "2026-10-04", readers: ["upstreamSam", "outsider"], classification: "delivery" };
  it("maps document ACLs and intersects them with the account team", () => {
    const result = ingestInternalAppRecords(c, [raw], ACCOUNTS); expect(result.records[0]?.allowedUserIds).toEqual(["presenter"]); expect(result.records[0]?.policy?.accessMode).toBe("source");
  });
  it.each([{ readers: [] }, { readers: ["unknown"] }, { readers: ["outsider"] }, { classification: "personal_payroll" }])("rejects missing, unknown, external-only, or sensitive permissions: %j", change => {
    expect(ingestInternalAppRecords(c, [{ ...raw, ...change }], ACCOUNTS).records).toEqual([]);
  });
  it("revokes a previously indexed record when its upstream ACL becomes invalid", async () => {
    const settings = config(); const sources = new InMemorySourceSearch(); const store = new InMemoryIntegrationStore();
    const backend = createBackend({ sources, integrationStore: store, model: scriptedModel(), reports: new InMemoryReportStore(), accounts: new InMemoryAccountDirectory(ACCOUNTS), analyses: new InMemoryAnalysisStore(), transcribeAudio: async () => [] }, { connectors: [c, ...INTERNAL_APP_CONNECTORS.filter(x => x.appId !== c.appId)], integrationConfig: settings });
    let records = [raw]; vi.stubGlobal("fetch", vi.fn(async () => Response.json({ records })));
    expect((await backend.integrations.sync(input)).status).toBe(200); expect(await sources.get("northstar", "northstar-impl-tracker-secure")).not.toBeNull();
    records = [{ ...raw, readers: [] }]; expect((await backend.integrations.sync(input)).status).toBe(503); expect(await sources.get("northstar", "northstar-impl-tracker-secure")).toBeNull();
  });
});
