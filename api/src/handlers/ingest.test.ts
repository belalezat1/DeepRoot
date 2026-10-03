import {
  ACCOUNTS,
  BETACO_CANARY,
  BETACO_EMAIL,
  DEMO_USERS,
  IMPLEMENTATION_TRACKER_EXPORT,
  NORTHSTAR_CUSTOMER_EMAIL,
  NORTHSTAR_MEETING_DATE,
  NORTHSTAR_MEETING_TRANSCRIPT,
  UNMAPPED_TRACKER_ROW,
} from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { DEMO_EMAIL_ROUTING } from "../ingest/connectors/index.js";
import { InMemoryAccountDirectory } from "../store/reports.js";
import { InMemorySourceStore } from "../store/sources.js";
import { handleIngestAppRecords, handleIngestEmails, handleSaveMeeting, type IngestDeps } from "./ingest.js";

const user = { userId: DEMO_USERS.presenter };
const deps = (): IngestDeps & { sources: InMemorySourceStore } => ({
  accounts: new InMemoryAccountDirectory(ACCOUNTS),
  sources: new InMemorySourceStore(),
  emailRouting: DEMO_EMAIL_ROUTING,
});
const stored = (d: { sources: InMemorySourceStore }, accountId: string, userId: string = DEMO_USERS.presenter) =>
  d.sources.search({ accountId, userId, query: "", top: 100 });

describe("POST /api/ingest/emails", () => {
  it("ingests and saves emails for accounts the user can access", async () => {
    const d = deps();
    const result = await handleIngestEmails({ user, body: { emails: [NORTHSTAR_CUSTOMER_EMAIL] } }, d);
    expect(result).toEqual({
      status: 200,
      body: {
        ingested: [{ id: "northstar-email-can7x2lq-mail-northstar-example", accountId: "northstar", kind: "email", title: "Re: Payroll go-live checklist" }],
        rejected: [],
      },
    });
    expect(await stored(d, "northstar")).toHaveLength(1);
  });

  it("rejects a BetaCo email for the presenter without naming the account, and saves nothing of it", async () => {
    const d = deps();
    const result = await handleIngestEmails({ user, body: { emails: [BETACO_EMAIL] } }, d);
    expect(result.body).toEqual({ ingested: [], rejected: [{ index: 0, recordId: BETACO_EMAIL.messageId, reason: "account mailbox is not available" }] });
    expect(JSON.stringify(result.body)).not.toMatch(/betaco"|BLUEHERON/i);
    expect(await stored(d, "betaco", DEMO_USERS.betacoLead)).toEqual([]);
  });

  it("validates the batch and requires sign-in", async () => {
    for (const body of [null, {}, { emails: [] }, { emails: "x" }, { emails: Array(201).fill(NORTHSTAR_CUSTOMER_EMAIL) }]) {
      expect((await handleIngestEmails({ user, body }, deps())).status, JSON.stringify(body)?.slice(0, 40)).toBe(400);
    }
    expect((await handleIngestEmails({ user: null, body: { emails: [NORTHSTAR_CUSTOMER_EMAIL] } }, deps())).status).toBe(401);
  });

  it("reports a database outage as INTEGRATION_UNAVAILABLE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = { ...deps(), sources: { upsert: async () => Promise.reject(new Error("Cosmos 503")) } };
    expect(await handleIngestEmails({ user, body: { emails: [NORTHSTAR_CUSTOMER_EMAIL] } }, d)).toMatchObject({
      status: 503,
      body: { error: { code: "INTEGRATION_UNAVAILABLE" } },
    });
  });
});

describe("POST /api/ingest/apps/:appId", () => {
  it("ingests a tracker export, keeping Northstar rows and rejecting the rest individually", async () => {
    const d = deps();
    const result = await handleIngestAppRecords(
      { user, appId: "impl-tracker", body: { records: [...IMPLEMENTATION_TRACKER_EXPORT, UNMAPPED_TRACKER_ROW] } },
      d,
    );
    expect(result.status).toBe(200);
    const body = result.body as { ingested: Array<{ id: string }>; rejected: Array<{ recordId: string }> };
    expect(body.ingested.map((r) => r.id)).toEqual(["northstar-impl-tracker-it-5120"]);
    expect(body.rejected.map((r) => r.recordId)).toEqual(["IT-4502", "IT-4510"]); // BetaCo row, unmapped row
    expect(JSON.stringify(await stored(d, "northstar"))).not.toContain(BETACO_CANARY);
  });

  it("returns 404 for an app that is not connected", async () => {
    expect((await handleIngestAppRecords({ user, appId: "crm", body: { records: [{}] } }, deps())).status).toBe(404);
  });
});

describe("POST /api/meetings", () => {
  const body = { accountId: "northstar", meetingId: "live-demo", transcript: NORTHSTAR_MEETING_TRANSCRIPT, occurredAt: NORTHSTAR_MEETING_DATE };

  it("saves the reviewed transcript as a meeting source, replacing it on re-save", async () => {
    const d = deps();
    expect((await handleSaveMeeting({ user, body }, d)).status).toBe(201);
    await handleSaveMeeting({ user, body: { ...body, transcript: `${NORTHSTAR_MEETING_TRANSCRIPT}\nMaya: Thanks.` } }, d);
    const meetings = await stored(d, "northstar");
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ id: "northstar-meeting-live-demo", kind: "meeting" });
    expect(meetings[0]!.body).toMatch(/Maya: Thanks\.$/);
  });

  it("checks access and validates fields", async () => {
    expect((await handleSaveMeeting({ user, body: { ...body, accountId: "betaco" } }, deps())).status).toBe(404);
    expect((await handleSaveMeeting({ user, body: { ...body, transcript: " " } }, deps())).status).toBe(400);
    expect((await handleSaveMeeting({ user, body: { ...body, occurredAt: "Friday" } }, deps())).status).toBe(400);
    expect((await handleSaveMeeting({ user: null, body }, deps())).status).toBe(401);
  });
});
