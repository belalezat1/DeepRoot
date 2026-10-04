import { sourceVersion } from "../store/publicSources.js";
import { assertReportEvidence } from "../store/authorization.js";
import type { CreateReportRequest, MeetingReport, ReportResponse } from "@deeproot/shared";
import { reportCitations } from "@deeproot/shared";
import {
  type AccountDirectory,
  type SignedInUser,
  authorizeAccount,
  filterPermittedSources,
  notFound,
  requireUser,
} from "../access.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { meetingToSource } from "../ingest/meeting.js";
import type { GenerateReport } from "../reports/generator.js";
import { sanitizeReportDraft } from "../reports/validate.js";
import type { ReportStore } from "../store/reports.js";
import type { SourceSearch, SourceWriter } from "../store/sources.js";
import { publicSourcesFor } from "../store/publicSources.js";
import { MAX_CONTEXT_SOURCES } from "../agent/analyze.js";
import { assertDeliveryContent, assertDeliveryOutput, containsPersonalPayroll } from "../dataPolicy.js";

export type ReportDeps = {
  accounts: AccountDirectory;
  search: SourceSearch;
  sourceWriter: SourceWriter;
  reports: ReportStore;
  /** The configured model workflow, or an explicitly supplied fixture in tests. */
  generateReport: GenerateReport;
  now?: () => Date;
  newId?: () => string;
};

const MAX_TRANSCRIPT_CHARS = 20_000;

/** POST /api/reports: turn a reviewed transcript into a saved, cited report. */
export async function handleCreateReport(
  input: { user: SignedInUser | null; body: unknown },
  deps: ReportDeps,
): Promise<HandlerResult<ReportResponse>> {
  try {
    const user = requireUser(input.user);
    const { accountId, transcript, previousReportId } = parseCreateReport(input.body);
    // Access is checked before any source is read or the model is called.
    const account = await authorizeAccount(user, accountId, deps.accounts);
    assertDeliveryContent(transcript);
    if (previousReportId) {
      const previous = await deps.reports.get(previousReportId);
      if (!previous || previous.accountId !== account.id) throw notFound();
      await assertReportEvidence(previous, account, user.userId, deps.search);
    }

    const now = (deps.now ?? (() => new Date()))();
    const reportId = (deps.newId ?? (() => `report-${crypto.randomUUID()}`))();
    const meeting = meetingToSource({
      account,
      meetingId: reportId,
      transcript,
      occurredAt: now.toISOString(),
      title: `${account.name} meeting`,
    });

    const stored = filterPermittedSources(
      await deps.search.search({ accountId: account.id, userId: user.userId, query: "", top: MAX_CONTEXT_SOURCES }),
      account.id,
      user.userId,
    );
    const permitted = [meeting, ...stored.filter((s) => s.kind !== "meeting" && s.id !== meeting.id)].slice(0, MAX_CONTEXT_SOURCES);

    let raw: unknown;
    try {
      raw = await deps.generateReport({
        userId: user.userId,
        account: { id: account.id, name: account.name },
        transcript: meeting.body,
        meetingSourceId: meeting.id,
        meetingDate: meeting.occurredAt,
        sources: permitted,
      });
    } catch (err) {
      if (err instanceof ApiFailure) throw err;
      console.error("Report generation failed", err);
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "The AI model is unavailable. Please try again.");
    }

    const index = new Map(permitted.map((s) => [s.id, s]));
    const { draft, dropped } = sanitizeReportDraft(raw, { accountId: account.id, userId: user.userId, sourcesById: index });
    assertDeliveryOutput(draft);
    if (Object.values(dropped).some((n) => n > 0)) console.warn(`Report ${reportId}: removed unsupported content`, dropped);

    const report: MeetingReport = {
      id: reportId,
      accountId: account.id,
      transcript: meeting.body,
      ...draft,
      createdAt: now.toISOString(),
      createdBy: user.userId,
      ...(previousReportId ? { previousReportId } : {}),
    };

    const sources = publicSourcesFor(reportCitations(report), index);
    await deps.sourceWriter.save(meeting); // so chat and later reports can cite this meeting
    await deps.reports.save({ ...report, citedSources: sources });
    return { status: 201, body: { report, sources } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** GET /api/reports/:id: a saved report, after checking the user may see its account. */
export async function handleGetReport(
  input: { user: SignedInUser | null; reportId: string },
  deps: Pick<ReportDeps, "accounts" | "reports"> & { search?: SourceSearch },
): Promise<HandlerResult<ReportResponse>> {
  try {
    const user = requireUser(input.user);
    const stored = await deps.reports.get(input.reportId);
    if (!stored) throw notFound();
    const account = await authorizeAccount(user, stored.accountId, deps.accounts);
    await assertReportEvidence(stored, account, user.userId, deps.search);
    if (containsPersonalPayroll(JSON.stringify(stored))) throw notFound();

    const { citedSources: sources = [], linearCreation: _private, ...report } = stored;
    const snapshots = sources.map(s => ({ ...s, version: s.version ?? sourceVersion(s) }));
    for (const citation of reportCitations(report)) citation.sourceVersion ??= snapshots.find(s => s.id === citation.sourceId)?.version;
    return { status: 200, body: { report, sources: snapshots } };
  } catch (err) {
    return toErrorResult(err);
  }
}

function parseCreateReport(body: unknown): CreateReportRequest {
  const b = body as Partial<CreateReportRequest> | null;
  if (typeof b?.accountId !== "string" || !b.accountId) throw new ApiFailure("BAD_REQUEST", "accountId is required.");
  if (typeof b.transcript !== "string" || !b.transcript.trim()) {
    throw new ApiFailure("BAD_REQUEST", "The transcript is empty.");
  }
  if (b.transcript.length > MAX_TRANSCRIPT_CHARS) throw new ApiFailure("BAD_REQUEST", "The transcript is too long.");
  if (b.previousReportId !== undefined && (typeof b.previousReportId !== "string" || !b.previousReportId.trim())) throw new ApiFailure("BAD_REQUEST", "previousReportId must be text.");
  return { accountId: b.accountId, transcript: b.transcript, previousReportId: b.previousReportId };
}
