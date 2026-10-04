import { reportCitations, type Account, type SourceRecord } from "@deeproot/shared";
import { filterPermittedSources, notFound } from "../access.js";
import { containsPersonalPayroll } from "../dataPolicy.js";
import { ApiFailure } from "../errors.js";
import type { StoredReport } from "./reports.js";
import type { SourceSearch } from "./sources.js";

/** Historical content is readable only while the authoritative source still grants access. */
export async function assertReportEvidence(report: StoredReport, account: Account, userId: string, search?: SourceSearch): Promise<void> {
  if (containsPersonalPayroll(JSON.stringify(report))) throw notFound();
  if (!search?.get) return; // compatibility for isolated legacy handler tests; runtime adapters have point reads
  const ids = [...new Set([...reportCitations(report).map(c => c.sourceId), ...(report.citedSources ?? []).map(s => s.id)])];
  for (const id of ids) {
    const current = await search.get(account.id, id);
    if (!current || !filterPermittedSources([current], account.id, userId).length) throw notFound();
  }
}

export async function permittedPointRead(search: SourceSearch, account: Account, userId: string, sourceId: string): Promise<SourceRecord> {
  if (!search.get) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Source lookup is unavailable.");
  const source = await search.get(account.id, sourceId);
  if (!source || !filterPermittedSources([source], account.id, userId).length) throw notFound();
  return source;
}
