// Cosmos DB adapters for the backend's storage interfaces. Containers and partition keys are defined
// in infra/resources.bicep: reports and accounts by /id, sources by /accountId.
import { CosmosClient, type Container } from "@azure/cosmos";
import type { Account, MeetingReport, SourceRecord } from "@deeproot/shared";
import type { AccountDirectory } from "../access.js";
import type { ReportStore } from "../store/reports.js";

/** Reads and writes source records, partitioned by account. */
export interface SourceStore {
  listByAccount(accountId: string): Promise<SourceRecord[]>;
  upsertMany(sources: SourceRecord[]): Promise<void>;
}

export type CosmosContainers = {
  reports: Container;
  accounts: Container;
  sources: Container;
};

export function connectCosmos(config: { endpoint: string; key: string; database: string }): CosmosContainers {
  const database = new CosmosClient({ endpoint: config.endpoint, key: config.key }).database(config.database);
  return {
    reports: database.container("reports"),
    accounts: database.container("accounts"),
    sources: database.container("sources"),
  };
}

export class CosmosReportStore implements ReportStore {
  constructor(private readonly container: Container) {}

  async get(reportId: string): Promise<MeetingReport | null> {
    return readById<MeetingReport>(this.container, reportId);
  }

  async save(report: MeetingReport): Promise<void> {
    await this.container.items.upsert(report);
  }
}

export class CosmosAccountDirectory implements AccountDirectory {
  constructor(private readonly container: Container) {}

  async getAccount(accountId: string): Promise<Account | null> {
    return readById<Account>(this.container, accountId);
  }

  async upsertMany(accounts: Account[]): Promise<void> {
    for (const account of accounts) await this.container.items.upsert(account);
  }
}

export class CosmosSourceStore implements SourceStore {
  constructor(private readonly container: Container) {}

  async listByAccount(accountId: string): Promise<SourceRecord[]> {
    const { resources } = await this.container.items
      .query<SourceRecord>(
        { query: "SELECT * FROM c WHERE c.accountId = @accountId", parameters: [{ name: "@accountId", value: accountId }] },
        { partitionKey: accountId },
      )
      .fetchAll();
    return resources.map(withoutSystemFields);
  }

  async upsertMany(sources: SourceRecord[]): Promise<void> {
    for (const source of sources) await this.container.items.upsert(source);
  }
}

export class InMemorySourceStore implements SourceStore {
  private readonly sources = new Map<string, SourceRecord>();

  constructor(initial: SourceRecord[] = []) {
    for (const s of initial) this.sources.set(s.id, structuredClone(s));
  }

  async listByAccount(accountId: string) {
    return [...this.sources.values()].filter((s) => s.accountId === accountId).map((s) => structuredClone(s));
  }

  async upsertMany(sources: SourceRecord[]) {
    for (const s of sources) this.sources.set(s.id, structuredClone(s));
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
