import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "@deeproot/demo";
import type { SourceRecord, MeetingReport } from "@deeproot/shared";
import { createBackend } from "../backend.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { scriptedModel } from "../testing/agent.js";
import { AuthoritativeSourceSearch } from "../adapters/authoritativeSearch.js";
import { toPublicSource } from "../store/publicSources.js";

const user = { userId: "presenter" };
const source: SourceRecord = { id: "record", accountId: "northstar", kind: "internal_app", title: "Dependency", author: "Team", occurredAt: "2026-10-01T00:00:00Z", body: "Assignee: Unassigned", allowedUserIds: ["presenter"], policy: { classification: "delivery", accessMode: "source" } };
function setup() {
  const sources = new InMemorySourceSearch([source]); const reports = new InMemoryReportStore(); const analyses = new InMemoryAnalysisStore();
  const model = scriptedModel();
  const backend = createBackend({ sources, reports, analyses, model, accounts: new InMemoryAccountDirectory(ACCOUNTS), transcribeAudio: async () => [] });
  return { sources, reports, analyses, model, backend };
}
const report: MeetingReport = { id: "saved", accountId: "northstar", transcript: "Discussed ownership.", summary: "No owner assigned.", decisions: [], commitments: [], risks: [{ text: "No owner assigned.", citations: [{ sourceId: source.id, quote: source.body }] }], openQuestions: [], suggestedFollowUp: "", ticketDraft: { title: "Confirm owner", description: "", acceptanceCriteria: ["Review assignment"], priority: "medium" }, createdAt: source.occurredAt, createdBy: user.userId };

describe("authoritative evidence and historical snapshots", () => {
  it("reads permitted sources, keeps metadata private, and hides missing and denied records equally", async () => {
    const d = setup(); const read = await d.backend.getSource({ user, accountId: "northstar", sourceId: source.id });
    expect(read).toMatchObject({ status: 200, body: { source: { version: expect.any(String) } } });
    expect(JSON.stringify(read.body)).not.toMatch(/allowedUserIds|policy|accessMode/);
    await d.sources.save({ ...source, allowedUserIds: ["other"] });
    const denied = await d.backend.getSource({ user, accountId: "northstar", sourceId: source.id });
    expect(denied).toEqual(await d.backend.getSource({ user, accountId: "northstar", sourceId: "missing" }));
    expect(denied.status).toBe(404);
  });
  it("returns a historical report snapshot while current content changes, but stops after access revocation", async () => {
    const d = setup(); const snapshot = toPublicSource(source);
    await d.reports.save({ ...report, citedSources: [snapshot] });
    await d.sources.save({ ...source, body: "Assignee: Sam", occurredAt: "2026-10-04T00:00:00Z" });
    const read = await d.backend.getSource({ user, accountId: "northstar", sourceId: source.id, reportId: report.id, version: snapshot.version });
    expect(read).toMatchObject({ status: 200, body: { source: { body: source.body } } });
    expect((await d.backend.getSource({ user, accountId: "northstar", sourceId: source.id, version: snapshot.version })).status).toBe(404);
    await d.sources.save({ ...source, occurredAt: "2026-10-05T00:00:00Z", allowedUserIds: [] });
    expect((await d.backend.getReport({ user, reportId: report.id })).status).toBe(404);
    expect((await d.backend.createLinearIssue({ user, reportId: report.id, body: { ticket: report.ticketDraft } })).status).toBe(404);
    expect((await d.backend.chat({ user, body: { accountId: "northstar", question: "Who owns it?", reportId: report.id } })).status).toBe(404);
    expect(d.model.calls.length).toBe(0);
  });
  it("does not return a cached analysis after a source loses permission", async () => {
    const d = setup(); await d.analyses.save({ id: "a", accountId: "northstar", createdBy: "presenter", generatedAt: source.occurredAt, summary: "Old private status", findings: [], sources: [toPublicSource(source)], analyzedSourceIds: [source.id], validation: { droppedCitations: 0, droppedFindings: 0 } });
    await d.sources.remove("northstar", source.id);
    expect((await d.backend.latestAnalysis({ user, accountId: "northstar" })).status).toBe(404);
  });
  it("hydrates current content and ACLs when Search still contains stale documents", async () => {
    const index = new InMemorySourceSearch([source]); const truth = new InMemorySourceSearch([source]);
    const search = new AuthoritativeSourceSearch(index, truth);
    await truth.save({ ...source, body: "Assignee: Sam", occurredAt: "2026-10-04" });
    expect((await search.search({ accountId: "northstar", userId: "presenter", query: "", top: 10 }))[0]?.body).toBe("Assignee: Sam");
    await truth.save({ ...source, occurredAt: "2026-10-05", allowedUserIds: [] });
    expect(await search.search({ accountId: "northstar", userId: "presenter", query: "", top: 10 })).toEqual([]);
  });
});
