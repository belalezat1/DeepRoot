import { DEMO_USERS } from "@deeproot/demo";
import type { SourceRecord } from "@deeproot/shared";
import { describe, expect, it } from "vitest";
import { ALL_SOURCES, IDS, QUOTES } from "../testing/agent.js";
import type { CitationScope } from "./citations.js";
import { dateIsCited, groundFindings, parseModelOutput } from "./findings.js";

const northstar = ALL_SOURCES.filter((s) => s.accountId === "northstar");
const scopeFor = (sources: SourceRecord[]): CitationScope => ({
  accountId: "northstar",
  userId: DEMO_USERS.presenter,
  sourcesById: new Map(sources.map((s) => [s.id, s])),
});
const scope = scopeFor(northstar);
const cite = (sourceId: string, quote: string) => ({ sourceId, quote });
const finding = (overrides: Record<string, unknown>) => ({
  type: "fact",
  title: "Title",
  description: "Description.",
  basis: "stated",
  owner: null,
  dueDate: null,
  severity: null,
  citations: [],
  ...overrides,
});

describe("groundFindings", () => {
  it("keeps a single-source finding", () => {
    const { findings } = groundFindings([finding({ citations: [cite(IDS.tracker, QUOTES.trackerUnassigned)] })], scope);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: "finding-1", relatedSourceIds: [IDS.tracker] });
  });

  it("keeps a multi-source finding and lists each corroborating source once", () => {
    const { findings } = groundFindings(
      [
        finding({
          type: "risk",
          severity: "high",
          basis: "inferred",
          citations: [
            cite(IDS.customerEmail, QUOTES.customer38),
            cite(IDS.meeting, QUOTES.meetingSlip),
            cite(IDS.tracker, QUOTES.trackerBlocked),
            cite(IDS.tracker, QUOTES.trackerBlocked), // duplicate, collapsed
            cite(IDS.ohioConfig, QUOTES.ohioMissing),
          ],
        }),
      ],
      scope,
    );
    expect(findings[0]!.citations).toHaveLength(4);
    expect(findings[0]!.relatedSourceIds).toEqual([IDS.customerEmail, IDS.meeting, IDS.tracker, IDS.ohioConfig]);
    expect(findings[0]!.basis).toBe("inferred");
  });

  it("keeps a conflict that cites both sides", () => {
    const conflict = finding({
      type: "conflict",
      severity: "high",
      citations: [cite(IDS.customerEmail, QUOTES.customerOct15), cite(IDS.tracker, QUOTES.trackerGoLive)],
    });
    const { findings } = groundFindings([conflict], scope);
    expect(findings[0]).toMatchObject({ type: "conflict", relatedSourceIds: [IDS.customerEmail, IDS.tracker] });
  });

  it("drops a conflict whose second side did not check out", () => {
    const conflict = finding({
      type: "conflict",
      citations: [cite(IDS.customerEmail, QUOTES.customerOct15), cite(IDS.tracker, "Go-live: 2026-10-29")],
    });
    expect(groundFindings([conflict], scope)).toMatchObject({ findings: [], droppedFindings: 1, droppedCitations: 1 });
  });

  it("drops findings with only fabricated evidence and counts what it removed", () => {
    const result = groundFindings(
      [
        finding({ citations: [cite("northstar-email-invented", QUOTES.customer38)] }),
        finding({ citations: [cite(IDS.customerEmail, "Northstar has approved a delay to November.")] }),
        finding({ citations: [] }),
        finding({ citations: [cite(IDS.tracker, QUOTES.trackerBlocked), cite(IDS.tracker, "Status: Done")] }),
      ],
      scope,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.citations.map((c) => c.quote)).toEqual([QUOTES.trackerBlocked]);
    expect(result).toMatchObject({ droppedFindings: 3, droppedCitations: 3 });
  });

  it("drops findings with a bad shape", () => {
    const good = finding({ citations: [cite(IDS.tracker, QUOTES.trackerBlocked)] });
    const result = groundFindings([null, "text", { ...good, type: "guess" }, { ...good, title: "" }, good], scope);
    expect(result).toMatchObject({ droppedFindings: 4 });
    expect(result.findings).toHaveLength(1);
  });

  describe("unknown owners stay null", () => {
    const commitment = (owner: unknown, quote: string, sourceId: string = IDS.meeting) =>
      groundFindings([finding({ type: "commitment", owner, citations: [cite(sourceId, quote)] })], scope).findings[0]!;

    it("nulls an owner the evidence never names", () => {
      expect(commitment("Jordan Ellis", QUOTES.meetingNoOwner).owner).toBeNull();
    });

    it("nulls placeholder owners", () => {
      expect(commitment("Unassigned", QUOTES.trackerUnassigned, IDS.tracker).owner).toBeNull();
      expect(commitment("TBD", QUOTES.meetingNoOwner).owner).toBeNull();
    });

    it("keeps an owner named in a cited quote", () => {
      const source = { ...northstar[0]!, id: "northstar-note", body: "Jordan Ellis will send the Ohio form by October 8." };
      const s = scopeFor([source]);
      const [f] = groundFindings([finding({ type: "commitment", owner: "Jordan Ellis", citations: [cite(source.id, source.body)] })], s).findings;
      expect(f!.owner).toBe("Jordan Ellis");
    });
  });

  describe("unknown due dates stay null", () => {
    const due = (dueDate: unknown, quote: string, sourceId: string) =>
      groundFindings([finding({ type: "blocker", dueDate, citations: [cite(sourceId, quote)] })], scope).findings[0]!.dueDate;

    it("keeps a date the quote states", () => {
      expect(due("2026-10-08", QUOTES.trackerDue, IDS.tracker)).toBe("2026-10-08");
      expect(due("2026-10-08", QUOTES.internalRisk, IDS.internalEmail)).toBe("2026-10-08"); // "by October 8"
    });

    it("nulls a date the quotes don't state", () => {
      expect(due("2026-10-09", QUOTES.internalRisk, IDS.internalEmail)).toBeNull();
      expect(due("2026-10-08", QUOTES.trackerBlocked, IDS.tracker)).toBeNull();
      expect(due("next week", QUOTES.trackerDue, IDS.tracker)).toBeNull();
    });
  });

  it("keeps severity only on risks, blockers, and conflicts", () => {
    const [f] = groundFindings([finding({ severity: "high", citations: [cite(IDS.tracker, QUOTES.trackerBlocked)] })], scope).findings;
    expect(f!.severity).toBeNull();
  });

  it("puts the most severe, best corroborated findings first", () => {
    const fact = finding({ title: "fact", citations: [cite(IDS.ohioConfig, QUOTES.ohio24)] });
    const low = finding({ type: "risk", title: "low", severity: "low", citations: [cite(IDS.paConfig, QUOTES.pa14)] });
    const highOne = finding({ type: "risk", title: "high-1", severity: "high", citations: [cite(IDS.meeting, QUOTES.meetingSlip)] });
    const highTwo = finding({
      type: "risk",
      title: "high-2",
      severity: "high",
      citations: [cite(IDS.meeting, QUOTES.meetingSlip), cite(IDS.customerEmail, QUOTES.customer38)],
    });
    const { findings } = groundFindings([fact, low, highOne, highTwo], scope);
    expect(findings.map((f) => f.title)).toEqual(["high-2", "high-1", "low", "fact"]);
    expect(findings.map((f) => f.id)).toEqual(["finding-1", "finding-2", "finding-3", "finding-4"]);
  });
});

describe("dateIsCited", () => {
  const q = (quote: string) => [{ sourceId: "x", quote }];

  it("recognizes common written forms", () => {
    for (const text of ["Due: 2026-10-08", "by October 8,", "Oct. 8", "on 8 October", "due 10/8"]) {
      expect(dateIsCited("2026-10-08", q(text)), text).toBe(true);
    }
  });

  it("does not confuse neighbouring numbers", () => {
    expect(dateIsCited("2026-10-01", q("October 18"))).toBe(false);
    expect(dateIsCited("2026-10-08", q("10/18"))).toBe(false);
    expect(dateIsCited("2026-13-01", q("2026-13-01"))).toBe(false);
  });
});

describe("parseModelOutput", () => {
  it("accepts plain and fenced JSON", () => {
    expect(parseModelOutput('{"summary":"s","findings":[]}')).toEqual({ summary: "s", findings: [] });
    expect(parseModelOutput('```json\n{"summary":"s","findings":[]}\n```')).toEqual({ summary: "s", findings: [] });
  });

  it("returns null for prose, truncated JSON, or the wrong shape", () => {
    expect(parseModelOutput("Here are the findings: ...")).toBeNull();
    expect(parseModelOutput('{"summary":"s","findings":[{"type":')).toBeNull();
    expect(parseModelOutput('{"summary":"s","findings":"none"}')).toBeNull();
    expect(parseModelOutput("null")).toBeNull();
  });
});


describe("calendar-date evidence", () => {
  it.each(["2026-02-29", "2026-04-31", "2026-13-08", "2026-00-08"])("rejects impossible dates: %s", (date) => {
    expect(dateIsCited(date, [{ sourceId: "s", quote: `Deadline ${date}` }])).toBe(false);
  });
  it.each(["October 8, 2025", "Oct. 8 2025", "8 October 2025", "10/8/2025", "2025-10-08"])("rejects conflicting cited years: %s", (quote) => {
    expect(dateIsCited("2026-10-08", [{ sourceId: "s", quote }])).toBe(false);
  });
  it.each(["October 8", "October 8, 2026", "8 October 2026", "10/8/2026", "2026-10-08"])("preserves supported dates: %s", (quote) => {
    expect(dateIsCited("2026-10-08", [{ sourceId: "s", quote }])).toBe(true);
  });
});
