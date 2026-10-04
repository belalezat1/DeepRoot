import { describe, expect, it, vi } from "vitest";
import { ACCOUNTS } from "@deeproot/demo";
import type { ChatResponse, ClaimCheckResponse, SourceRecord } from "@deeproot/shared";
import { createBackend } from "../backend.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import type { ChatModel, ChatModelRequest } from "../agent/model.js";

const source: SourceRecord = { id: "tracker", accountId: "northstar", kind: "internal_app", title: "Tracker", body: "Status: Blocked\nAssignee: Sam", author: "Team", occurredAt: "2026-10-04", allowedUserIds: ["presenter"] };
const citation = { sourceId: source.id, quote: "Assignee: Sam" };
const user = { userId: "presenter" };
function setup(complete: ChatModel["complete"], records = [source]) {
  const sources = new InMemorySourceSearch(records); const model = { complete: vi.fn(complete) };
  const backend = createBackend({ sources, model, accounts: new InMemoryAccountDirectory(ACCOUNTS), analyses: new InMemoryAnalysisStore(), reports: new InMemoryReportStore(), transcribeAudio: async () => [] });
  return { sources, model, backend };
}
const scope = { scope: "allowed", queries: ["assignment"], spans: [] };
const json = JSON.stringify;

describe("bounded evidence investigator", () => {
  it("refuses a semantic privacy request before retrieving any records", async () => {
    const d = setup(async () => json({ scope: "restricted" })); const search = vi.spyOn(d.sources, "search");
    const result = await d.backend.chat({ user, body: { accountId: "northstar", question: "What does she receive each month?" } });
    expect(result.body).toMatchObject({ responseType: "restricted", citations: [] }); expect(search).not.toHaveBeenCalled(); expect(d.model.complete).toHaveBeenCalledTimes(1);
  });
  it("searches a second round, ignores injected tool/account arguments, and verifies the final answer", async () => {
    const calls: ChatModelRequest[] = [];
    const d = setup(async req => {
      calls.push(req); const data = JSON.parse(req.user);
      if (req.system.includes("scope/planning")) return json({ ...scope, queries: ["assignment", "owner", "extra"], accountId: "betaco", tool: "createIssue" });
      if (req.system.includes("evidence verification")) return json({ results: data.candidates.map((c: { id: string; citations: unknown[] }) => ({ id: c.id, verdict: "supported", citations: c.citations })) });
      return json({ answer: "Sam is assigned.", grounded: true, citations: [citation], nextQueries: req.system.includes("final synthesis") ? ["ignored"] : ["Sam", "ticket", "extra"] });
    }); const search = vi.spyOn(d.sources, "search");
    const response = (await d.backend.chat({ user, body: { accountId: "northstar", question: "Who owns the dependency?" } })).body as ChatResponse;
    expect(response.grounded).toBe(true); expect(calls.length).toBe(4); expect(search).toHaveBeenCalledTimes(5);
    expect(search.mock.calls.every(([req]) => req.accountId === "northstar" && req.userId === "presenter")).toBe(true);
    expect(response.steps?.filter(s => s.action === "search")).toHaveLength(5);
    expect(response.citations[0]?.sourceVersion).toBeTruthy();
  });
  it("rejects an unrelated genuine quote instead of accepting citation existence as support", async () => {
    const d = setup(async req => req.system.includes("scope/planning") ? json(scope) : req.system.includes("evidence verification") ? json({ results: [{ id: "0", verdict: "uncertain", citations: [citation] }] }) : json({ answer: "All tax configuration is complete.", grounded: true, citations: [citation] }));
    expect((await d.backend.chat({ user, body: { accountId: "northstar", question: "Is setup complete?" } })).body).toMatchObject({ grounded: false, responseType: "not_found" });
  });
  it("checks every clause and suppresses an unsupported rewrite", async () => {
    const statement = "Sam owns setup. Everything is complete.";
    const d = setup(async req => {
      const data = JSON.parse(req.user);
      if (req.system.includes("scope/planning")) return json({ ...scope, spans: [{ start: 0, end: 16 }, { start: 16, end: statement.length }] });
      if (req.system.includes("evidence verification")) return json({ results: data.candidates.map((c: { id: string; citations: unknown[] }) => ({ id: c.id, verdict: c.id === "0" ? "supported" : c.id === "1" ? "contradicted" : "uncertain", explanation: "Evidence checked", citations: c.citations })) });
      return json({ claimResults: [{ claim: statement.slice(0, 16).trim(), citations: [citation] }, { claim: statement.slice(16).trim(), citations: [{ sourceId: source.id, quote: "Status: Blocked" }] }], suggestedRewrite: "Jordan guarantees completion tomorrow." });
    });
    const response = (await d.backend.checkClaim({ user, body: { accountId: "northstar", statement } })).body as ClaimCheckResponse;
    expect(response.verdict).toBe("contradicted"); expect(response.claimResults?.map(c => c.verdict)).toEqual(["supported", "contradicted"]); expect(response.suggestedRewrite).toBe("");
  });
  it("checks the whole statement if decomposition omits a clause", async () => {
    const statement = "Sam owns setup. Nobody has confirmed a date.";
    const d = setup(async req => {
      const data = JSON.parse(req.user);
      if (req.system.includes("scope/planning")) return json({ ...scope, spans: [{ start: 0, end: 16 }] });
      if (req.system.includes("evidence verification")) return json({ results: data.candidates.map((c: { id: string; citations: unknown[] }) => ({ id: c.id, verdict: "uncertain", citations: c.citations })) });
      return json({ citations: [citation], suggestedRewrite: "" });
    });
    const response = (await d.backend.checkClaim({ user, body: { accountId: "northstar", statement } })).body as ClaimCheckResponse;
    expect(response.claimResults?.[0]?.claim).toBe(statement); expect(response.verdict).toBe("uncertain");
  });
  it("rejects oversized checks and malformed scope decisions before retrieval", async () => {
    for (const reply of [{ ...scope, oversized: true }, { scope: "administrator" }]) {
      const d = setup(async () => json(reply)); const search = vi.spyOn(d.sources, "search");
      const result = await d.backend.checkClaim({ user, body: { accountId: "northstar", statement: "A client statement." } });
      expect(result.status).toBe(reply.scope === "administrator" ? 502 : 400); expect(search).not.toHaveBeenCalled(); expect(d.model.complete.mock.calls.length).toBeLessThanOrEqual(2);
    }
  });
  it("cancels a stalled model and returns a retryable deadline failure", async () => {
    vi.useFakeTimers();
    try {
      const d = setup(req => new Promise((_resolve, reject) => req.signal!.addEventListener("abort", () => reject(req.signal!.reason), { once: true })));
      // AbortSignal.timeout uses runtime timers rather than Vitest timers; inject the deadline signal.
      const controller = new AbortController(); const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      const result = d.backend.chat({ user, body: { accountId: "northstar", question: "Who owns setup?" } });
      await Promise.resolve(); controller.abort(new DOMException("deadline", "TimeoutError"));
      expect((await result).status).toBe(503); timeout.mockRestore();
    } finally { vi.useRealTimers(); }
  });
});
