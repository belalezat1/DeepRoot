import type { Citation, MeetingReport } from "./contracts.js";

export function reportCitations(report: Pick<MeetingReport, "decisions" | "commitments" | "risks"> & Partial<Pick<MeetingReport, "summaryCitations" | "followUpCitations" | "ticketCitations">>): Citation[] {
  return [...[...report.decisions, ...report.commitments, ...report.risks].flatMap((item) => item.citations), ...(report.summaryCitations ?? []), ...(report.followUpCitations ?? []), ...(report.ticketCitations ?? [])];
}
