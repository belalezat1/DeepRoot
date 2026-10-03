import type { CreateReportRequest, MeetingReport, PublicSource, ReportResponse, SourceRecord } from "@deeproot/shared";
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
import { indexSources } from "../reports/citations.js";
import type { GenerateReport } from "../reports/generator.js";
import { sanitizeReportDraft } from "../reports/validate.js";
import type { ReportStore } from "../store/reports.js";
import type { SourceStore } from "../store/sources.js";

export type ReportDeps = {
  accounts: AccountDirectory;
  sources: SourceStore;
  reports: ReportStore;
  /** Teammate 3's AI workflow; `sampleReportGenerator` until it lands. */
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
    const { accountId, transcript } = parseCreateReport(input.body);
    // Access is checked before any source is read or the model is called.
    const account = await authorizeAccount(user, accountId, deps.accounts);

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
      await deps.sources.listForAccount(account.id, user.userId),
      account.id,
      user.userId,
    );
    const permitted = [...stored.filter((s) => s.id !== meeting.id), meeting];

    let raw: unknown;
    try {
      raw = await deps.generateReport({
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

    const index = indexSources(permitted);
    const { draft, dropped } = sanitizeReportDraft(raw, index);
    if (Object.values(dropped).some((n) => n > 0)) console.warn(`Report ${reportId}: removed unsupported content`, dropped);

    const report: MeetingReport = {
      id: reportId,
      accountId: account.id,
      transcript: meeting.body,
      ...draft,
      createdAt: now.toISOString(),
      createdBy: user.userId,
    };

    await deps.sources.save(meeting); // so chat and later reports can cite this meeting
    await deps.reports.save(report);
    return { status: 201, body: { report, sources: citedSources(report, index) } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** GET /api/reports/:id: a saved report, after checking the user may see its account. */
export async function handleGetReport(
  input: { user: SignedInUser | null; reportId: string },
  deps: Pick<ReportDeps, "accounts" | "sources" | "reports">,
): Promise<HandlerResult<ReportResponse>> {
  try {
    const user = requireUser(input.user);
    const report = await deps.reports.get(input.reportId);
    if (!report) throw notFound();
    await authorizeAccount(user, report.accountId, deps.accounts);

    const permitted = filterPermittedSources(
      await deps.sources.listForAccount(report.accountId, user.userId),
      report.accountId,
      user.userId,
    );
    return { status: 200, body: { report, sources: citedSources(report, indexSources(permitted)) } };
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
  return { accountId: b.accountId, transcript: b.transcript };
}

/** The sources a report cites, without access lists, so the UI can show excerpts. */
function citedSources(report: MeetingReport, permitted: Map<string, SourceRecord>): PublicSource[] {
  const ids = new Set(
    [...report.decisions, ...report.commitments, ...report.risks].flatMap((item) => item.citations.map((c) => c.sourceId)),
  );
  return [...ids].flatMap((id) => {
    const source = permitted.get(id);
    if (!source) return [];
    const { allowedUserIds: _omit, ...publicSource } = source;
    return [publicSource];
  });
}
