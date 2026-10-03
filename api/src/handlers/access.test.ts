// Account isolation across every endpoint: a restricted account looks exactly like a missing one,
// and nothing is retrieved, generated, or created before access is checked.
import type { HandlerResult } from "../errors.js";
import { ACCOUNTS, BETACO_CANARY, DEMO_USERS, NORTHSTAR_MEETING_TRANSCRIPT, SAMPLE_NORTHSTAR_REPORT } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { handleAnalyze } from "./analyze.js";
import { BriefCache, handleGetBrief } from "./brief.js";
import { handleChat } from "./chat.js";
import { handleClaimCheck } from "./claims.js";
import { handleCreateLinearIssue } from "./createLinearIssue.js";
import { handleCreateReport, handleGetReport } from "./reports.js";
import { sampleReportGenerator } from "../reports/generator.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { ALL_SOURCES, scriptedModel } from "../testing/agent.js";

const presenter = { userId: DEMO_USERS.presenter };
const betacoLead = { userId: DEMO_USERS.betacoLead };

function setup() {
  const search = new InMemorySourceSearch(ALL_SOURCES);
  const model = scriptedModel();
  const generateReport = vi.fn(sampleReportGenerator);
  const linearFetch = vi.fn();
  const deps = {
    accounts: new InMemoryAccountDirectory(ACCOUNTS),
    search,
    sourceWriter: search,
    reports: new InMemoryReportStore([{ ...SAMPLE_NORTHSTAR_REPORT }]),
    model,
    generateReport,
    cache: new BriefCache(),
    linear: { apiKey: "k", teamId: "t", fetch: linearFetch as typeof fetch },
    appBaseUrl: "https://deeproot.example",
  };
  const searchSpy = vi.spyOn(search, "search");
  /** Every way an endpoint could touch data or an outside service. */
  const touched = () => searchSpy.mock.calls.length + model.calls.length + generateReport.mock.calls.length + linearFetch.mock.calls.length;
  return { deps, touched };
}

type Call = (user: { userId: string } | null, accountOrReport: string) => Promise<HandlerResult<unknown>>;

/** Each endpoint, called against an account (or report) by ID. */
function endpoints(deps: ReturnType<typeof setup>["deps"]): Record<string, Call> {
  return {
    brief: (user, id) => handleGetBrief({ user, accountId: id }, deps),
    analyze: (user, id) => handleAnalyze({ user, body: { accountId: id } }, deps),
    chat: (user, id) => handleChat({ user, body: { accountId: id, question: "What is the payroll status?" } }, deps),
    claim: (user, id) => handleClaimCheck({ user, body: { accountId: id, statement: "Payroll is on track." } }, deps),
    createReport: (user, id) => handleCreateReport({ user, body: { accountId: id, transcript: NORTHSTAR_MEETING_TRANSCRIPT } }, deps),
  };
}

describe("account isolation across endpoints", () => {
  for (const name of ["brief", "analyze", "chat", "claim", "createReport"]) {
    it(`${name}: a restricted account is indistinguishable from a missing one, and nothing runs`, async () => {
      const { deps, touched } = setup();
      const call = endpoints(deps)[name]!;

      const restricted = await call(presenter, "betaco");
      const missing = await call(presenter, "no-such-account");
      const signedOut = await call(null, "northstar");

      expect(restricted.status).toBe(404);
      expect(restricted.body).toEqual(missing.body);
      expect(JSON.stringify(restricted.body)).not.toMatch(/betaco/i);
      expect(signedOut.status).toBe(401);
      expect(touched()).toBe(0);
    });
  }

  it("report read and Linear creation: another account's report is hidden and never sent to Linear", async () => {
    const { deps, touched } = setup();
    const ticket = SAMPLE_NORTHSTAR_REPORT.ticketDraft;

    const read = await handleGetReport({ user: betacoLead, reportId: SAMPLE_NORTHSTAR_REPORT.id }, deps);
    const create = await handleCreateLinearIssue({ user: betacoLead, reportId: SAMPLE_NORTHSTAR_REPORT.id, body: { ticket } }, deps);
    const missing = await handleGetReport({ user: betacoLead, reportId: "nope" }, deps);

    expect(read.status).toBe(404);
    expect(create.status).toBe(404);
    expect(read.body).toEqual(missing.body);
    expect(JSON.stringify([read.body, create.body])).not.toContain("Northstar");
    expect(touched()).toBe(0);
  });

  it("the BetaCo lead can't see Northstar either: isolation works in both directions", async () => {
    const { deps } = setup();
    const res = await endpoints(deps).brief!(betacoLead, "northstar");
    expect(res.status).toBe(404);
  });

  it("no endpoint response for a Northstar user ever contains BetaCo's marker", async () => {
    const { deps } = setup();
    const responses = await Promise.all([
      handleGetReport({ user: presenter, reportId: SAMPLE_NORTHSTAR_REPORT.id }, deps),
      handleCreateReport({ user: presenter, body: { accountId: "northstar", transcript: NORTHSTAR_MEETING_TRANSCRIPT } }, deps),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 201]);
    expect(JSON.stringify(responses)).not.toContain(BETACO_CANARY);
  });
});
