import type { Citation, Commitment, Risk, SourceRecord, TicketDraft, TicketPriority } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import { verifyCitations } from "./citations.js";
import type { ReportDraft } from "./generator.js";

export type SanitizeResult = {
  draft: ReportDraft;
  /** How much was removed, for logging: a high count means the prompt needs work. */
  dropped: { citations: number; items: number; owners: number; dueDates: number };
};

const PRIORITIES: TicketPriority[] = ["low", "medium", "high"];
const MAX_TEXT = 2000;

/**
 * Turns untrusted model output into a ReportDraft that is safe to save and show.
 * - Throws INVALID_MODEL_OUTPUT when the overall shape is unusable.
 * - Drops citations that are not verbatim quotes from a permitted source.
 * - Drops decisions, commitments, and risks left with no valid citation.
 * - Sets owner to null unless the name appears in the evidence; sets malformed dates to null.
 */
export function sanitizeReportDraft(raw: unknown, permitted: Map<string, SourceRecord>): SanitizeResult {
  const dropped = { citations: 0, items: 0, owners: 0, dueDates: 0 };
  const r = raw as Partial<Record<keyof ReportDraft, unknown>> | null;
  if (!r || typeof r !== "object") invalid("Report is not an object.");

  const cite = (list: unknown): Citation[] => {
    const kept = verifyCitations(list, permitted);
    dropped.citations += (Array.isArray(list) ? list.length : 0) - kept.length;
    return kept;
  };

  const decisions = asArray(r.decisions, "decisions").flatMap((d) => {
    const text = optionalText((d as { text?: unknown })?.text);
    const citations = cite((d as { citations?: unknown })?.citations);
    if (!text || citations.length === 0) return dropItem(dropped);
    return [{ text, citations }];
  });

  const commitments = asArray(r.commitments, "commitments").flatMap((c): Commitment[] => {
    const raw = c as Partial<Record<keyof Commitment, unknown>>;
    const text = optionalText(raw?.text);
    const citations = cite(raw?.citations);
    if (!text || citations.length === 0) return dropItem(dropped);

    let owner = optionalText(raw.owner);
    if (owner && !ownerInEvidence(owner, citations, permitted)) {
      owner = null;
      dropped.owners++;
    }
    let dueDate = optionalText(raw.dueDate);
    if (dueDate && !isIsoDate(dueDate)) {
      dueDate = null;
      dropped.dueDates++;
    }
    const risk = optionalText(raw.risk);
    return [{ text, owner, dueDate, citations, ...(risk ? { risk } : {}) }];
  });

  const risks = asArray(r.risks ?? [], "risks").flatMap((k): Risk[] => {
    const text = optionalText((k as { text?: unknown })?.text);
    const citations = cite((k as { citations?: unknown })?.citations);
    if (!text || citations.length === 0) return dropItem(dropped);
    return [{ text, citations }];
  });

  return {
    draft: {
      summary: requiredText(r.summary, "summary"),
      decisions,
      commitments,
      risks,
      openQuestions: asArray(r.openQuestions ?? [], "openQuestions").map(optionalText).filter((q): q is string => !!q),
      suggestedFollowUp: optionalText(r.suggestedFollowUp) ?? "",
      ticketDraft: parseTicketDraft(r.ticketDraft),
    },
    dropped,
  };
}

function parseTicketDraft(raw: unknown): TicketDraft {
  const t = raw as Partial<Record<keyof TicketDraft, unknown>> | null;
  if (!t || typeof t !== "object") invalid("ticketDraft is missing.");
  const acceptanceCriteria = asArray(t.acceptanceCriteria, "ticketDraft.acceptanceCriteria")
    .map(optionalText)
    .filter((c): c is string => !!c);
  if (acceptanceCriteria.length === 0) invalid("ticketDraft has no acceptance criteria.");
  const priority = PRIORITIES.includes(t.priority as TicketPriority) ? (t.priority as TicketPriority) : "medium";
  return {
    title: requiredText(t.title, "ticketDraft.title"),
    description: optionalText(t.description) ?? "",
    acceptanceCriteria,
    priority,
  };
}

/** An owner counts as evidenced if their first name appears in a source the commitment cites. */
function ownerInEvidence(owner: string, citations: Citation[], permitted: Map<string, SourceRecord>): boolean {
  const firstName = owner.split(/\s+/)[0]!.toLowerCase();
  if (firstName.length < 2) return false;
  return citations.some((c) => permitted.get(c.sourceId)?.body.toLowerCase().includes(firstName));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dropItem(dropped: SanitizeResult["dropped"]): [] {
  dropped.items++;
  return [];
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be a list.`);
  return value;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /^(unknown|n\/a|none|null|tbd)$/i.test(text)) return null;
  return text.slice(0, MAX_TEXT);
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) invalid(`${field} is missing.`);
  return text;
}

function invalid(detail: string): never {
  console.error(`Rejected model report: ${detail}`);
  throw new ApiFailure("INVALID_MODEL_OUTPUT", "The report could not be generated. Please try again.");
}
