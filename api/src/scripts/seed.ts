// Loads the demo corpus into Azure: accounts and sources into Cosmos DB, sources into AI Search.
// Safe to rerun: every write is an upsert by ID. Run: npm run seed -w api   (reads api/.env)
import { connectCosmos, CosmosAccountDirectory } from "../adapters/cosmos.js";
import { AzureSourceSearch } from "../adapters/search.js";
import { buildSeedSources, SEED_ACCOUNTS } from "../ingest/seed.js";

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
const search = new AzureSourceSearch({
  endpoint: required("AZURE_SEARCH_ENDPOINT"),
  index: process.env.AZURE_SEARCH_INDEX ?? "sources",
  queryKey: required("AZURE_SEARCH_QUERY_KEY"),
  adminKey: required("AZURE_SEARCH_ADMIN_KEY"),
});

const accounts = new CosmosAccountDirectory(cosmos.accounts);
for (const account of SEED_ACCOUNTS) await accounts.save(account);

const sources = buildSeedSources();
for (const source of sources) await cosmos.sources.items.upsert(source);
await search.index(sources);

const counts = new Map<string, number>();
for (const s of sources) counts.set(s.accountId, (counts.get(s.accountId) ?? 0) + 1);
console.log(`Seeded ${SEED_ACCOUNTS.length} accounts and ${sources.length} sources:`);
for (const [accountId, count] of counts) console.log(`  ${accountId.padEnd(12)} ${count} sources`);
