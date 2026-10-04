import { describe, expect, it } from "vitest";
import type { AgentAnalysis } from "@deeproot/shared";
import { InMemoryAnalysisStore } from "./analyses.js";

const analysis = (generatedAt: string, createdBy = "presenter"): AgentAnalysis => ({
  id: generatedAt, accountId: "northstar", createdBy, generatedAt, summary: generatedAt,
  findings: [], sources: [], analyzedSourceIds: [], validation: { droppedCitations: 0, droppedFindings: 0 },
});

describe("latest analysis storage", () => {
  it("prevents a slower old analysis from replacing a newer one, scopes users, and isolates returned objects", async () => {
    const store = new InMemoryAnalysisStore();
    const newer = analysis("2026-10-03T12:01:00Z");
    await store.save(newer);
    await store.save(analysis("2026-10-03T12:00:00Z"));
    await store.save(analysis("2026-10-03T13:00:00Z", "other-user"));
    const saved = (await store.latest("northstar", "presenter"))!;
    expect(saved).toEqual(newer);
    saved.summary = "Caller edit";
    expect(await store.latest("northstar", "presenter")).toEqual(newer);
    expect(await store.latest("betaco", "presenter")).toBeNull();
  });
});
