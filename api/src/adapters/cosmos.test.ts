import { describe, expect, it, vi } from "vitest";
import type { Container } from "@azure/cosmos";
import { SAMPLE_NORTHSTAR_REPORT } from "@deeproot/demo";
import { AzureSourceWriter, CosmosReportStore } from "./cosmos.js";
import type { AzureSourceSearch } from "./search.js";
import type { StoredReport } from "../store/reports.js";

/** Emulates Cosmos' conditional replacement and atomic patch across independent adapter objects. */
function container() {
  let version = 1;
  let document = { ...structuredClone(SAMPLE_NORTHSTAR_REPORT), citedSources: [], _etag: "1" } as StoredReport & { _etag: string };
  const item = {
    read: vi.fn(async () => ({ resource: structuredClone(document) })),
    replace: vi.fn(async (report: StoredReport, options: { accessCondition: { type: string; condition: string } }) => {
      if (options.accessCondition.condition !== document._etag) throw Object.assign(new Error("Precondition failed"), { code: 412 });
      document = { ...structuredClone(report), _etag: String(++version) };
      return { resource: document };
    }),
    patch: vi.fn(async (ops: Array<{ path: string; value: unknown }>) => {
      for (const op of ops) Object.assign(document, { [op.path.slice(1)]: op.value });
      document._etag = String(++version);
    }),
  };
  return { sdk: { item: () => item } as unknown as Container, item };
}

describe("Cosmos Linear coordination", () => {
  it("retries index deletion even when Cosmos deletion already succeeded", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error("Search unavailable")).mockResolvedValue(undefined);
    const deletion = vi.fn().mockResolvedValueOnce({}).mockRejectedValue(Object.assign(new Error("Gone"), { code: 404 }));
    const writer = new AzureSourceWriter({ item: () => ({ delete: deletion }) } as unknown as Container, { remove } as unknown as AzureSourceSearch);
    await expect(writer.remove("northstar", "source")).rejects.toThrow("Search unavailable");
    await expect(writer.remove("northstar", "source")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("chooses one reservation under an ETag race and patches success without losing snapshots", async () => {
    const c = container();
    const a = new CosmosReportStore(c.sdk), b = new CosmosReportStore(c.sdk);
    const report = SAMPLE_NORTHSTAR_REPORT;
    const first = { issueId: crypto.randomUUID(), teamId: "team", ticket: report.ticketDraft, description: "First accepted draft" };
    const second = { ...first, issueId: crypto.randomUUID(), description: "Competing draft" };
    const [x, y] = await Promise.all([a.reserveLinearCreation(report.id, first), b.reserveLinearCreation(report.id, second)]);
    expect([x.reserved, y.reserved].filter(Boolean)).toHaveLength(1);
    expect(x.report.linearCreation).toEqual(y.report.linearCreation);
    expect(c.item.replace).toHaveBeenCalledWith(expect.anything(), { accessCondition: { type: "IfMatch", condition: "1" } });
    await b.completeLinearCreation(report.id, { identifier: "DEE-1", url: "https://linear.app/DEE-1" });
    const saved = await a.get(report.id);
    expect(saved).toMatchObject({ citedSources: [], linearIssueStatus: "created", linearCreation: first });
    expect(saved).not.toHaveProperty("_etag");
  });

  it("propagates storage failures and does not silently change identities", async () => {
    const c = container();
    c.item.replace.mockRejectedValueOnce(Object.assign(new Error("Storage down"), { code: 503 }));
    await expect(new CosmosReportStore(c.sdk).reserveLinearCreation(SAMPLE_NORTHSTAR_REPORT.id, {
      issueId: crypto.randomUUID(), teamId: "team", ticket: SAMPLE_NORTHSTAR_REPORT.ticketDraft, description: "d",
    })).rejects.toThrow("Storage down");
    expect(c.item.replace).toHaveBeenCalledTimes(1);
  });
});
