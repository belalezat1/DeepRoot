import { describe, expect, it } from "vitest";
import type { Container } from "@azure/cosmos";
import type { AgentAnalysis } from "@deeproot/shared";
import { CosmosAnalysisStore } from "../adapters/cosmos.js";
import { CosmosIntegrationStore } from "../integrations/store.js";

// Provider simulation: partitioned keys, create conflicts and IfMatch ETags.
function storage() {
  const docs = new Map<string, Record<string, unknown>>(); let version = 0;
  const key = (id: string, partition: string) => JSON.stringify([id, partition]);
  const conflict = (code: number) => Object.assign(new Error("Conditional conflict"), { code });
  const sdk = {
    item: (id: string, partition: string) => ({
      read: async () => ({ resource: structuredClone(docs.get(key(id, partition))) }),
      replace: async (value: Record<string, unknown>, options: { accessCondition: { condition: string } }) => {
        if (docs.get(key(id, partition))?._etag !== options.accessCondition.condition) throw conflict(412);
        docs.set(key(id, partition), structuredClone({ ...value, _etag: String(++version) }));
      },
    }),
    items: { create: async (value: Record<string, unknown>) => {
      const k = key(String(value.id), String(value.accountId)); if (docs.has(k)) throw conflict(409);
      docs.set(k, structuredClone({ ...value, _etag: String(++version) }));
    } },
  } as unknown as Container;
  return { sdk, docs };
}
const analysis = (generatedAt: string, createdBy = "presenter"): AgentAnalysis => ({ id: generatedAt, accountId: "northstar", createdBy, generatedAt, summary: generatedAt, findings: [], sources: [], analyzedSourceIds: [], validation: { droppedCitations: 0, droppedFindings: 0 } });

describe("partitioned cloud state coordination", () => {
  it("retains one latest analysis per account/user across independent stores and creation races", async () => {
    const c = storage(), a = new CosmosAnalysisStore(c.sdk), b = new CosmosAnalysisStore(c.sdk);
    await Promise.all([a.save(analysis("2026-10-04T12:01:00Z")), b.save(analysis("2026-10-04T12:02:00Z"))]);
    await a.save(analysis("2026-10-04T12:00:00Z"));
    await b.save(analysis("2026-10-04T12:03:00Z", "reviewer"));
    expect(await a.latest("northstar", "presenter")).toEqual(analysis("2026-10-04T12:02:00Z"));
    expect(await b.latest("betaco", "presenter")).toBeNull(); expect(c.docs.size).toBe(2);
  });
  it("retries integration ETag races using current state without dropping another update", async () => {
    const c = storage(), a = new CosmosIntegrationStore(c.sdk), b = new CosmosIntegrationStore(c.sdk);
    await Promise.all([a.update<number>("northstar", "sample", n => (n ?? 0) + 1), b.update<number>("northstar", "sample", n => (n ?? 0) + 1)]);
    await Promise.all([a.update<number>("northstar", "sample", n => n! + 1), b.update<number>("northstar", "sample", n => n! + 1)]);
    expect(await b.get("northstar", "sample")).toBe(4); expect(await a.get("betaco", "sample")).toBeNull();
  });
});
