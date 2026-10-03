import type { Account, MeetingReport, PublicSource } from "@deeproot/shared";
import type { AccountDirectory } from "../access.js";

/**
 * A report as stored: the report plus a snapshot of the sources it cites, taken when it was created,
 * so reopening it never depends on a later search finding those sources again.
 */
export type StoredReport = MeetingReport & { citedSources?: PublicSource[] };

/** Teammate 1 implements this with Cosmos DB; the in-memory version is for tests and local runs. */
export interface ReportStore {
  get(reportId: string): Promise<StoredReport | null>;
  save(report: StoredReport): Promise<void>;
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
}

export class InMemoryAccountDirectory implements AccountDirectory {
  constructor(private readonly accounts: Account[]) {}

  async getAccount(accountId: string) {
    return this.accounts.find((a) => a.id === accountId) ?? null;
  }
}
