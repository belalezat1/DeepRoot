import { describe, expect, it } from "vitest";
import { ACME_MEETING_SOURCE, BETACO_CANARY, DEMO_SOURCES, SAMPLE_ACME_REPORT } from "./index.js";

const allSources = [...DEMO_SOURCES, ACME_MEETING_SOURCE];

describe("demo fixtures", () => {
  it("every citation in the sample report quotes its source verbatim and stays in the Acme account", () => {
    const r = SAMPLE_ACME_REPORT;
    const citations = [
      ...r.decisions.flatMap((d) => d.citations),
      ...r.commitments.flatMap((c) => c.citations),
      ...r.risks.flatMap((k) => k.citations),
    ];
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      const source = allSources.find((s) => s.id === c.sourceId);
      expect(source, c.sourceId).toBeDefined();
      expect(source!.accountId).toBe("acme");
      expect(source!.body).toContain(c.quote);
    }
  });

  it("the BetaCo canary appears only in BetaCo records", () => {
    for (const s of allSources) {
      expect(s.body.includes(BETACO_CANARY)).toBe(s.accountId === "betaco");
    }
    expect(JSON.stringify(SAMPLE_ACME_REPORT)).not.toContain(BETACO_CANARY);
  });

  it("the sample ticket carries both subsidiaries into acceptance criteria", () => {
    expect(SAMPLE_ACME_REPORT.ticketDraft.acceptanceCriteria.join(" ")).toMatch(/US and Canada subsidiaries/);
  });
});
