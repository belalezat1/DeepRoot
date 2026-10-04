import { ASSISTANT_ROLE_RULES, assistantBoundary, type Account, type Citation, type ClaimResult, type InvestigationStep, type SourceRecord } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import type { ChatModel } from "../agent/model.js";
import type { SourceSearch } from "../store/sources.js";
import { assertContextIsolated } from "../agent/analyze.js";
import { accountTeamSources } from "../dataPolicy.js";
import { callJsonModel, checkCitations, recordsBlock, TRUST_RULES, CITATION_RULES } from "./context.js";

export const SCOPE_PROMPT = `DEEProot phase: scope/planning. ${TRUST_RULES}\n${ASSISTANT_ROLE_RULES}
Classify the request semantically BEFORE any records are read. If allowed, plan up to two short account-specific search queries.
For Verify, split the ORIGINAL statement into at most eight contiguous text spans covering ALL its text. Use exact start/end character offsets; do not paraphrase or omit clauses. If more than eight claims are needed, set oversized:true.
Return {"scope":"allowed"|"restricted"|"out_of_scope", "queries":[string], "spans":[{"start":number,"end":number}], "oversized":boolean}. Questions need no spans.`;
export const SEMANTIC_PROMPT = `DEEProot phase: evidence verification. ${TRUST_RULES}\n${ASSISTANT_ROLE_RULES}
Verify EACH candidate independently using only its cited evidence. A real quote is not sufficient: its meaning must support the entire claim, including status, owner, date and numbers. History is not evidence. Distinguish old statements from current tool state; do not erase unrelated blockers.
For proposed actions, check factual premises and avoid treating requests as confirmed promises. Only mark supported when ALL factual premises are established. Contradicted means evidence explicitly conflicts; otherwise uncertain.
${CITATION_RULES}
Return {"results":[{"id":string,"verdict":"supported"|"contradicted"|"uncertain","explanation":string,"citations":[{"sourceId":string,"quote":string}]}]} with exactly one result for every candidate ID.`;

export type Candidate = { id: string; text: string; citations: Citation[]; proposed?: boolean };
export type Investigation = { sources: SourceRecord[]; draft: Record<string, unknown>; claims: string[]; steps: InvestigationStep[]; signal: AbortSignal; boundary?: "restricted" | "out_of_scope" };

export async function verifyCandidates(model: ChatModel, candidates: Candidate[], sources: SourceRecord[], account: Account, userId: string, signal: AbortSignal): Promise<Map<string, ClaimResult>> {
  if (!candidates.length) return new Map();
  const out = await callJsonModel(model, SEMANTIC_PROMPT, JSON.stringify({ candidates, records: JSON.parse(recordsBlock(sources)).records }), Math.min(8000, Math.max(3500, candidates.length * 250)), v => Array.isArray(v.results), "evidence", signal);
  const results = out.results as Array<Record<string, unknown>>;
  const byId = new Map(sources.map(s => [s.id, s]));
  const verified = new Map<string, ClaimResult>();
  for (const candidate of candidates) {
    const matches = results.filter(r => r && typeof r === "object" && r.id === candidate.id);
    const result = matches.length === 1 ? matches[0]! : {};
    // The verifier may only use evidence the generating phase actually attached to this candidate.
    const allowed = new Set(candidate.citations.map(c => `${c.sourceId}\0${c.quote}`));
    const citations = checkCitations(result.citations, { accountId: account.id, userId, sourcesById: byId }).filter(c => allowed.has(`${c.sourceId}\0${c.quote}`));
    const verdict = citations.length && (result.verdict === "supported" || result.verdict === "contradicted") ? result.verdict : "uncertain";
    const explanation = typeof result.explanation === "string" && !assistantBoundary(result.explanation) ? result.explanation.slice(0, 1000) : "The permitted evidence does not establish this claim.";
    verified.set(candidate.id, { claim: candidate.text, verdict, explanation: citations.length ? explanation : "The permitted evidence does not establish this claim.", citations });
  }
  return verified;
}

export async function investigate(input: { question: string; mode: "ask" | "verify"; history?: unknown; extra?: SourceRecord[] | (() => Promise<SourceRecord[]>) }, deps: { model: ChatModel; search: SourceSearch; account: Account; userId: string; system: string }): Promise<Investigation> {
  const signal = AbortSignal.timeout(40_000);
  const steps: InvestigationStep[] = [];
  const planned = await callJsonModel(deps.model, SCOPE_PROMPT, JSON.stringify({ request: input.question, mode: input.mode, history: input.history ?? [] }), 1400, v => ["allowed", "restricted", "out_of_scope"].includes(String(v.scope)), "scope", signal);
  if (planned.scope !== "allowed") return { sources: [], draft: {}, claims: [], steps, signal, boundary: planned.scope as "restricted" | "out_of_scope" };
  if (planned.oversized === true) throw new ApiFailure("BAD_REQUEST", "Check at most eight claims at a time. Shorten this statement.");
  let claims: string[] = [];
  if (input.mode === "verify") {
    const spans = Array.isArray(planned.spans) ? planned.spans as Array<{ start: number; end: number }> : [];
    let end = 0;
    if (spans.length > 8) throw new ApiFailure("BAD_REQUEST", "Check at most eight claims at a time.");
    const complete = spans.length > 0 && spans.every(s => {
      const valid = !!s && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start === end && s.end > s.start && s.end <= input.question.length;
      if (s) end = s.end; return valid;
    }) && end === input.question.length;
    // An imperfect decomposition must never silently omit input. Check the whole statement instead.
    claims = complete ? spans.map(s => input.question.slice(s.start, s.end).trim()).filter(Boolean) : [input.question];
  }
  const records = new Map<string, SourceRecord>();
  const extra = typeof input.extra === "function" ? await input.extra() : input.extra ?? [];
  assertContextIsolated(extra, deps.account, deps.userId);
  for (const source of accountTeamSources(extra)) records.set(source.id, source);
  const extraIds = new Set(extra.map(s => s.id));
  const add = (sources: SourceRecord[]) => {
    assertContextIsolated(sources, deps.account, deps.userId);
    for (const source of accountTeamSources(sources)) if ((!records.has(source.id) && records.size < 20) || (records.has(source.id) && !extraIds.has(source.id))) records.set(source.id, source);
  };
  const queries = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((q): q is string => typeof q === "string" && !!q.trim() && q.length <= 250 && !assistantBoundary(q)))].slice(0, 2) : [];
  const run = async (query: string, top: number) => {
    signal.throwIfAborted();
    const found = await deps.search.search({ accountId: deps.account.id, userId: deps.userId, query, top, signal });
    add(found); steps.push({ action: "search", label: query ? `Searched account records: ${query}` : "Read recent account records", sourceCount: found.length });
  };
  const first = queries(planned.queries);
  await Promise.all([run("", 10), ...first.map(q => run(q, 5))]);
  if (!records.size) return { sources: [], draft: {}, claims, steps, signal };
  const userPrompt = () => JSON.stringify({ question: input.question, statement: input.question, claims, history: input.history ?? [], records: JSON.parse(recordsBlock([...records.values()])).records });
  const assessment = `${deps.system}\nDEEProot phase: evidence assessment. You may additionally return nextQueries:[string] with up to two targeted queries ONLY if specific evidence is missing. For Verify return claimResults with one result per supplied claim, using that exact claim text. For Ask additionally return facts:[{text:string,citations:[{sourceId:string,quote:string}]}] splitting the complete answer into supported sentences. These facts must cover the entire answer.`;
  let draft = await callJsonModel(deps.model, assessment, userPrompt(), 2600, () => true, "investigation", signal);
  const next = queries(draft.nextQueries);
  if (next.length) {
    await Promise.all(next.map(q => run(q, 5)));
    draft = await callJsonModel(deps.model, `${assessment}\nDEEProot phase: final synthesis. No more tool calls are available. Answer only what the retrieved evidence establishes.`, userPrompt(), 2600, () => true, "investigation", signal);
  }
  steps.push({ action: "compare", label: "Compared retrieved evidence and historical context", sourceCount: records.size });
  return { sources: [...records.values()], draft, claims, steps, signal };
}
