import { describe, expect, it } from "vitest";
import { ACCOUNTS, BETACO_CANARY } from "@deeproot/demo";
import { createBackend } from "../backend.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { createReportGenerator } from "./generator.js";
import { scriptedModel } from "../testing/agent.js";
import type { ReportResponse } from "@deeproot/shared";

const draft = (quote: string, sourceId: string) => ({
  summary: quote, decisions: [], risks: [], openQuestions: ["Who owns this?"], suggestedFollowUp: "Confirm ownership.",
  commitments: [{ text: quote, owner: null, dueDate: null, citations: [{ sourceId, quote }] }],
  ticketDraft: { title: "Confirm follow-up", description: "", acceptanceCriteria: ["Confirm the next step with the client"], priority: "medium" },
});

describe("live report generator", () => {
  it("drops removed commitments, historical meeting context, and unsupported ticket wording", async () => {
    const transcript = "Sam: We have not committed to a delivery date or assigned a task.";
    const current = { id: "current", accountId: "northstar", kind: "meeting" as const, body: transcript, title: "Meeting", author: "Sam", occurredAt: "2026-10-04", allowedUserIds: ["presenter"] };
    const historical = { ...current, id: "old", body: "Sam will ship on October 8.", occurredAt: "2026-10-03" };
    const requests: string[] = [];
    const model = { complete: async ({ user, system }: { user: string; system: string }) => {
      requests.push(user);
      if (system.includes("phase: evidence verification")) {
        const { candidates } = JSON.parse(user);
        return JSON.stringify({ results: candidates.map((c: { id: string }) => ({ id: c.id, verdict: "uncertain", citations: [] })) });
      }
      return JSON.stringify({ ...draft(transcript, current.id), summary: "Sam will ship on October 8.", commitments: [{ text: "Sam will ship on October 8.", owner: "Sam", dueDate: "2026-10-08", citations: [{ sourceId: current.id, quote: transcript }] }, { text: historical.body, owner: "Sam", dueDate: "2026-10-08", citations: [{ sourceId: historical.id, quote: historical.body }] }] });
    } };
    const result = await createReportGenerator(model)({ account: { id: "northstar", name: "Northstar" }, userId: "presenter", transcript, meetingSourceId: current.id, meetingDate: current.occurredAt, sources: [current, historical] });
    expect(JSON.parse(requests[0]!).records.map((r: { id: string }) => r.id)).toEqual([current.id]);
    expect(result.commitments).toEqual([]); expect(result.ticketStatus).toBe("none");
    expect(result.ticketDraft.acceptanceCriteria).toEqual([]); expect(result.suggestedFollowUp).toBe("");
    expect(result.summary).not.toContain("October 8");
  });
  it("uses the configured model and complete reviewed transcript, and saves validated citations", async () => {
    const prompts: string[] = [];
    const backend = createBackend({
      accounts: new InMemoryAccountDirectory(ACCOUNTS), sources: new InMemorySourceSearch(),
      analyses: new InMemoryAnalysisStore(), reports: new InMemoryReportStore(), transcribeAudio: async () => [],
      model: { complete: async ({ user, system }) => {
        if (system.includes("phase: evidence verification")) { const { candidates } = JSON.parse(user); return JSON.stringify({ results: candidates.map((c: { id: string; citations: unknown[] }) => ({ id: c.id, verdict: c.citations.length ? "supported" : "uncertain", citations: c.citations })) }); }
        prompts.push(user);
        const records = JSON.parse(user).records;
        const meeting = records[0];
        return JSON.stringify(draft(meeting.body.slice(-36), meeting.id));
      } },
    });
    const tail = "We will confirm the next step today.";
    const transcript = `${"Reviewed context. ".repeat(400)}${tail}`;
    const a = await backend.createReport({ user: { userId: "presenter" }, body: { accountId: "northstar", transcript } });
    const b = await backend.createReport({ user: { userId: "presenter" }, body: { accountId: "northstar", transcript: "We will review a different milestone." } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(JSON.parse(prompts[0]!).records[0].body).toBe(transcript);
    const report = (a.body as ReportResponse).report;
    expect(report.commitments[0]).toMatchObject({ owner: null, dueDate: null });
    expect(report.commitments[0]!.citations[0]!.startOffset).toBeTypeOf("number");
    expect((b.body as ReportResponse).report.summary).not.toBe(report.summary);
    expect(prompts.join(" ")).not.toContain(BETACO_CANARY);
  });

  it("retries malformed shapes once and fails cleanly on outage or unusable output", async () => {
    const input = { account: { id: "northstar", name: "Northstar" }, transcript: "A reviewed meeting.", meetingSourceId: "m", meetingDate: "2026-10-03", sources: [{ id: "m", accountId: "northstar", kind: "meeting" as const, body: "A reviewed meeting.", title: "Meeting", author: "Presenter", occurredAt: "2026-10-03", allowedUserIds: ["presenter"] }] };
    const model = scriptedModel("{}", JSON.stringify(draft("A reviewed meeting.", "m")));
    expect((await createReportGenerator(model)(input)).summary).toBe("A reviewed meeting.");
    expect(model.calls).toHaveLength(2);
    await expect(createReportGenerator(scriptedModel("not json", "[]"))(input)).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    const outage = scriptedModel(new Error("model offline"));
    await expect(createReportGenerator(outage)(input)).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    expect(outage.calls).toHaveLength(1);
  });
});
