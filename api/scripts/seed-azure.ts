// Loads the demo corpus into Azure: accounts and sources into Cosmos DB, sources into AI Search.
// Safe to rerun (upserts by ID). Run: npm run seed:azure -w api   (reads api/.env)
import {
  connectCosmos,
  CosmosAccountDirectory,
  CosmosSourceStore,
  createAzureSourceSearch,
} from "../src/adapters/index.js";
import { buildSeedSources, SEED_ACCOUNTS } from "../src/ingest/seed.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run .\\infra\\write-local-settings.ps1 first.`);
  return value;
}

const cosmos = connectCosmos({
  endpoint: required("COSMOS_ENDPOINT"),
  key: required("COSMOS_KEY"),
  database: process.env.COSMOS_DATABASE ?? "deeproot",
});
const search = createAzureSourceSearch({
  endpoint: required("AZURE_SEARCH_ENDPOINT"),
  index: process.env.AZURE_SEARCH_INDEX ?? "sources",
  queryKey: required("AZURE_SEARCH_QUERY_KEY"),
  adminKey: required("AZURE_SEARCH_ADMIN_KEY"),
});

const sources = buildSeedSources();

await new CosmosAccountDirectory(cosmos.accounts).upsertMany(SEED_ACCOUNTS);
await new CosmosSourceStore(cosmos.sources).upsertMany(sources);
await search.indexSources(sources);

const byAccount = Object.groupBy(sources, (s) => s.accountId);
console.log(`Seeded ${SEED_ACCOUNTS.length} accounts and ${sources.length} sources:`);
for (const [accountId, records] of Object.entries(byAccount)) {
  console.log(`  ${accountId.padEnd(12)} ${records?.length ?? 0} sources`);
}
