import { verifyCandidates } from "../qa/investigate.js";
import { checkCitations } from "../qa/context.js";
import type { MeetingReport, PublicAccount, SourceRecord } from "@deeproot/shared";
import { SAMPLE_NORTHSTAR_REPORT, SAMPLE_SOURCE_IDS } from "@deeproot/demo";
import { reportCitations } from "@deeproot/shared";
import type { ChatModel } from "../agent/model.js";
import { callJsonModel } from "../agent/json.js";
import { promptRecord } from "../agent/prompt.js";
import { CITATION_RULES, TRUST_RULES } from "../qa/context.js";

/** The part of a MeetingReport the AI writes; the backend adds IDs, transcript, and timestamps. */
export type ReportDraft = Pick<
  MeetingReport,
  "summary" | "decisions" | "commitments" | "risks" | "openQuestions" | "suggestedFollowUp" | "ticketDraft" | "ticketStatus" | "summaryCitations" | "followUpCitations" | "ticketCitations"
>;

export type GenerateReportInput = {
  account: PublicAccount;
  userId?: string;
  /** The presenter-reviewed transcript. */
  transcript: string;
  /** Cite transcript lines with this source ID. */
  meetingSourceId: string;
  meetingDate: string;
  /** Only sources this user may see, already filtered. Includes the meeting itself. */
  sources: SourceRecord[];
};

/**
 * The backend treats generator output as untrusted:
 * it is shape-checked and every citation is verified before anything is saved or shown.
 */
export type GenerateReport = (input: GenerateReportInput) => Promise<ReportDraft>;

export const REPORT_SYSTEM_PROMPT = `Write a meeting-to-action report for one client account, using only the reviewed meeting and account records supplied.
${TRUST_RULES}
${CITATION_RULES}

Distinguish decisions, actual commitments, risks, and proposed follow-up. Every decision, commitment, and risk needs supporting citations.
Keep missing or unconfirmed owners and dates null. A person mentioning a problem is not its owner. Use YYYY-MM-DD only when evidence establishes the date.
Connect the meeting to emails and internal tools; highlight conflicting dates and missing dependencies. Do not reuse facts from any other meeting or account. NEW decisions and commitments MUST cite this reviewed meeting, not just background records. Treat older emails as historical statements; current tool records establish current configuration and assignment. A tool update does not erase unrelated blockers.
Summary must lead with what the reviewed meeting actually decided, committed to, or left unresolved, then contextual risks. Do not substitute the background account brief for a meeting report. Summary must describe only supported findings. Open questions, suggestedFollowUp, and the ticket are proposals, not promises that someone already made.
Use ticketStatus "none" and an empty ticket draft if no actionable task is established. Otherwise use ticketStatus "proposed".
Draft actionable acceptance criteria based on the supplied evidence. Do not invent numbers, owners, or deadlines in the ticket.

Return only this JSON object:
{"summary": string, "decisions": [{"text": string, "citations": [{"sourceId": string, "quote": string}]}],
"commitments": [{"text": string, "owner": string | null, "dueDate": string | null, "citations": [{"sourceId": string, "quote": string}]}],
"risks": [{"text": string, "citations": [{"sourceId": string, "quote": string}]}], "openQuestions": [string],
"suggestedFollowUp": string, "ticketDraft": {"title": string, "description": string, "acceptanceCriteria": [string], "priority": "low" | "medium" | "high"}}`;

/** Live generation; the handler validates every citation before saving or displaying the draft. */
export function createReportGenerator(model: ChatModel): GenerateReport {
  return async (input) => {
    const contextSources = input.sources.filter(s => s.kind !== "meeting" || s.id === input.meetingSourceId);
    const records = contextSources.map((source) => {
      const record = promptRecord(source);
      // The reviewed meeting must remain complete, even when longer than other context records.
      return source.id === input.meetingSourceId ? { ...record, body: input.transcript } : record;
    });
    const signal = AbortSignal.timeout(40_000);
    const result = await callJsonModel(model, REPORT_SYSTEM_PROMPT, JSON.stringify({
      account: input.account, meetingSourceId: input.meetingSourceId, meetingDate: input.meetingDate, records,
    }), 4000, (value) => {
      const ticket = value.ticketDraft as Partial<ReportDraft["ticketDraft"]> | null;
      const factShape = (list: unknown) => Array.isArray(list) && list.every(item => item && typeof item === "object" && typeof item.text === "string" && Array.isArray(item.citations));
      return typeof value.summary === "string" && !!value.summary.trim() &&
        [value.decisions, value.commitments, value.risks].every(factShape) && Array.isArray(value.openQuestions) && typeof value.suggestedFollowUp === "string" &&
        typeof ticket?.title === "string" && (!!ticket.title.trim() || value.ticketStatus === "none") && Array.isArray(ticket.acceptanceCriteria) &&
        (value.ticketStatus === "none" || ticket.acceptanceCriteria.some((c) => typeof c === "string" && c.trim().length > 0));
    }, "report", signal);
    const draft = result as ReportDraft;
    const userId = input.userId ?? input.sources[0]?.allowedUserIds[0] ?? "presenter";
    const scope = { accountId: input.account.id, userId, sourcesById: new Map(contextSources.map(s => [s.id, s])) };
    for (const list of [draft.decisions, draft.commitments, draft.risks]) {
      if (list.length > 12) list.splice(12);
      for (const item of list) item.citations = checkCitations(item.citations, scope);
    }
    draft.decisions = draft.decisions.filter(d => d.citations.some(c => c.sourceId === input.meetingSourceId));
    draft.commitments = draft.commitments.filter(c => c.citations.some(citation => citation.sourceId === input.meetingSourceId));
    const lists = { decisions: draft.decisions, commitments: draft.commitments, risks: draft.risks };
    const evidence = reportCitations(draft);
    const candidates = Object.entries(lists).flatMap(([kind, list]) => list.map((item, i) => ({ id: `${kind}-${i}`, text: `${item.text}${"owner" in item && item.owner ? ` Owner: ${item.owner}.` : ""}${"dueDate" in item && item.dueDate ? ` Due: ${item.dueDate}.` : ""}`, citations: item.citations })));
    candidates.push({ id: "summary", text: draft.summary, citations: evidence });
    draft.openQuestions = draft.openQuestions.filter(q => typeof q === "string").slice(0, 8);
    const proposed = [
      ...draft.openQuestions.map((q, i) => ({ id: `question-${i}`, text: q, citations: evidence, proposed: true })),
      { id: "followUp", text: draft.suggestedFollowUp, citations: evidence, proposed: true },
      { id: "ticket", text: JSON.stringify(draft.ticketDraft), citations: evidence, proposed: true },
    ].filter(c => !!c.text && evidence.length > 0);
    const verified = await verifyCandidates(model, [...candidates, ...proposed], contextSources, { ...input.account, allowedUserIds: [userId] }, userId, signal);
    draft.decisions = draft.decisions.filter((_, i) => verified.get(`decisions-${i}`)?.verdict === "supported");
    draft.commitments = draft.commitments.filter((_, i) => verified.get(`commitments-${i}`)?.verdict === "supported");
    draft.risks = draft.risks.filter((_, i) => verified.get(`risks-${i}`)?.verdict === "supported");
    draft.openQuestions = draft.openQuestions.filter((_, i) => verified.get(`question-${i}`)?.verdict === "supported");
    const summarySupported = verified.get("summary")?.verdict === "supported" && verified.get("summary")!.citations.some(c => c.sourceId === input.meetingSourceId);
    draft.summaryCitations = summarySupported ? verified.get("summary")!.citations : reportCitations(draft);
    draft.followUpCitations = verified.get("followUp")?.verdict === "supported" ? verified.get("followUp")!.citations : [];
    draft.ticketCitations = verified.get("ticket")?.verdict === "supported" ? verified.get("ticket")!.citations : [];
    const facts = [...draft.decisions, ...draft.commitments, ...draft.risks];
    if (!summarySupported) draft.summary = facts.map(f => f.text).join(" ") || "No decisions, commitments or risks could be established from the reviewed evidence.";
    if (verified.get("followUp")?.verdict !== "supported") draft.suggestedFollowUp = "";
    if (!facts.length || verified.get("ticket")?.verdict !== "supported" || draft.ticketStatus === "none") {
      draft.ticketStatus = "none";
      draft.ticketDraft = { title: "", description: "", acceptanceCriteria: [], priority: "medium" };
    } else draft.ticketStatus = "proposed";
    return draft;
  };
}

/**
 * Explicit fixture for tests and offline previews: returns the hand-written Northstar report, with its
 * meeting citations pointed at this meeting's source ID.
 */
export const sampleReportGenerator: GenerateReport = async (input) => {
  const { summary, decisions, commitments, risks, openQuestions, suggestedFollowUp, ticketDraft } =
    structuredClone(SAMPLE_NORTHSTAR_REPORT);
  const draft: ReportDraft = { summary, decisions, commitments, risks, openQuestions, suggestedFollowUp, ticketDraft };
  const citations = reportCitations(draft);
  for (const c of citations) {
    if (c.sourceId === SAMPLE_SOURCE_IDS.meeting) c.sourceId = input.meetingSourceId;
  }
  return draft;
};
