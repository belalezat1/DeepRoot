// Opt-in provider verification. No live writes unless --create-test-issue is supplied.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { ACCOUNTS, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import { reportCitations, type ChatResponse, type ClaimCheckResponse, type MeetingReport, type DemoAppRecord } from "@deeproot/shared";
import { integrationConfig } from "../src/integrations/config.js";
import { createAdapters, connectCosmos, CosmosReportStore } from "../src/adapters/index.js";
import { meetingToSource, transcribeMeeting } from "../src/ingest/meeting.js";
import { buildSeedSources } from "../src/ingest/seed.js";
import { createReportGenerator } from "../src/reports/generator.js";
import { sanitizeReportDraft } from "../src/reports/validate.js";
import { createLinearIssue, findLinearIssue, type LinearConfig } from "../src/linear/client.js";
import { createBackend } from "../src/backend.js";
import { InMemoryAnalysisStore } from "../src/store/analyses.js";
import { InMemoryAccountDirectory, InMemoryReportStore } from "../src/store/reports.js";
import { InMemorySourceSearch } from "../src/store/sources.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this check.`);
  return value;
}

async function main() {
  const createTestIssue = process.argv.includes("--create-test-issue");
  // Validate write-check configuration before starting model calls.
  const linear: LinearConfig | null = createTestIssue ? { apiKey: required("LINEAR_API_KEY"), teamId: required("LINEAR_TEAM_ID") } : null;
  const cosmos = createTestIssue ? connectCosmos({ endpoint: required("COSMOS_ENDPOINT"), key: required("COSMOS_KEY"), database: process.env.COSMOS_DATABASE ?? "deeproot" }) : null;
  if (!process.env.MODEL_PROVIDER || process.env.MODEL_PROVIDER === "stub") throw new Error("Configure a real MODEL_PROVIDER to verify live reports.");
  const adapters = createAdapters();
  // Real model calls against fictional records, without writing to the deployed workspace.
  const connectors = integrationConfig(process.env);
  const backend = createBackend({ accounts: new InMemoryAccountDirectory(ACCOUNTS), sources: new InMemorySourceSearch(buildSeedSources()), reports: new InMemoryReportStore(), analyses: new InMemoryAnalysisStore(), model: adapters.chatModel, transcribeAudio: adapters.transcribeAudio }, { integrationConfig: connectors });
  const user = { userId: "presenter" };
  for (const [question, expected] of [
    ["What is blocking Northstar's payroll launch?", "answer"],
    ["Could you help automate renaming files on my laptop?", "out_of_scope"],
    ["How much does Maya take home every month?", "restricted"],
  ] as const) {
    const result = await backend.chat({ user, body: { accountId: "northstar", question } });
    const response = result.body as ChatResponse;
    if (result.status !== 200 || response.responseType !== expected || (expected === "answer" && (!response.grounded || !response.citations.length))) throw new Error(`Live Ask failed the ${expected} check.`);
  }
  const checked = await backend.checkClaim({ user, body: { accountId: "northstar", statement: "State tax setup is complete and the October 15 payroll launch has no risks." } });
  const verdict = checked.body as ClaimCheckResponse;
  if (checked.status !== 200 || verdict.verdict !== "contradicted" || !verdict.citations.length) throw new Error("Live Verify did not catch the unsupported launch promise.");
  console.log("Live Ask answered with evidence, declined semantic role/privacy violations, and Verify caught the conflicting promise.");
  const account = ACCOUNTS.find((a) => a.id === "northstar")!;
  let transcript = NORTHSTAR_MEETING_TRANSCRIPT;
  const audioPath = process.argv.find((arg) => arg.startsWith("--audio="))?.slice("--audio=".length);
  if (audioPath) {
    if (adapters.backends.speech !== "azure") throw new Error("Configure Azure Speech before checking audio.");
    const transcription = await transcribeMeeting({ audio: new Uint8Array(await readFile(audioPath)), transcribe: adapters.transcribeAudio, fileName: audioPath.split(/[\\/]/).at(-1) });
    transcript = transcription.transcript;
    console.log("Azure Speech produced a transcript; no prepared fallback was used.");
  }
  const generate = createReportGenerator(adapters.chatModel);
  const drafts = [];
  const addedCommitment = "Sam: I will send Maya a status update on October 8, 2026.";
  for (const [index, reviewed] of [transcript, `${transcript}\n${addedCommitment}`].entries()) {
    const meeting = meetingToSource({ account, meetingId: `verify-${crypto.randomUUID()}`, transcript: reviewed, occurredAt: "2026-10-03T12:00:00Z" });
    const sources = [meeting, ...buildSeedSources().filter((s) => s.accountId === account.id && s.allowedUserIds.includes("presenter"))];
    const raw = await generate({ account: { id: account.id, name: account.name }, transcript: meeting.body, meetingSourceId: meeting.id, meetingDate: meeting.occurredAt, sources });
    const result = sanitizeReportDraft(raw, { accountId: account.id, userId: "presenter", sourcesById: new Map(sources.map((s) => [s.id, s])) });
    if (!reportCitations(result.draft).length) throw new Error("The live report had no valid supporting citations.");
    drafts.push(result.draft);
    console.log(`Report ${index + 1}: generated with verified citations (${JSON.stringify(result.dropped)} removed).`);
  }
  if (!drafts[1]!.commitments.some((c) => c.owner === "Sam" && c.dueDate === "2026-10-08" && /status update/i.test(c.text) && c.citations.some((citation) => addedCommitment.includes(citation.quote) && /status update/i.test(citation.quote)))) {
    throw new Error("The altered transcript did not produce the added status-update commitment with its cited owner and date.");
  }
  console.log("Live report generation responds to the reviewed transcript.");
  if (connectors.demoEnabled) {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost");
      const result = await backend.integrations.export({ appId: "impl-tracker", customerKey: url.searchParams.get("customerKey") ?? "", token: req.headers.authorization?.replace(/^Bearer /, "") ?? "" });
      res.writeHead(result.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(result.body));
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address() as { port: number };
      connectors.http["impl-tracker"]!.url = `http://127.0.0.1:${address.port}/export`;
      const input = { user, accountId: "northstar", appId: "impl-tracker" };
      const rows = (await backend.integrations.demoRecords(input)).body as { records: DemoAppRecord[] };
      const record = rows.records.find(r => r.id === "IT-5120")!;
      const edited = await backend.integrations.edit({ ...input, recordId: record.id, body: { revision: record.revision, changes: { assignee: "Sam", status: "In progress", notes: "Sam owns the October 8 tax dependency follow-up; the tax setup itself remains incomplete." } } });
      if (edited.status !== 200 || (await backend.integrations.sync(input)).status !== 200) throw new Error("Sample-tool HTTP synchronization failed.");
      const refreshed = await backend.analyze({ user, body: { accountId: "northstar" } });
      if (refreshed.status !== 200) throw new Error("Updated source analysis failed.");
      const asked = await backend.chat({ user, body: { accountId: "northstar", question: "Who currently owns implementation tracker dependency IT-5120?" } });
      const answer = asked.body as ChatResponse;
      if (asked.status !== 200 || !answer.grounded || !/Sam/.test(answer.answer) || !answer.citations.some(c => c.sourceId === "northstar-impl-tracker-it-5120" && /Sam/.test(c.quote))) throw new Error("The changed sample tool did not change the grounded ownership answer.");
      console.log("Sample tracker edit → HTTP sync → refreshed analysis → cited owner answer passed with the real model. All data stayed local.");
    } finally { if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  if (!linear || !cosmos) return;

  const id = `verification-${crypto.randomUUID()}`;
  let issueId: string = crypto.randomUUID();
  const ticket = { title: "[Deeproot verification] UUID retry coordination", description: "Disposable integration check. This issue will be archived after verification.", acceptanceCriteria: ["One issue identity is returned across concurrent attempts and retries."], priority: "low" as const };
  const report: MeetingReport = { id, accountId: "northstar", createdBy: "presenter", createdAt: new Date().toISOString(), transcript: "Verification only.", summary: "Verification only.", decisions: [], commitments: [], risks: [], openQuestions: [], suggestedFollowUp: "", ticketDraft: ticket };
  const a = new CosmosReportStore(cosmos.reports), b = new CosmosReportStore(cosmos.reports);
  await a.save({ ...report, citedSources: [] });
  try {
    const candidate = { issueId, teamId: linear.teamId, ticket, description: ticket.description };
    const reservations = await Promise.all([a.reserveLinearCreation(id, candidate), b.reserveLinearCreation(id, { ...candidate, issueId: crypto.randomUUID() })]);
    if (reservations.filter((r) => r.reserved).length !== 1 || reservations.some((r) => r.report.linearCreation?.issueId !== reservations[0]!.report.linearCreation?.issueId)) {
      throw new Error("Cosmos did not choose one shared reservation.");
    }
    issueId = reservations[0]!.report.linearCreation!.issueId;
    console.log(`Verification issue UUID: ${issueId}`);
    console.log("Live Cosmos conditional updates chose one reservation across two adapters.");
    const input = { id: issueId, title: ticket.title, description: ticket.description, priority: ticket.priority };
    const outcomes = await Promise.allSettled([createLinearIssue(linear, input), createLinearIssue(linear, input)]);
    if (!outcomes.some((r) => r.status === "fulfilled")) throw new Error("Neither concurrent creation returned success; reconcile the printed UUID.");
    const found = await findLinearIssue(linear, issueId);
    if (!found) throw new Error("Linear lookup did not find the verification identity.");
    await b.completeLinearCreation(id, { identifier: found.identifier, url: found.url });
    const saved = await a.get(id);
    if (saved?.linearIssue?.identifier !== found.identifier || !saved.citedSources) throw new Error("Issue result or source snapshot did not persist.");
    // A subsequent create must either reject this ID or return the same entity.
    try {
      const retry = await createLinearIssue(linear, input);
      if (retry.id !== found.id || retry.identifier !== found.identifier) throw new Error("Linear changed identity on retry.");
    } catch (err) {
      const retry = await findLinearIssue(linear, issueId);
      if (retry?.identifier !== found.identifier) throw err;
    }
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: linear.apiKey },
      body: JSON.stringify({ query: "mutation Archive($id: String!) { issueArchive(id: $id) { success } }", variables: { id: issueId } }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { data?: { issueArchive?: { success?: boolean } }; errors?: unknown[] };
    if (!response.ok || result.errors?.length || result.data?.issueArchive?.success !== true) throw new Error("Verification passed but issue archival failed; archive the printed UUID manually.");
    if (!(await findLinearIssue(linear, issueId))) throw new Error("Archived issue lookup failed.");
    console.log(`Live Linear UUID retries reconciled ${found.identifier}; the verification issue is archived.`);
  } finally {
    await cosmos.reports.item(id, id).delete();
  }
}

main().catch((err: unknown) => {
  // Do not dump request objects, credentials, or SDK diagnostics.
  console.error(err instanceof Error ? err.message : "Workflow verification failed.");
  process.exitCode = 1;
});
