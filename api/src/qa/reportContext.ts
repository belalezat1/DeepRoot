import { assertReportEvidence } from "../store/authorization.js";
import type { SourceSearch } from "../store/sources.js";
import type { Account, SourceRecord } from "@deeproot/shared";
import { notFound } from "../access.js";
import { meetingToSource } from "../ingest/meeting.js";
import type { ReportStore } from "../store/reports.js";
import { containsPersonalPayroll } from "../dataPolicy.js";

/** Resolve only an authorized account's report; history can never substitute for its transcript. */
export async function reportContext(reports: ReportStore, account: Account, reportId?: string, userId?: string, search?: SourceSearch): Promise<SourceRecord[]> {
  if (!reportId) return [];
  const report = await reports.get(reportId);
  if (!report || report.accountId !== account.id || containsPersonalPayroll(report.transcript)) throw notFound();
  await assertReportEvidence(report, account, userId ?? report.createdBy, search);
  return [meetingToSource({ account, meetingId: report.id, transcript: report.transcript, occurredAt: report.createdAt, title: `${account.name} meeting` })];
}
