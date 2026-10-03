import type { ApiError, CreateLinearIssueResponse, MeetingReport } from "@deeproot/shared";
import { ACCOUNTS, DEMO_USERS, SAMPLE_NORTHSTAR_REPORT } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../store/reports.js";
import { type CreateLinearIssueDeps, handleCreateLinearIssue } from "./createLinearIssue.js";

const presenter = { userId: DEMO_USERS.presenter };
const outsider = { userId: "someone-else" };

let nextId = 0;
/** Each test gets its own report ID so in-process creation state never leaks between tests. */
function setup(overrides: { fetch?: typeof fetch; linear?: null; report?: Partial<MeetingReport> } = {}) {
  const report: MeetingReport = { ...structuredClone(SAMPLE_NORTHSTAR_REPORT), id: `report-${++nextId}`, ...overrides.report };
  const reports = new InMemoryReportStore([report]);
  const fetchMock = vi.fn(
    overrides.fetch ??
      (async () =>
        Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: { id: "uuid-1", identifier: "DEE-1", url: "https://linear.app/deeproot/issue/DEE-1" },
            },
          },
        })),
  );
  const deps: CreateLinearIssueDeps = {
    reports,
    accounts: new InMemoryAccountDirectory(ACCOUNTS),
    linear:
      overrides.linear === null
        ? null
        : { apiKey: "lin_api_test", teamId: "team-uuid", teamKey: "DEE", fetch: fetchMock as typeof fetch },
    appBaseUrl: "https://deeproot.example",
  };
  const body = { ticket: report.ticketDraft };
  return { report, reports, fetchMock, deps, body };
}

function sentInput(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string).variables.input;
}

describe("POST /api/reports/:id/linear", () => {
  it("creates one issue, saves it on the report, and keeps the reviewed acceptance criteria", async () => {
    const { report, reports, fetchMock, deps, body } = setup();

    const res = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      issue: { identifier: "DEE-1", url: "https://linear.app/deeproot/issue/DEE-1" },
      alreadyCreated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const input = sentInput(fetchMock);
    expect(input.teamId).toBe("team-uuid");
    expect(input.priority).toBe(2);
    expect(input.description).toContain("- [ ] Pennsylvania local earned income tax has PSD codes");
    expect(input.description).toContain(`https://deeproot.example/reports/${report.id}`);
    expect(input.description).not.toContain("Can you confirm who on your team"); // no email bodies sent to Linear

    expect((await reports.get(report.id))?.linearIssue?.identifier).toBe("DEE-1");
  });

  it("returns the stored issue on a retry instead of creating another", async () => {
    const { report, fetchMock, deps, body } = setup();

    await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);
    const retry = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);

    expect(retry.status).toBe(200);
    expect((retry.body as CreateLinearIssueResponse).alreadyCreated).toBe(true);
    expect((retry.body as CreateLinearIssueResponse).issue.identifier).toBe("DEE-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates only one issue when the button is double-clicked", async () => {
    const { report, fetchMock, deps, body } = setup();

    const [a, b] = await Promise.all([
      handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps),
      handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((a.body as CreateLinearIssueResponse).issue).toEqual((b.body as CreateLinearIssueResponse).issue);
  });

  it("uses the reviewed ticket the presenter edited, not the original draft", async () => {
    const { report, reports, fetchMock, deps, body } = setup();
    const edited = { ticket: { ...body.ticket, title: "Edited title", priority: "medium" } };

    await handleCreateLinearIssue({ user: presenter, reportId: report.id, body: edited }, deps);

    expect(sentInput(fetchMock).title).toBe("Edited title");
    expect(sentInput(fetchMock).priority).toBe(3);
    expect((await reports.get(report.id))?.ticketDraft.title).toBe("Edited title");
  });

  it("refuses users without access to the account before calling Linear, without revealing the report", async () => {
    const { report, fetchMock, deps, body } = setup();

    const res = await handleCreateLinearIssue({ user: outsider, reportId: report.id, body }, deps);
    const missing = await handleCreateLinearIssue({ user: presenter, reportId: "does-not-exist", body }, deps);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body); // forbidden and missing look identical
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    const { report, fetchMock, deps, body } = setup();

    const res = await handleCreateLinearIssue({ user: null, reportId: report.id, body }, deps);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a ticket with no acceptance criteria", async () => {
    const { report, fetchMock, deps, body } = setup();
    const bad = { ticket: { ...body.ticket, acceptanceCriteria: ["  "] } };

    const res = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body: bad }, deps);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats GraphQL errors in an HTTP 200 response as a failure and returns the prefilled link", async () => {
    const { report, reports, deps, body } = setup({
      fetch: async () => Response.json({ errors: [{ message: "Authentication required" }] }),
    });

    const res = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);

    expect(res.status).toBe(503);
    const error = (res.body as ApiError).error;
    expect(error.code).toBe("INTEGRATION_UNAVAILABLE");
    expect(error.fallbackUrl).toMatch(/^https:\/\/linear\.app\/team\/DEE\/new\?title=/);
    expect(new URL(error.fallbackUrl!).searchParams.get("description")).toContain("Ohio withholding");
    expect((await reports.get(report.id))?.linearIssue).toBeUndefined();
  });

  it("allows a retry after a failed attempt", async () => {
    let calls = 0;
    const { report, deps, body } = setup({
      fetch: async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        return Response.json({
          data: { issueCreate: { success: true, issue: { id: "u", identifier: "DEE-2", url: "https://linear.app/x/DEE-2" } } },
        });
      },
    });

    const first = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);
    const second = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);

    expect(first.status).toBe(503);
    expect(second.status).toBe(201);
    expect((second.body as CreateLinearIssueResponse).issue.identifier).toBe("DEE-2");
  });

  it("returns the prefilled link when Linear is not configured", async () => {
    const { report, deps, body } = setup({ linear: null });

    const res = await handleCreateLinearIssue({ user: presenter, reportId: report.id, body }, deps);

    expect(res.status).toBe(503);
    expect((res.body as ApiError).error.fallbackUrl).toMatch(/^https:\/\/linear\.new\?/);
  });
});
