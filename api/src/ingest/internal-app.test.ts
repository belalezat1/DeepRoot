import {
  ACCOUNTS,
  DEMO_USERS,
  IMPLEMENTATION_TRACKER_EXPORT,
  PAYROLL_CONFIG_EXPORT,
  UNMAPPED_TRACKER_ROW,
} from "@deeproot/demo";
import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_TRACKER, INTERNAL_APP_CONNECTORS, PAYROLL_CONFIG_DASHBOARD } from "./connectors/index.js";
import { assertValidConnector, getPath, ingestInternalAppRecords, type InternalAppConnector } from "./internal-app.js";

const tracker = (rows: unknown[]) => ingestInternalAppRecords(IMPLEMENTATION_TRACKER, rows, ACCOUNTS);
const dashboard = (rows: unknown[]) => ingestInternalAppRecords(PAYROLL_CONFIG_DASHBOARD, rows, ACCOUNTS);

describe("Implementation Tracker", () => {
  it("maps the tracker's own fields into a Northstar SourceRecord", () => {
    const { records, rejected } = tracker(IMPLEMENTATION_TRACKER_EXPORT);
    expect(rejected).toEqual([]);
    expect(records.find((r) => r.accountId === "northstar")).toEqual({
      id: "northstar-impl-tracker-it-5120",
      accountId: "northstar",
      kind: "internal_app",
      title: "State tax setup: Ohio and Pennsylvania",
      author: "Jordan Ellis",
      occurredAt: "2026-10-01T13:00:00.000Z",
      body: [
        "Ticket: IT-5120",
        "Status: Blocked",
        "Assignee: Unassigned",
        "Due: 2026-10-08",
        "Go-live: 2026-10-22",
        "Notes: State tax mapping incomplete. Waiting on client's Ohio withholding account number. PA local tax codes missing for 14 employees.",
      ].join("\n"),
      allowedUserIds: [DEMO_USERS.presenter],
      app: { id: "impl-tracker", name: "Implementation Tracker" },
    });
  });

  it("rejects a customer with no Deeproot account instead of guessing", () => {
    expect(tracker([UNMAPPED_TRACKER_ROW]).rejected).toEqual([
      { index: 0, recordId: "IT-4510", reason: 'customer "C-9999" is not mapped to a Deeproot account' },
    ]);
  });

  it("reports malformed rows without dropping the good ones", () => {
    const [good] = IMPLEMENTATION_TRACKER_EXPORT;
    const result = tracker([
      good,
      { ...good, ticket_id: "IT-2", updated_at: "never" },
      null,
      { ...good, ticket_id: "IT-3", summary: { nested: "object" } },
      { ...good, ticket_id: "IT-4", customer: "C-3107" }, // customer flattened: code path missing
      good,
    ]);
    expect(result.records).toHaveLength(1);
    expect(result.rejected.map((r) => [r.index, r.reason])).toEqual([
      [1, "invalid date in updated_at"],
      [2, "missing ticket_id"],
      [3, "missing summary"],
      [4, 'customer "" is not mapped to a Deeproot account'],
      [5, "duplicate record in this batch"],
    ]);
  });
});

describe("Payroll Configuration Dashboard (second app, same engine)", () => {
  const { records, rejected } = dashboard(PAYROLL_CONFIG_EXPORT);

  it("ingests a differently shaped export with no engine changes", () => {
    expect(rejected).toEqual([]);
    expect(records.find((r) => r.id === "northstar-payroll-config-88213")).toEqual({
      id: "northstar-payroll-config-88213", // numeric ID made into a safe string
      accountId: "northstar",
      kind: "internal_app",
      title: "Ohio withholding (SIT)",
      author: "Jordan Ellis", // from the nested modified_by.name
      occurredAt: "2026-10-01T21:30:00.000Z", // from epoch milliseconds
      body: [
        "Area: State income tax",
        "Setting: Ohio withholding (SIT)",
        "Status: INCOMPLETE",
        "Missing: Ohio withholding account number",
        "Employees affected: 24",
      ].join("\n"), // no Comment line: the field is absent and has no ifMissing
      allowedUserIds: [DEMO_USERS.presenter],
      app: { id: "payroll-config", name: "Payroll Configuration Dashboard" },
    });
  });

  it("joins list fields and uses ifMissing for an empty list", () => {
    const pa = records.find((r) => r.id === "northstar-payroll-config-88214")!;
    expect(pa.body).toContain("Missing: PSD codes, work location municipality");
    const betaco = records.find((r) => r.accountId === "betaco")!;
    expect(betaco.body).toContain("Missing: Nothing");
  });

  it("maps its own client codes, not the tracker's", () => {
    const [row] = PAYROLL_CONFIG_EXPORT;
    expect(dashboard([{ ...row, client_ref: "C-3107" }]).rejected[0]?.reason).toBe(
      'customer "C-3107" is not mapped to a Deeproot account',
    );
  });
});

describe("adding an app is configuration", () => {
  it("connects a third, made-up app with nothing but a config object", () => {
    const helpdesk: InternalAppConnector = {
      appId: "service-desk",
      appName: "Service Desk",
      fields: { id: "case.number", customerKey: "org", title: "subject", occurredAt: "opened" },
      body: [{ label: "Priority", path: "priority" }],
      accounts: { northstar: "northstar" },
    };
    assertValidConnector(helpdesk, ACCOUNTS);
    const { records } = ingestInternalAppRecords(
      helpdesk,
      [{ case: { number: 7 }, org: "northstar", subject: "W-2 address change", opened: "2026-10-01", priority: "P3" }],
      ACCOUNTS,
    );
    expect(records[0]).toMatchObject({ id: "northstar-service-desk-7", author: "Service Desk", body: "Priority: P3" });
  });

  it("every registered connector is valid", () => {
    for (const c of INTERNAL_APP_CONNECTORS) expect(() => assertValidConnector(c, ACCOUNTS)).not.toThrow();
  });

  it("catches config mistakes up front", () => {
    const broken = { ...IMPLEMENTATION_TRACKER, appId: "Bad App!", body: [], accounts: { X: "nobody" } };
    expect(() => assertValidConnector(broken, ACCOUNTS)).toThrow(
      'Connector Bad App! is misconfigured: appId "Bad App!" is not ID-safe; body maps no fields; customer "X" maps to unknown account "nobody"',
    );
  });
});

describe("getPath", () => {
  it("reads nested keys and returns undefined for missing ones", () => {
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
});
