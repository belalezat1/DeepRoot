// Cosmos DB adapters for the backend's storage interfaces. Containers and partition keys are defined
// in infra/resources.bicep: reports and accounts by /id, sources by /accountId.
import { createHash } from "node:crypto";
import type { AgentAnalysis } from "@deeproot/shared";
import type { AnalysisStore } from "../store/analyses.js";
import { CosmosClient, type Container } from "@azure/cosmos";
import type { Account, LinearIssueRef, SourceRecord } from "@deeproot/shared";
import { notFound } from "../access.js";
import type { AccountDirectory } from "../access.js";
import type { LinearCreation, ReportStore, StoredReport } from "../store/reports.js";
import { sourceForUpdate, type SourceWriter } from "../store/sources.js";
import type { AzureSourceSearch } from "./search.js";

export type CosmosContainers = {
  reports: Container;
  accounts: Container;
  sources: Container;
  briefs: Container;
  integrations: Container;
};

export function connectCosmos(config: { endpoint: string; key: string; database: string }): CosmosContainers {
  const database = new CosmosClient({ endpoint: config.endpoint, key: config.key }).database(config.database);
  return {
    reports: database.container("reports"),
    accounts: database.container("accounts"),
    sources: database.container("sources"),
    briefs: database.container("briefs"),
    integrations: database.container("integrations"),
  };
}

export class CosmosReportStore implements ReportStore {
  constructor(private readonly container: Container) {}

  async get(reportId: string): Promise<StoredReport | null> {
    return readById<StoredReport>(this.container, reportId);
  }

  async save(report: StoredReport): Promise<void> {
    await this.container.items.upsert(report);
  }

  async reserveLinearCreation(reportId: string, creation: LinearCreation) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const item = this.container.item(reportId, reportId);
      const { resource } = await item.read<StoredReport & { _etag: string }>();
      if (!resource) throw notFound();
      const report = withoutSystemFields(resource);
      if (report.linearCreation || report.linearIssue) return { report, reserved: false };
      const updated: StoredReport = { ...report, ticketDraft: creation.ticket, linearCreation: creation, linearIssueStatus: "pending" };
      try {
        await item.replace(updated, { accessCondition: { type: "IfMatch", condition: resource._etag } });
        return { report: updated, reserved: true };
      } catch (err) {
        if ((err as { code?: number }).code !== 412) throw err;
      }
    }
    throw new Error("Linear reservation contention; retry the request.");
  }

  async completeLinearCreation(reportId: string, issue: LinearIssueRef): Promise<void> {
    // Both paths exist on a reserved report. Atomic patch preserves concurrent fields and snapshots.
    await this.container.item(reportId, reportId).patch([
      { op: "set", path: "/linearIssue", value: issue },
      { op: "set", path: "/linearIssueStatus", value: "created" },
    ]);
  }
}

export class CosmosAccountDirectory implements AccountDirectory {
  constructor(private readonly container: Container) {}

  async getAccount(accountId: string): Promise<Account | null> {
    return readById<Account>(this.container, accountId);
  }

  async save(account: Account): Promise<void> {
    await this.container.items.upsert(account);
  }
}

/** Saves a source to Cosmos DB (the record of truth) and then to the Search index, so searches find it. */
export class AzureSourceWriter implements SourceWriter {
  constructor(
    private readonly container: Container,
    private readonly search: AzureSourceSearch,
  ) {}

  async remove(accountId: string, sourceId: string): Promise<void> {
    try { await this.container.item(sourceId, accountId).delete(); }
    catch (err) { if ((err as { code: number }).code !== 404) throw err; }
    await this.search.remove(sourceId);
  }

  async save(source: SourceRecord): Promise<void> {
    if (source.kind !== "internal_app") { await this.container.items.upsert(source); await this.search.index([source]); return; }
    const item = this.container.item(source.id, source.accountId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const { resource } = await item.read<SourceRecord & { _etag: string }>();
      const next = sourceForUpdate(source, resource && withoutSystemFields(resource));
      try { if (resource) await item.replace(next, { accessCondition: { type: "IfMatch", condition: resource._etag } }); else await this.container.items.create(next); }
      catch (err) { if ([409, 412].includes((err as { code: number }).code)) continue; throw err; }
      const { resource: latest } = await item.read<SourceRecord>();
      await this.search.index([latest ? withoutSystemFields(latest) : source]); return;
    }
    throw new Error("Source update contention; retry sync.");
  }
}

/** Point read on a container partitioned by /id. Missing items return null rather than throwing. */
async function readById<T extends object>(container: Container, id: string): Promise<T | null> {
  const { resource, statusCode } = await container.item(id, id).read<T>();
  if (statusCode === 404 || !resource) return null;
  return withoutSystemFields(resource);
}

/** Drops Cosmos metadata (_rid, _etag, _ts...) so records match the shared contracts exactly. */
function withoutSystemFields<T extends object>(item: T): T {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_"))) as T;
}

export class CosmosAnalysisStore implements AnalysisStore {
  constructor(private readonly container: Container) {}
  private key(userId: string) { return `latest-${createHash("sha256").update(userId).digest("hex")}`; }
  async latest(accountId: string, userId: string): Promise<AgentAnalysis | null> {
    const { resource } = await this.container.item(this.key(userId), accountId).read<{ analysis: AgentAnalysis }>();
    return resource?.analysis ?? null;
  }
  async save(analysis: AgentAnalysis): Promise<void> {
    const item = this.container.item(this.key(analysis.createdBy), analysis.accountId);
    for (let i = 0; i < 8; i++) {
      const { resource } = await item.read<{ _etag: string; analysis: AgentAnalysis }>();
      if (resource && resource.analysis.generatedAt > analysis.generatedAt) return;
      const document = { id: this.key(analysis.createdBy), accountId: analysis.accountId, analysis };
      try {
        if (resource) await item.replace(document, { accessCondition: { type: "IfMatch", condition: resource._etag } });
        else await this.container.items.create(document);
        return;
      } catch (err) { if (![409, 412].includes((err as { code: number }).code)) throw err; }
    }
    throw new Error("Analysis contention; retry.");
  }
}

export class CosmosSourceReader {
  constructor(private readonly container: Container) {}
  async get(accountId: string, sourceId: string): Promise<SourceRecord | null> {
    const { resource } = await this.container.item(sourceId, accountId).read<SourceRecord>();
    return resource ? withoutSystemFields(resource) : null;
  }
}
