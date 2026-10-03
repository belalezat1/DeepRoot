import type { Account, MeetingReport } from "@deeproot/shared";
import type { AccountDirectory } from "../auth/access.js";

/** Teammate 1 implements this with Cosmos DB; the in-memory version is for tests and local runs. */
export interface ReportStore {
  get(reportId: string): Promise<MeetingReport | null>;
  save(report: MeetingReport): Promise<void>;
}

export class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, MeetingReport>();

  constructor(initial: MeetingReport[] = []) {
    for (const r of initial) this.reports.set(r.id, structuredClone(r));
  }

  async get(reportId: string) {
    const report = this.reports.get(reportId);
    return report ? structuredClone(report) : null;
  }

  async save(report: MeetingReport) {
    this.reports.set(report.id, structuredClone(report));
  }
}

export class InMemoryAccountDirectory implements AccountDirectory {
  constructor(private readonly accounts: Account[]) {}

  async getAccount(accountId: string) {
    return this.accounts.find((a) => a.id === accountId) ?? null;
  }
}
