// Verification record for the Azure services, against live resources. Seed first (npm run seed:azure -w api).
// Run: npm run verify:azure -w api [-- path/to/meeting.wav]   (reads api/.env; exits 1 if any check fails)
import { readFile } from "node:fs/promises";
import { BETACO_CANARY, DEMO_USERS, SAMPLE_NORTHSTAR_REPORT } from "@deeproot/demo";
import { connectCosmos, createAdapters } from "../src/adapters/index.js";

const adapters = createAdapters();
const results: Array<{ check: string; ok: boolean; detail: string }> = [];

async function check(name: string, run: () => Promise<string>) {
  const start = Date.now();
  try {
    results.push({ check: name, ok: true, detail: `${await run()} (${Date.now() - start} ms)` });
  } catch (error) {
    results.push({ check: name, ok: false, detail: (error as Error).message.split("\n")[0]! });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log(`Backends: ${JSON.stringify(adapters.backends)}\n`);
assert(adapters.backends.storage === "cosmos" && adapters.backends.search === "azure", "Azure settings missing from api/.env");

await check("Cosmos: read account", async () => {
  const account = await adapters.accounts.getAccount("northstar");
  assert(account?.allowedUserIds.includes(DEMO_USERS.presenter), "northstar missing or presenter not allowed");
  assert((await adapters.accounts.getAccount("no-such-account")) === null, "missing account did not return null");
  return `northstar allows ${account.allowedUserIds.join(", ")}; unknown ID returns null`;
});

await check("Cosmos: write and read report", async () => {
  const report = { ...SAMPLE_NORTHSTAR_REPORT, id: `verify-${Date.now()}` };
  await adapters.reports.save(report);
  try {
    const stored = await adapters.reports.get(report.id);
    assert(JSON.stringify(stored) === JSON.stringify(report), "report read back differs from what was written");
  } finally {
    const { reports } = connectCosmos({
      endpoint: process.env.COSMOS_ENDPOINT!,
      key: process.env.COSMOS_KEY!,
      database: process.env.COSMOS_DATABASE ?? "deeproot",
    });
    await reports.item(report.id, report.id).delete();
  }
  return "round trip identical; test report deleted";
});

await check("Cosmos: list account sources", async () => {
  const sources = await adapters.sources.listByAccount("northstar");
  assert(sources.length > 0 && sources.every((s) => s.accountId === "northstar"), "no northstar sources");
  return `${sources.length} northstar sources`;
});

await check("Search: permitted results", async () => {
  const hits = await adapters.search.searchPermittedSources({
    accountId: "northstar",
    userId: DEMO_USERS.presenter,
    text: "payroll export Canada",
  });
  assert(hits.length > 0 && hits.every((s) => s.accountId === "northstar"), "no northstar results");
  return `${hits.length} northstar results, e.g. "${hits[0]!.title}"`;
});

await check("Search: BetaCo hidden from presenter", async () => {
  for (const accountId of ["betaco", "northstar"]) {
    const hits = await adapters.search.searchPermittedSources({
      accountId,
      userId: DEMO_USERS.presenter,
      text: `BetaCo payroll ${BETACO_CANARY}`,
      top: 50,
    });
    assert(hits.every((s) => s.accountId === "northstar"), `BetaCo record returned when querying ${accountId}`);
    assert(!JSON.stringify(hits).includes(BETACO_CANARY), "BetaCo canary leaked");
  }
  const own = await adapters.search.searchPermittedSources({ accountId: "betaco", userId: DEMO_USERS.betacoLead, text: "*" });
  assert(own.length > 0, "BetaCo data missing for its own lead, so the isolation check proves nothing");
  return `presenter sees 0 BetaCo records; BetaCo lead sees ${own.length}`;
});

await check("Model: generate", async () => {
  const result = await adapters.textGenerator.generateText({
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    maxOutputTokens: 200,
  });
  assert(result.text.trim().length > 0, "empty reply");
  return `${result.provider} ${result.model}: "${result.text.trim().slice(0, 40)}"`;
});

const wavPath = process.argv[2];
if (wavPath) {
  await check("Speech: transcribe WAV", async () => {
    const segments = await adapters.transcribeAudio(new Uint8Array(await readFile(wavPath)));
    assert(segments.length > 0, "no segments");
    const speakers = new Set(segments.map((s) => s.speaker ?? "?"));
    return `${segments.length} segments, speakers ${[...speakers].join(", ")}: "${segments[0]!.text}"`;
  });
} else {
  results.push({ check: "Speech: transcribe WAV", ok: true, detail: "skipped (pass a WAV path to include it)" });
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(36)} ${r.detail}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
