import type { Account, LinearIssueRef, MeetingReport, PublicSource, TicketDraft } from "@deeproot/shared";
import { notFound } from "../access.js";
import type { AccountDirectory } from "../access.js";

/**
 * A report as stored: the report plus a snapshot of the sources it cites, taken when it was created,
 * so reopening it never depends on a later search finding those sources again.
 */
export type LinearCreation = { issueId: string; teamId: string; ticket: TicketDraft; description: string };
export type StoredReport = MeetingReport & { citedSources?: PublicSource[]; linearCreation?: LinearCreation };

/** Teammate 1 implements this with Cosmos DB; the in-memory version is for tests and local runs. */
export interface ReportStore {
  get(reportId: string): Promise<StoredReport | null>;
  save(report: StoredReport): Promise<void>;
  /** Atomically preserve the first accepted draft and UUID before any remote mutation. */
  reserveLinearCreation(reportId: string, creation: LinearCreation): Promise<{ report: StoredReport; reserved: boolean }>;
  /** Update only the result, retaining the reservation and all cited-source snapshots. */
  completeLinearCreation(reportId: string, issue: LinearIssueRef): Promise<void>;
}

export class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, StoredReport>();

  constructor(initial: StoredReport[] = []) {
    for (const r of initial) this.reports.set(r.id, structuredClone(r));
  }

  async get(reportId: string) {
    const report = this.reports.get(reportId);
    return report ? structuredClone(report) : null;
  }

  async save(report: StoredReport) {
    this.reports.set(report.id, structuredClone(report));
  }

  async reserveLinearCreation(reportId: string, creation: LinearCreation) {
    const report = this.reports.get(reportId);
    if (!report) throw notFound();
    if (report.linearCreation || report.linearIssue) return { report: structuredClone(report), reserved: false };
    const updated: StoredReport = { ...report, ticketDraft: structuredClone(creation.ticket), linearCreation: structuredClone(creation), linearIssueStatus: "pending" };
    this.reports.set(reportId, updated);
    return { report: structuredClone(updated), reserved: true };
  }

  async completeLinearCreation(reportId: string, issue: LinearIssueRef) {
    const report = this.reports.get(reportId);
    if (!report) throw notFound();
    const { linearIssueStatus: _pending, ...rest } = report;
    this.reports.set(reportId, { ...rest, linearIssue: structuredClone(issue) });
  }
}

export class InMemoryAccountDirectory implements AccountDirectory {
  constructor(private readonly accounts: Account[]) {}

  async getAccount(accountId: string) {
    return this.accounts.find((a) => a.id === accountId) ?? null;
  }
}
