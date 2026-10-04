import { type AccountDirectory, type SignedInUser, authorizeAccount, requireUser, notFound } from "../access.js";
import { type HandlerResult, toErrorResult } from "../errors.js";
import type { PublicSource } from "@deeproot/shared";
import { permittedPointRead, assertReportEvidence } from "../store/authorization.js";
import { sourceVersion, toPublicSource } from "../store/publicSources.js";
import type { ReportStore } from "../store/reports.js";
import type { SourceSearch } from "../store/sources.js";

export async function handleGetSource(input: { user: SignedInUser | null; accountId: string; sourceId: string; reportId?: string; version?: string }, deps: { accounts: AccountDirectory; search: SourceSearch; reports: ReportStore }): Promise<HandlerResult<{ source: PublicSource }>> {
  try {
    const user = requireUser(input.user);
    const account = await authorizeAccount(user, input.accountId, deps.accounts);
    const current = await permittedPointRead(deps.search, account, user.userId, input.sourceId);
    if (input.reportId) {
      const report = await deps.reports.get(input.reportId);
      if (!report || report.accountId !== account.id) throw notFound();
      await assertReportEvidence(report, account, user.userId, deps.search);
      const snapshot = report.citedSources?.find(s => s.id === input.sourceId && (!input.version || (s.version ?? sourceVersion(s)) === input.version));
      if (snapshot) return { status: 200, body: { source: { ...snapshot, version: snapshot.version ?? sourceVersion(snapshot) } } };
    }
    if (input.version && sourceVersion(current) !== input.version) throw notFound();
    return { status: 200, body: { source: toPublicSource(current) } };
  } catch (err) { return toErrorResult(err); }
}
