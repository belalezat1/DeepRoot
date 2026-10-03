import type { AgentFinding, Citation, FindingType } from "@deeproot/shared";
import { validateCitation, type CitationScope } from "./citations.js";

export const MAX_FINDINGS = 12;

const TYPES: FindingType[] = ["risk", "blocker", "conflict", "commitment", "decision", "open_question", "fact"];
const SEVERITIES = ["high", "medium", "low"] as const;
const SEVERITY_TYPES = new Set<FindingType>(["risk", "blocker", "conflict"]);
const NO_OWNER = /^(unassigned|unknown|none|n\/a|tbd|null|nobody)$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export type ModelOutput = { summary: string; findings: unknown[] };

/** Parses the model's reply, tolerating a markdown fence. Returns null when it is not the expected shape. */
export function parseModelOutput(text: string): ModelOutput | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || !Array.isArray((json as { findings?: unknown }).findings)) return null;
  const { summary, findings } = json as { summary?: unknown; findings: unknown[] };
  return { summary: typeof summary === "string" ? summary.trim() : "", findings };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** True when some cited quote states this ISO date, as "2026-10-08", "October 8", "Oct. 8", "8 October", or "10/8". */
export function dateIsCited(isoDate: string, citations: Citation[]): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return false;
  const [, , mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  const name = MONTHS[month - 1];
  if (!name || day < 1 || day > 31) return false;
  const mon = name.slice(0, 3);
  const forms = [
    new RegExp(`\\b${isoDate}\\b`),
    new RegExp(`\\b(${name}|${mon}\\.?)\\s+0?${day}(?!\\d)`, "i"),
    new RegExp(`(?<!\\d)0?${day}\\s+(${name}|${mon})\\b`, "i"),
    new RegExp(`(?<![\\d/])0?${month}/0?${day}(?![\\d])`),
  ];
  return citations.some((c) => forms.some((re) => re.test(c.quote)));
}

type Grounded = { findings: AgentFinding[]; droppedCitations: number; droppedFindings: number };

/**
 * Keeps only findings backed by real evidence. Citations are re-checked against the sources; a
 * finding with no valid citation is dropped, as is a conflict that doesn't cite two different sources.
 * Owners and due dates survive only if a cited quote actually contains them; otherwise they become null.
 */
export function groundFindings(raw: unknown[], scope: CitationScope): Grounded {
  let droppedCitations = 0;
  let droppedFindings = 0;
  const kept: Array<Omit<AgentFinding, "id">> = [];

  for (const item of raw) {
    const f = (item ?? {}) as Record<string, unknown>;
    const type = f.type as FindingType;
    const title = str(f.title);
    const description = str(f.description);
    if (!TYPES.includes(type) || !title || !description) {
      droppedFindings++;
      continue;
    }

    const rawCitations = Array.isArray(f.citations) ? f.citations : [];
    const citations: Citation[] = [];
    for (const rc of rawCitations) {
      const c = validateCitation(rc, scope);
      if (!c) droppedCitations++;
      else if (!citations.some((x) => x.sourceId === c.sourceId && x.startOffset === c.startOffset)) citations.push(c);
    }
    const relatedSourceIds = [...new Set(citations.map((c) => c.sourceId))];
    if (citations.length === 0 || (type === "conflict" && relatedSourceIds.length < 2)) {
      droppedFindings++;
      continue;
    }

    const owner = str(f.owner);
    const dueDate = str(f.dueDate);
    const severity = SEVERITIES.find((s) => s === f.severity) ?? null;
    kept.push({
      type,
      title,
      description,
      basis: f.basis === "stated" ? "stated" : "inferred", // when unclear, claim less
      owner: owner && !NO_OWNER.test(owner) && citations.some((c) => c.quote.toLowerCase().includes(owner.toLowerCase())) ? owner : null,
      dueDate: dueDate && dateIsCited(dueDate, citations) ? dueDate : null,
      severity: SEVERITY_TYPES.has(type) ? severity : null,
      citations,
      relatedSourceIds,
    });
  }

  // Most severe first, then by type, then best corroborated. Array.sort is stable, so ties keep model order.
  const rank = (f: Omit<AgentFinding, "id">) => [
    f.severity ? SEVERITIES.indexOf(f.severity) : SEVERITIES.length,
    TYPES.indexOf(f.type),
    -f.relatedSourceIds.length,
  ];
  kept.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return 0;
  });

  return {
    findings: kept.slice(0, MAX_FINDINGS).map((f, i) => ({ id: `finding-${i + 1}`, ...f })),
    droppedCitations,
    droppedFindings: droppedFindings + Math.max(0, kept.length - MAX_FINDINGS),
  };
}
