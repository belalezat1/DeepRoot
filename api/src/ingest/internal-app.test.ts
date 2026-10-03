import { ACCOUNTS, BETACO_CANARY, DEMO_USERS, IMPLEMENTATION_TRACKER_EXPORT } from "@deeproot/demo";
import { describe, expect, it, vi } from "vitest";
import { filterPermittedSources } from "../access.js";
import { IMPLEMENTATION_TRACKER } from "./connectors/implementation-tracker.js";
import { getPath, ingestInternalAppRecords } from "./internal-app.js";
import { buildSeedSources } from "./seed.js";

const ingest = (records: unknown[]) => ingestInternalAppRecords(IMPLEMENTATION_TRACKER, records, ACCOUNTS);

describe("ingestInternalAppRecords", () => {
  const { records, rejected } = ingest(IMPLEMENTATION_TRACKER_EXPORT);

  it("maps the tracker's own fields into an Acme SourceRecord", () => {
    expect(records.find((r) => r.accountId === "acme")).toEqual({
      id: "acme-impl-tracker-it-4471",
      accountId: "acme",
      kind: "internal_app",
      title: "Payroll export: Acme Canada Ltd",
      author: "Priya Raman",
      occurredAt: "2026-09-30T20:10:00.000Z",
      body: [
        "Ticket: IT-4471",
        "Status: Not started",
        "Assignee: Unassigned",
        "Notes: Blocked on provincial tax field mapping and CAD currency support. No estimate yet.",
      ].join("\n"),
      allowedUserIds: [DEMO_USERS.presenter],
      app: { id: "impl-tracker", name: "Implementation Tracker" },
    });
  });

  it("gives BetaCo tracker records only BetaCo's access list", () => {
    const betaco = records.find((r) => r.accountId === "betaco")!;
    expect(betaco.body).toContain(BETACO_CANARY);
    expect(betaco.allowedUserIds).toEqual([DEMO_USERS.betacoLead]);
  });

  it("rejects a customer with no Deeproot account instead of guessing", () => {
    expect(rejected).toEqual([
      { index: 2, recordId: "IT-4510", reason: 'customer "C-9999" is not mapped to a Deeproot account' },
    ]);
  });

  it("ignores access fields smuggled into the app record", () => {
    const [row] = IMPLEMENTATION_TRACKER_EXPORT;
    const smuggled = { ...row, ticket_id: "IT-1", allowedUserIds: ["attacker"], accountId: "betaco" };
    const [record] = ingest([smuggled]).records;
    expect(record).toMatchObject({ accountId: "acme", allowedUserIds: [DEMO_USERS.presenter] });
  });

  it("reports bad rows without dropping the good ones", () => {
    const [good] = IMPLEMENTATION_TRACKER_EXPORT;
    const result = ingest([good, { ...good, ticket_id: "IT-2", updated_at: "never" }, null, good]);
    expect(result.records).toHaveLength(1);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      "invalid date in updated_at",
      "missing ticket_id",
      "duplicate record in this batch",
    ]);
  });
});

describe("getPath", () => {
  it("reads nested keys and returns undefined for missing ones", () => {
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("buildSeedSources", () => {
  it("adds tracker records to the fixtures without leaking BetaCo to the presenter", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const seed = buildSeedSources();
    expect(seed.map((s) => s.kind)).toContain("internal_app");

    const visible = filterPermittedSources(seed, "acme", DEMO_USERS.presenter);
    expect(visible.map((s) => s.id)).toContain("acme-impl-tracker-it-4471");
    expect(JSON.stringify(visible)).not.toContain(BETACO_CANARY);
  });
});
