// Teammate 1's adapters. createAdapters() picks Azure for each service whose settings are present
// (see api/.env.example) and an in-memory or stub version otherwise, so the API runs without keys.
// In-memory search starts with the demo seed data.
import { InMemoryAnalysisStore, type AnalysisStore } from "../store/analyses.js";
import { AuthoritativeSourceSearch } from "./authoritativeSearch.js";
import { CosmosIntegrationStore, InMemoryIntegrationStore, type IntegrationStore } from "../integrations/store.js";
import type { AccountDirectory } from "../access.js";
import type { ChatModel } from "../agent/model.js";
import type { TranscribeAudio } from "../ingest/meeting.js";
import { buildSeedSources, SEED_ACCOUNTS } from "../ingest/seed.js";
import { InMemoryAccountDirectory, InMemoryReportStore, type ReportStore } from "../store/reports.js";
import { InMemorySourceSearch, type SourceSearch, type SourceWriter } from "../store/sources.js";
import { AzureSourceWriter, connectCosmos, CosmosAccountDirectory, CosmosReportStore, CosmosSourceReader, CosmosAnalysisStore } from "./cosmos.js";
import { AzureSourceSearch } from "./search.js";
import { createAzureSpeechTranscriber, createStubTranscriber } from "./speech.js";
import { createChatModel } from "./text/chatModel.js";
import { createTextGenerator, type TextGenerator } from "./text/index.js";

export * from "./cosmos.js";
export { AdapterError } from "./http.js";
export * from "./search.js";
export * from "./speech.js";
export { createChatModel } from "./text/chatModel.js";
export * from "./text/index.js";

export type Adapters = {
  transcribeAudio: TranscribeAudio;
  textGenerator: TextGenerator;
  chatModel: ChatModel;
  integrationStore: IntegrationStore;
  analyses: AnalysisStore;
  reports: ReportStore;
  accounts: AccountDirectory;
  search: SourceSearch;
  sourceWriter: SourceWriter;
  /** Which implementation each service uses, for logs and checks. */
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
    ? new AzureSourceSearch({
        endpoint: env.AZURE_SEARCH_ENDPOINT,
        index: env.AZURE_SEARCH_INDEX ?? "sources",
        queryKey: env.AZURE_SEARCH_QUERY_KEY,
        adminKey: env.AZURE_SEARCH_ADMIN_KEY,
      })
    : undefined;

  // Writing a source needs both Cosmos and Search; otherwise one in-memory store serves search and writes.
  const memory = cosmos && azureSearch ? undefined : new InMemorySourceSearch(buildSeedSources());
  const textGenerator = createTextGenerator(env);

  const reader = cosmos && azureSearch ? new CosmosSourceReader(cosmos.sources) : memory!;
  const search: SourceSearch = memory ?? new AuthoritativeSourceSearch(azureSearch!, reader);
  return {
    integrationStore: cosmos ? new CosmosIntegrationStore(cosmos.integrations) : new InMemoryIntegrationStore(),
    analyses: cosmos ? new CosmosAnalysisStore(cosmos.briefs) : new InMemoryAnalysisStore(),
    transcribeAudio: speech ?? createStubTranscriber(),
    textGenerator,
    chatModel: createChatModel(textGenerator),
    reports: cosmos ? new CosmosReportStore(cosmos.reports) : new InMemoryReportStore(),
    accounts: cosmos ? new CosmosAccountDirectory(cosmos.accounts) : new InMemoryAccountDirectory(SEED_ACCOUNTS),
    search,
    sourceWriter: memory ?? new AzureSourceWriter(cosmos!.sources, azureSearch!),
    backends: {
      speech: speech ? "azure" : "stub",
      model: env.MODEL_PROVIDER ?? "stub",
      storage: cosmos ? "cosmos" : "memory",
      search: memory ? "memory" : "azure",
    },
  };
}
