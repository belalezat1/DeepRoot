import type { ApiError, ReportResponse } from "@deeproot/shared";
import { ACCOUNTS, BETACO_CANARY, DEMO_USERS, NORTHSTAR_MEETING_TRANSCRIPT, SAMPLE_SOURCE_IDS } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { buildSeedSources } from "../ingest/seed.js";
import { type GenerateReport, type ReportDraft, sampleReportGenerator } from "../reports/generator.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { type ReportDeps, handleCreateReport, handleGetReport } from "./reports.js";

const presenter = { userId: DEMO_USERS.presenter };
const REPORT_ID = "report-test";
const MEETING_ID = `northstar-meeting-${REPORT_ID}`;

function setup(generateReport: GenerateReport = sampleReportGenerator) {
  const store = new InMemorySourceSearch(buildSeedSources());
  const deps: ReportDeps = {
    accounts: new InMemoryAccountDirectory(ACCOUNTS),
    search: store,
    sourceWriter: store,
    reports: new InMemoryReportStore(),
    generateReport: vi.fn(generateReport),
    now: () => new Date("2026-10-02T15:05:00Z"),
    newId: () => REPORT_ID,
  };
  return { deps, generate: deps.generateReport as ReturnType<typeof vi.fn> };
}

const body = { accountId: "northstar", transcript: NORTHSTAR_MEETING_TRANSCRIPT };

/** A draft built by hand, for testing what the backend does with bad model output. */
function draftWith(overrides: Partial<ReportDraft>): GenerateReport {
  return async (input) => ({ ...(await sampleReportGenerator(input)), ...overrides });
}

describe("POST /api/reports", () => {
  it("creates and saves a cited report from the transcript", async () => {
    const { deps } = setup();

    const res = await handleCreateReport({ user: presenter, body }, deps);

    expect(res.status).toBe(201);
    const { report, sources } = res.body as ReportResponse;
    expect(report.id).toBe(REPORT_ID);
    expect(report.accountId).toBe("northstar");
    expect(report.createdBy).toBe(DEMO_USERS.presenter);
    expect(report.commitments[0]!.owner).toBeNull();
    expect(report.risks.length).toBeGreaterThan(0);

    // Citations survive verification and carry offsets into the source text.
    const meetingCitation = report.commitments[0]!.citations.find((c) => c.sourceId === MEETING_ID);
    expect(meetingCitation?.startOffset).toBeTypeOf("number");

    // The response carries every cited source, without access lists.
    const ids = sources.map((s) => s.id);
    expect(ids).toContain(MEETING_ID);
    expect(ids).toContain(SAMPLE_SOURCE_IDS.customerEmail);
    expect(sources.every((s) => !("allowedUserIds" in s))).toBe(true);

    expect(await deps.reports.get(REPORT_ID)).toEqual(report);
    const saved = await deps.search.search({ accountId: "northstar", userId: presenter.userId, query: "", top: 100 });
    expect(saved.some((s) => s.id === MEETING_ID)).toBe(true);
  });

  it("gives the model only the user's permitted Northstar sources, never BetaCo", async () => {
    const { deps, generate } = setup();

    await handleCreateReport({ user: presenter, body }, deps);

    const input = generate.mock.calls[0]![0];
    expect(input.sources.length).toBeGreaterThan(1);
    expect(input.sources.every((s: { accountId: string }) => s.accountId === "northstar")).toBe(true);
    expect(JSON.stringify(input)).not.toContain(BETACO_CANARY);
  });

  it("refuses a restricted account before reading sources or calling the model", async () => {
    const { deps, generate } = setup();
    const listSpy = vi.spyOn(deps.search, "search");

    const res = await handleCreateReport({ user: presenter, body: { ...body, accountId: "betaco" } }, deps);
    const missing = await handleCreateReport({ user: presenter, body: { ...body, accountId: "nope" } }, deps);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body);
    expect(JSON.stringify(res.body)).not.toMatch(/betaco/i);
    expect(listSpy).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("requires sign-in and a transcript", async () => {
    const { deps, generate } = setup();

    expect((await handleCreateReport({ user: null, body }, deps)).status).toBe(401);
    expect((await handleCreateReport({ user: presenter, body: { ...body, transcript: "  " } }, deps)).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("drops fabricated quotes, other accounts' sources, invented owners, and vague dates", async () => {
    const { deps } = setup(
      draftWith({
        decisions: [
          // Real BetaCo text, but BetaCo is not permitted here.
          { text: "Leak", citations: [{ sourceId: "betaco-email-betaco-0929-mail-betaco-example", quote: BETACO_CANARY }] },
        ],
        commitments: [
          {
            text: "Sam will finish the tax setup.",
            owner: "Marcus Lee", // nobody by that name in the evidence
            dueDate: "Friday", // not a date
            citations: [
              { sourceId: MEETING_ID, quote: "Let me confirm with the team and get back to you." },
              { sourceId: MEETING_ID, quote: "We guarantee it will be done Monday." }, // not in the transcript
            ],
          },
          {
            text: "Unsupported promise",
            owner: null,
            dueDate: null,
            citations: [{ sourceId: "made-up-source", quote: "anything" }],
          },
        ],
      }),
    );

    const res = await handleCreateReport({ user: presenter, body }, deps);

    expect(res.status).toBe(201);
    const { report, sources } = res.body as ReportResponse;
    expect(report.decisions).toEqual([]);
    expect(report.commitments).toHaveLength(1);
    expect(report.commitments[0]!.owner).toBeNull();
    expect(report.commitments[0]!.dueDate).toBeNull();
    expect(report.commitments[0]!.citations).toHaveLength(1);
    expect(JSON.stringify({ report, sources })).not.toContain(BETACO_CANARY);
  });

  it("keeps an owner and due date only when a cited quote states them", async () => {
    const { deps } = setup(
      draftWith({
        commitments: [
          {
            text: "Confirm the owner and follow up with Maya.",
            owner: "Sam",
            dueDate: "2026-10-08",
            citations: [
              { sourceId: MEETING_ID, quote: "Sam: Let me confirm with the team" },
              { sourceId: SAMPLE_SOURCE_IDS.internalEmail, quote: "If the Ohio account number doesn't arrive by October 8" },
            ],
          },
        ],
      }),
    );

    const { report } = (await handleCreateReport({ user: presenter, body }, deps)).body as ReportResponse;

    expect(report.commitments[0]!.owner).toBe("Sam");
    expect(report.commitments[0]!.dueDate).toBe("2026-10-08");
  });

  it("rejects unusable model output without saving anything", async () => {
    const { deps } = setup(async () => ({ summary: "Hi" }) as unknown as ReportDraft);

    const res = await handleCreateReport({ user: presenter, body }, deps);

    expect(res.status).toBe(502);
    expect((res.body as ApiError).error.code).toBe("INVALID_MODEL_OUTPUT");
    expect(await deps.reports.get(REPORT_ID)).toBeNull();
  });

  it("reports an unavailable model as a retryable integration error", async () => {
    const { deps } = setup(async () => {
      throw new Error("Gemini returned 503");
    });

    const res = await handleCreateReport({ user: presenter, body }, deps);

    expect(res.status).toBe(503);
    expect((res.body as ApiError).error.code).toBe("INTEGRATION_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toContain("Gemini"); // no internal details to the browser
  });
});

describe("GET /api/reports/:id", () => {
  it("returns a saved report with its cited sources to a permitted user", async () => {
    const { deps } = setup();
    await handleCreateReport({ user: presenter, body }, deps);

    const res = await handleGetReport({ user: presenter, reportId: REPORT_ID }, deps);

    expect(res.status).toBe(200);
    expect((res.body as ReportResponse).report.id).toBe(REPORT_ID);
    expect((res.body as ReportResponse).sources.length).toBeGreaterThan(0);
  });

  it("hides a report from users without access, exactly like a missing one", async () => {
    const { deps } = setup();
    await handleCreateReport({ user: presenter, body }, deps);

    const res = await handleGetReport({ user: { userId: DEMO_USERS.betacoLead }, reportId: REPORT_ID }, deps);
    const missing = await handleGetReport({ user: presenter, reportId: "nope" }, deps);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body);
    expect((await handleGetReport({ user: null, reportId: REPORT_ID }, deps)).status).toBe(401);
  });
});
