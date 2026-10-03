// Teammate 1's adapters. createAdapters() picks Azure for each service whose settings are present
// (see api/.env.example) and an in-memory or stub version otherwise, so the API runs without keys.
// In-memory storage and search start with the demo seed data.
import type { AccountDirectory } from "../access.js";
import { buildSeedSources, SEED_ACCOUNTS } from "../ingest/seed.js";
import type { TranscribeAudio } from "../ingest/meeting.js";
import { InMemoryAccountDirectory, InMemoryReportStore, type ReportStore } from "../store/reports.js";
import {
  connectCosmos,
  CosmosAccountDirectory,
  CosmosReportStore,
  CosmosSourceStore,
  InMemorySourceStore,
  type SourceStore,
} from "./cosmos.js";
import { createAzureSourceSearch, createInMemorySourceSearch, type SourceSearch } from "./search.js";
import { createAzureSpeechTranscriber, createStubTranscriber } from "./speech.js";
import { createTextGenerator, type TextGenerator } from "./text/index.js";

export * from "./cosmos.js";
export { AdapterError } from "./http.js";
export * from "./search.js";
export * from "./speech.js";
export * from "./text/index.js";

export type Adapters = {
  transcribeAudio: TranscribeAudio;
  textGenerator: TextGenerator;
  reports: ReportStore;
  accounts: AccountDirectory;
  sources: SourceStore;
  search: SourceSearch;
  /** Which implementation each service uses, for logs and the health check. */
  backends: { speech: string; model: string; storage: string; search: string };
};

export function createAdapters(env: NodeJS.ProcessEnv = process.env): Adapters {
  const speech = env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION
    ? createAzureSpeechTranscriber({ region: env.AZURE_SPEECH_REGION, key: env.AZURE_SPEECH_KEY })
    : undefined;

  const cosmos = env.COSMOS_ENDPOINT && env.COSMOS_KEY
    ? connectCosmos({ endpoint: env.COSMOS_ENDPOINT, key: env.COSMOS_KEY, database: env.COSMOS_DATABASE ?? "deeproot" })
    : undefined;

  const azureSearch = env.AZURE_SEARCH_ENDPOINT && env.AZURE_SEARCH_QUERY_KEY
    ? createAzureSourceSearch({
        endpoint: env.AZURE_SEARCH_ENDPOINT,
        index: env.AZURE_SEARCH_INDEX ?? "sources",
        queryKey: env.AZURE_SEARCH_QUERY_KEY,
        adminKey: env.AZURE_SEARCH_ADMIN_KEY,
      })
    : undefined;

  const seedSources = !cosmos || !azureSearch ? buildSeedSources() : [];

  return {
    transcribeAudio: speech ?? createStubTranscriber(),
    textGenerator: createTextGenerator(env),
    reports: cosmos ? new CosmosReportStore(cosmos.reports) : new InMemoryReportStore(),
    accounts: cosmos ? new CosmosAccountDirectory(cosmos.accounts) : new InMemoryAccountDirectory(SEED_ACCOUNTS),
    sources: cosmos ? new CosmosSourceStore(cosmos.sources) : new InMemorySourceStore(seedSources),
    search: azureSearch ?? createInMemorySourceSearch(seedSources),
    backends: {
      speech: speech ? "azure" : "stub",
      model: env.MODEL_PROVIDER ?? "stub",
      storage: cosmos ? "cosmos" : "memory",
      search: azureSearch ? "azure" : "memory",
    },
  };
}
