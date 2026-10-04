import { reportCitations } from "@deeproot/shared";
import type { ApiError, MeetingReport } from "@deeproot/shared";
import { ACCOUNTS, DEMO_USERS, SAMPLE_NORTHSTAR_REPORT } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { type CreateLinearIssueDeps, handleCreateLinearIssue } from "./createLinearIssue.js";
import { handleGetReport } from "./reports.js";
import { createBackend } from "../backend.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { ALL_SOURCES, scriptedModel } from "../testing/agent.js";

const presenter = { userId: DEMO_USERS.presenter };
let nextId = 0;

/** Models UUID uniqueness and separate queries/mutations rather than always returning a canned issue. */
function setup() {
  const report: MeetingReport = { ...structuredClone(SAMPLE_NORTHSTAR_REPORT), id: `report-${++nextId}` };
  const snapshot = { id: "evidence", accountId: "northstar", kind: "email" as const, title: "Evidence", author: "Maya", body: "Original evidence", occurredAt: report.createdAt };
  const reports = new InMemoryReportStore([{ ...report, citedSources: [snapshot] }]);
  const remote = new Map<string, { id: string; identifier: string; url: string }>();
  const inputs: Array<{ id: string; teamId: string; title: string; description: string; priority: number }> = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { query, variables } = JSON.parse(init!.body as string);
    if (query.includes("FindIssue")) return Response.json({ data: { issues: { nodes: remote.has(variables.id) ? [remote.get(variables.id)] : [] } } });
    const input = variables.input;
    inputs.push(input);
    if (remote.has(input.id)) return Response.json({ errors: [{ message: "UUID already exists" }] });
    const issue = { id: input.id, identifier: "DEE-1", url: "https://linear.app/deeproot/issue/DEE-1" };
    remote.set(input.id, issue);
    return Response.json({ data: { issueCreate: { success: true, issue } } });
  });
  const deps: CreateLinearIssueDeps = {
    reports, accounts: new InMemoryAccountDirectory(ACCOUNTS),
    linear: { apiKey: "test", teamId: "team-uuid", teamKey: "DEE", fetch: fetchMock as typeof fetch },
    appBaseUrl: "https://deeproot.example", pendingCreations: new Map(),
  };
  const body = { ticket: report.ticketDraft };
  const run = (d = deps, b = body) => handleCreateLinearIssue({ user: presenter, reportId: report.id, body: b }, d);
  return { report, reports, remote, inputs, fetchMock, deps, body, run, snapshot };
}

describe("POST /api/reports/:id/linear", () => {
  it("persists a reviewed draft and UUID, then saves one issue without losing evidence", async () => {
    const d = setup();
    const result = await d.run();
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ issue: { identifier: "DEE-1" }, alreadyCreated: false });
    expect(d.inputs).toHaveLength(1);
    expect(d.inputs[0]).toMatchObject({ teamId: "team-uuid", priority: 2 });
    expect(d.inputs[0]!.id).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]{21}$/);
    expect(d.inputs[0]!.description).toContain(`https://deeproot.example/?report=${d.report.id}`);
    expect(d.inputs[0]!.description).toContain("- [ ] Pennsylvania local earned income tax has PSD codes");
    expect(d.inputs[0]!.description).not.toContain("Can you confirm who on your team");
    expect((await d.reports.get(d.report.id))?.citedSources).toEqual([d.snapshot]);
    expect((await d.reports.get(d.report.id))?.linearIssue?.identifier).toBe("DEE-1");
  });

  it("returns the stored issue on a retry and coalesces a double click", async () => {
    const d = setup();
    const [a, b] = await Promise.all([d.run(), d.run()]);
    expect(a.body).toMatchObject({ issue: { identifier: "DEE-1" } });
    expect(b.body).toMatchObject({ issue: { identifier: "DEE-1" } });
    expect(d.inputs).toHaveLength(1);
    expect(await d.run()).toMatchObject({ status: 200, body: { alreadyCreated: true } });
    expect(d.inputs).toHaveLength(1);
  });

  it("uses the edited draft and permits an empty description", async () => {
    const d = setup();
    await d.run(d.deps, { ticket: { ...d.body.ticket, title: "Reviewed title", description: "", priority: "medium" } });
    expect(d.inputs[0]).toMatchObject({ title: "Reviewed title", priority: 3 });
    expect((await d.reports.get(d.report.id))?.ticketDraft.title).toBe("Reviewed title");
  });

  it("requires sign-in and hides inaccessible reports before touching Linear", async () => {
    const d = setup();
    expect(await handleCreateLinearIssue({ user: null, reportId: d.report.id, body: d.body }, d.deps)).toMatchObject({ status: 401 });
    const forbidden = await handleCreateLinearIssue({ user: { userId: "outsider" }, reportId: d.report.id, body: d.body }, d.deps);
    const missing = await handleCreateLinearIssue({ user: presenter, reportId: "missing", body: d.body }, d.deps);
    expect(forbidden).toEqual(missing);
    expect(forbidden.status).toBe(404);
    expect(d.fetchMock).not.toHaveBeenCalled();
  });

  it("validates acceptance criteria without reserving an invalid draft", async () => {
    const d = setup();
    expect((await d.run(d.deps, { ticket: { ...d.body.ticket, acceptanceCriteria: [" "] } })).status).toBe(400);
    expect((await d.reports.get(d.report.id))?.linearCreation).toBeUndefined();
    expect(d.fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a pending attempt and withholds manual creation after GraphQL errors", async () => {
    const d = setup();
    d.deps.linear!.fetch = async () => Response.json({ errors: [{ message: "Authentication required" }] });
    const result = await d.run();
    expect(result.status).toBe(503);
    expect((result.body as ApiError).error.fallbackUrl).toBeUndefined();
    const saved = await handleGetReport({ user: presenter, reportId: d.report.id }, d.deps);
    expect(saved.body).toMatchObject({ report: { linearIssueStatus: "pending" } });
    expect(JSON.stringify(saved.body)).not.toMatch(/linearCreation|issueId|team-uuid/);
  });

  it("offers a prefilled fallback only when there is no existing attempt and Linear is unconfigured", async () => {
    const d = setup();
    d.deps.linear = null;
    expect((await d.run()).body).toMatchObject({ error: { fallbackUrl: expect.stringMatching(/^https:\/\/linear.new\?/) } });
    expect((await d.reports.get(d.report.id))?.linearCreation).toBeUndefined();
  });

  it("reconciles remote success after the report result failed to persist, including after restart", async () => {
    const d = setup();
    vi.spyOn(d.reports, "completeLinearCreation").mockRejectedValueOnce(new Error("Cosmos unavailable"));
    expect((await d.run()).status).toBe(503);
    const restarted = { ...d.deps, pendingCreations: new Map<string, Promise<{ identifier: string; url: string }>>() };
    expect(await d.run(restarted)).toMatchObject({ status: 200, body: { issue: { identifier: "DEE-1" } } });
    expect(d.inputs).toHaveLength(1);
    expect(d.remote.size).toBe(1);
  });

  it("reconciles a lost mutation response without creating a new identity", async () => {
    const d = setup();
    const realFetch = d.deps.linear!.fetch!;
    d.deps.linear!.fetch = async (url, init) => {
      const response = await realFetch(url, init);
      if (JSON.parse(init!.body as string).query.includes("IssueCreate")) throw new Error("Response lost");
      return response;
    };
    expect((await d.run()).status).toBe(201);
    expect(d.remote.size).toBe(1);
    expect(d.inputs).toHaveLength(1);
  });

  it("retries a failed mutation with its original UUID and accepted draft", async () => {
    const d = setup();
    const realFetch = d.deps.linear!.fetch!;
    let failed = false;
    d.deps.linear!.fetch = async (url, init) => {
      if (!failed && JSON.parse(init!.body as string).query.includes("IssueCreate")) { failed = true; throw new Error("offline"); }
      return realFetch(url, init);
    };
    expect((await d.run()).status).toBe(503);
    const identity = (await d.reports.get(d.report.id))!.linearCreation!.issueId;
    expect((await d.run(d.deps, { ticket: { ...d.body.ticket, title: "Do not replace accepted draft" } })).status).toBe(200);
    expect(d.inputs[0]!.id).toBe(identity);
    expect(d.inputs[0]!.title).toBe(d.body.ticket.title);
  });

  it("coordinates independent backend instances sharing storage", async () => {
    const d = setup();
    const adapters = { accounts: d.deps.accounts, reports: d.reports, sources: new InMemorySourceSearch([...ALL_SOURCES, ...reportCitations(d.report).map(c => ({ id: c.sourceId, accountId: "northstar", kind: "meeting" as const, title: "Fixture evidence", author: "Presenter", occurredAt: d.report.createdAt, body: c.quote, allowedUserIds: ["presenter"] })), { ...d.snapshot, allowedUserIds: ["presenter"] }]), analyses: new InMemoryAnalysisStore(), model: scriptedModel(), transcribeAudio: async () => [] };
    const options = { linear: d.deps.linear, appBaseUrl: d.deps.appBaseUrl };
    const a = createBackend(adapters, options);
    const b = createBackend(adapters, options);
    const results = await Promise.all([a.createLinearIssue({ user: presenter, reportId: d.report.id, body: d.body }), b.createLinearIssue({ user: presenter, reportId: d.report.id, body: d.body })]);
    expect(results.every((r) => r.status < 300)).toBe(true);
    expect(d.remote.size).toBe(1);
    expect(new Set(d.inputs.map((i) => i.id)).size).toBe(1);
  });

  it("blocks team changes and manual fallback while an attempt is pending", async () => {
    const d = setup();
    await d.reports.reserveLinearCreation(d.report.id, { issueId: crypto.randomUUID(), teamId: "original-team", ticket: d.body.ticket, description: "original" });
    expect((await d.run()).status).toBe(503);
    d.deps.linear = null;
    expect((await d.run()).body).toMatchObject({ error: { code: "INTEGRATION_UNAVAILABLE" } });
    expect(((await d.run()).body as ApiError).error.fallbackUrl).toBeUndefined();
    expect(d.fetchMock).not.toHaveBeenCalled();
  });
});
