import { ACCOUNTS, BETACO_CANARY, SAMPLE_NORTHSTAR_REPORT, SAMPLE_REPORT_ID } from "@deeproot/demo";
import { describe, expect, it } from "vitest";
import { meetingToSource } from "../ingest/meeting.js";
import { buildSeedSources } from "../ingest/seed.js";

const northstar = ACCOUNTS.find((a) => a.id === "northstar")!;
const sources = [
  ...buildSeedSources(),
  meetingToSource({
    account: northstar,
    meetingId: SAMPLE_REPORT_ID,
    occurredAt: SAMPLE_NORTHSTAR_REPORT.createdAt,
    transcript: SAMPLE_NORTHSTAR_REPORT.transcript,
  }),
];

describe("sample Northstar report", () => {
  it("every citation quotes an ingested Northstar source verbatim", () => {
    const r = SAMPLE_NORTHSTAR_REPORT;
    const citations = [
      ...r.decisions.flatMap((d) => d.citations),
      ...r.commitments.flatMap((c) => c.citations),
      ...r.risks.flatMap((k) => k.citations),
    ];
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      const source = sources.find((s) => s.id === c.sourceId);
      expect(source, c.sourceId).toBeDefined();
      expect(source!.accountId).toBe("northstar");
      expect(source!.body, c.sourceId).toContain(c.quote);
    }
  });

  it("leaves the unnamed owner unknown and contains no BetaCo content", () => {
    expect(SAMPLE_NORTHSTAR_REPORT.commitments[0]!.owner).toBeNull();
    expect(JSON.stringify(SAMPLE_NORTHSTAR_REPORT)).not.toContain(BETACO_CANARY);
  });
});
