import type { MeetingReport, PublicAccount, SourceRecord } from "@deeproot/shared";
import { SAMPLE_NORTHSTAR_REPORT, SAMPLE_SOURCE_IDS } from "@deeproot/demo";

/** The part of a MeetingReport the AI writes; the backend adds IDs, transcript, and timestamps. */
export type ReportDraft = Pick<
  MeetingReport,
  "summary" | "decisions" | "commitments" | "risks" | "openQuestions" | "suggestedFollowUp" | "ticketDraft"
>;

export type GenerateReportInput = {
  account: PublicAccount;
  /** The presenter-reviewed transcript. */
  transcript: string;
  /** Cite transcript lines with this source ID. */
  meetingSourceId: string;
  meetingDate: string;
  /** Only sources this user may see, already filtered. Includes the meeting itself. */
  sources: SourceRecord[];
};

/**
 * Teammate 3's AI workflow implements this. The backend treats the result as untrusted:
 * it is shape-checked and every citation is verified before anything is saved or shown.
 */
export type GenerateReport = (input: GenerateReportInput) => Promise<ReportDraft>;

/**
 * Stand-in until the real AI workflow lands: returns the hand-written Northstar report, with its
 * meeting citations pointed at this meeting's source ID.
 */
export const sampleReportGenerator: GenerateReport = async (input) => {
  const { summary, decisions, commitments, risks, openQuestions, suggestedFollowUp, ticketDraft } =
    structuredClone(SAMPLE_NORTHSTAR_REPORT);
  const draft: ReportDraft = { summary, decisions, commitments, risks, openQuestions, suggestedFollowUp, ticketDraft };
  const citations = [
    ...draft.decisions.flatMap((d) => d.citations),
    ...draft.commitments.flatMap((c) => c.citations),
    ...draft.risks.flatMap((r) => r.citations),
  ];
  for (const c of citations) {
    if (c.sourceId === SAMPLE_SOURCE_IDS.meeting) c.sourceId = input.meetingSourceId;
  }
  return draft;
};
