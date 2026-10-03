// Cosmos DB adapters for the backend's storage interfaces. Containers and partition keys are defined
// in infra/resources.bicep: reports and accounts by /id, sources by /accountId.
import { CosmosClient, type Container } from "@azure/cosmos";
import type { Account, MeetingReport, SourceRecord } from "@deeproot/shared";
import type { AccountDirectory } from "../access.js";
import type { ReportStore } from "../store/reports.js";
import type { SourceWriter } from "../store/sources.js";
import type { AzureSourceSearch } from "./search.js";

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

  async save(source: SourceRecord): Promise<void> {
    await this.container.items.upsert(source);
    await this.search.index([source]);
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
