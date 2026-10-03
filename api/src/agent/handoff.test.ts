// Ingestion -> agent handoffs: records from every input type reach the model, can be cited, and can
// corroborate each other in a single finding.
import { ACCOUNTS, DEMO_USERS } from "@deeproot/demo";
import type { AgentAnalysis } from "@deeproot/shared";
import { describe, expect, it, vi } from "vitest";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { InMemoryAccountDirectory } from "../store/reports.js";
import { InMemorySourceStore, type SourceSearch } from "../store/sources.js";
import { ALL_SOURCES, IDS, LIVE_MEETING, QUOTES, reply, scriptedModel, type ScriptedModel } from "../testing/agent.js";
import { analyzeAccount } from "./analyze.js";

const user = { userId: DEMO_USERS.presenter };
const seeded = ALL_SOURCES.filter((s) => s.id !== LIVE_MEETING.id); // what storage holds before the upload
const run = (model: ScriptedModel, opts: { search?: SourceSearch; extra?: typeof LIVE_MEETING[] } = {}) =>
  analyzeAccount(
    { user, accountId: "northstar", extraSources: opts.extra ?? [LIVE_MEETING] },
    {
      accounts: new InMemoryAccountDirectory(ACCOUNTS),
      search: opts.search ?? new InMemorySourceStore(seeded),
      model,
      analyses: new InMemoryAnalysisStore(),
    },
  );
const sentIds = (model: ScriptedModel): string[] => {
  const prompt = model.calls[0]!.user;
  return JSON.parse(prompt.slice(prompt.indexOf("{"))).records.map((r: { id: string }) => r.id);
};
const finding = (citations: Array<[string, string]>, type = "fact") => ({
  type,
  title: `${type} finding`,
  description: "d",
  citations: citations.map(([sourceId, quote]) => ({ sourceId, quote })),
});

describe("every input type reaches the agent", () => {
  it("emails, meetings (seeded and reviewed), and both internal apps are in the model's context", async () => {
    const model = scriptedModel(reply([]));
    await run(model);
    const ids = sentIds(model);
    for (const id of [IDS.customerEmail, IDS.internalEmail, IDS.kickoff, IDS.meeting, IDS.tracker, IDS.ohioConfig, IDS.paConfig]) {
      expect(ids).toContain(id);
    }
  });

  it("a reviewed meeting passed as an extra source is analyzed before it is ever indexed", async () => {
    const model = scriptedModel(reply([finding([[IDS.meeting, QUOTES.meetingSlip]], "risk")]));
    const analysis = await run(model);
    expect(analysis.findings[0]!.relatedSourceIds).toEqual([IDS.meeting]);
  });
});

describe("citations validate on every source type", () => {
  const perType: Array<[string, string, string]> = [
    ["email (plain text)", IDS.customerEmail, QUOTES.customer38],
    ["email (from HTML)", IDS.internalEmail, QUOTES.internalRisk],
    ["meeting", IDS.meeting, QUOTES.meetingSlip],
    ["Implementation Tracker", IDS.tracker, QUOTES.trackerUnassigned],
    ["Payroll Configuration Dashboard", IDS.ohioConfig, QUOTES.ohioMissing],
  ];

  it.each(perType)("%s: a verbatim quote is kept with exact offsets", async (_label, sourceId, quote) => {
    const analysis = await run(scriptedModel(reply([finding([[sourceId, quote]])])));
    const [c] = analysis.findings[0]!.citations;
    const body = ALL_SOURCES.find((s) => s.id === sourceId)!.body;
    expect(body.slice(c!.startOffset, c!.endOffset)).toBe(quote);
  });

  it.each(perType)("%s: an altered quote is rejected", async (_label, sourceId, quote) => {
    const altered = quote.replace(/[0-9]+|[A-Z][a-z]+/, "XYZ");
    const analysis = await run(scriptedModel(reply([finding([[sourceId, altered]])])));
    expect(analysis).toMatchObject({ findings: [], validation: { droppedCitations: 1, droppedFindings: 1 } });
  });
});

describe("cross-source findings", () => {
  it("one finding can be corroborated by email, meeting, and both internal apps", async () => {
    const model = scriptedModel(
      reply([
        finding(
          [
            [IDS.customerEmail, QUOTES.customer38],
            [IDS.meeting, QUOTES.meetingSlip],
            [IDS.tracker, QUOTES.trackerBlocked],
            [IDS.paConfig, QUOTES.pa14],
          ],
          "risk",
        ),
      ]),
    );
    const analysis = await run(model);
    const kinds = analysis.findings[0]!.relatedSourceIds.map((id) => {
      const s = analysis.sources.find((x) => x.id === id)!;
      return s.app?.name ?? s.kind;
    });
    expect(kinds).toEqual(["email", "meeting", "Implementation Tracker", "Payroll Configuration Dashboard"]);
  });

  it("returns only the cited sources, without access lists, in the order the sorted findings cite them", async () => {
    const analysis: AgentAnalysis = await run(
      scriptedModel(reply([finding([[IDS.tracker, QUOTES.trackerBlocked]]), finding([[IDS.meeting, QUOTES.meetingSlip], [IDS.tracker, QUOTES.trackerDue]])])),
    );
    // The two-source finding ranks first (better corroborated), so its sources lead.
    expect(analysis.sources.map((s) => s.id)).toEqual([IDS.meeting, IDS.tracker]);
    expect(analysis.sources.every((s) => !("allowedUserIds" in s))).toBe(true);
    expect(analysis.sources[1]!.body).toContain(QUOTES.trackerBlocked);
  });
});

describe("duplicates", () => {
  it("a source both retrieved and passed as extra is sent once, and the extra (newer) copy wins", async () => {
    const indexed = { ...LIVE_MEETING, body: "Maya: An older, unreviewed transcript." };
    const search = new InMemorySourceStore([...seeded, indexed]);
    const spy = vi.spyOn(search, "search");
    const model = scriptedModel(reply([finding([[IDS.meeting, QUOTES.meetingSlip]])]));
    const analysis = await run(model, { search });

    expect(spy).toHaveBeenCalledOnce();
    expect(sentIds(model).filter((id) => id === IDS.meeting)).toHaveLength(1);
    expect(analysis.analyzedSourceIds.filter((id) => id === IDS.meeting)).toHaveLength(1);
    expect(analysis.findings).toHaveLength(1); // cites the reviewed text, which only the extra copy has
  });

  it("repeated citations inside one finding are collapsed", async () => {
    const analysis = await run(scriptedModel(reply([finding([[IDS.tracker, QUOTES.trackerBlocked], [IDS.tracker, QUOTES.trackerBlocked]])])));
    expect(analysis.findings[0]!.citations).toHaveLength(1);
    expect(analysis.validation.droppedCitations).toBe(0);
  });
});
