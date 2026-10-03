import type { Account, IngestResponse, SourceRecord } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, notFound, requireUser } from "../access.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { INTERNAL_APP_CONNECTORS } from "../ingest/connectors/index.js";
import { ingestEmails, type EmailRouting } from "../ingest/email.js";
import { ingestInternalAppRecords, type InternalAppConnector } from "../ingest/internal-app.js";
import { meetingToSource } from "../ingest/meeting.js";
import type { IngestResult } from "../ingest/result.js";
import type { SourceWriter } from "../store/sources.js";

export type IngestDeps = {
  accounts: AccountDirectory;
  sources: SourceWriter;
  emailRouting: EmailRouting;
  connectors?: InternalAppConnector[]; // defaults to every registered connector
};

export type IngestInput = { user: SignedInUser | null; body: unknown };

const MAX_BATCH = 200;

/**
 * Only the accounts this user can access. Ingestion never sees the others, so an input that routes
 * to them is rejected like an unmapped one, without naming the account.
 */
async function permittedAccounts(user: SignedInUser, accountIds: Iterable<string>, directory: AccountDirectory): Promise<Account[]> {
  const found = await Promise.all([...new Set(accountIds)].map((id) => directory.getAccount(id)));
  return found.filter((a): a is Account => a !== null && a.allowedUserIds.includes(user.userId));
}

function batch(body: unknown, field: string): unknown[] {
  const items = (body as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(items) || items.length === 0) throw new ApiFailure("BAD_REQUEST", `${field} must be a non-empty list.`);
  if (items.length > MAX_BATCH) throw new ApiFailure("BAD_REQUEST", `Send at most ${MAX_BATCH} ${field} per request.`);
  return items;
}

async function save(sources: SourceWriter, records: SourceRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    await Promise.all(records.map((r) => sources.save(r)));
  } catch (err) {
    console.error("Saving sources failed", err);
    throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Could not save the sources. Please try again.");
  }
}

const response = (result: IngestResult): IngestResponse => ({
  ingested: result.records.map(({ id, accountId, kind, title }) => ({ id, accountId, kind, title })),
  rejected: result.rejected,
});

/** POST /api/ingest/emails: raw emails, routed to accounts through the trusted mailbox table. */
export async function handleIngestEmails(input: IngestInput, deps: IngestDeps): Promise<HandlerResult<IngestResponse>> {
  try {
    const user = requireUser(input.user);
    const emails = batch(input.body, "emails");
    const accounts = await permittedAccounts(user, Object.values(deps.emailRouting.mailboxes), deps.accounts);
    const result = ingestEmails(emails, deps.emailRouting, accounts);
    await save(deps.sources, result.records);
    return { status: 200, body: response(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** POST /api/ingest/apps/:appId: a raw export from a connected internal app. */
export async function handleIngestAppRecords(
  input: IngestInput & { appId: string },
  deps: IngestDeps,
): Promise<HandlerResult<IngestResponse>> {
  try {
    const user = requireUser(input.user);
    const connector = (deps.connectors ?? INTERNAL_APP_CONNECTORS).find((c) => c.appId === input.appId);
    if (!connector) throw notFound();
    const records = batch(input.body, "records");
    const accounts = await permittedAccounts(user, Object.values(connector.accounts), deps.accounts);
    const result = ingestInternalAppRecords(connector, records, accounts);
    await save(deps.sources, result.records);
    return { status: 200, body: response(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}

/**
 * POST /api/meetings: saves the presenter-reviewed transcript (after /api/meetings/transcribe) as the
 * meeting source. From here it is retrieved and analyzed like every other source.
 */
export async function handleSaveMeeting(input: IngestInput, deps: Pick<IngestDeps, "accounts" | "sources">): Promise<HandlerResult<IngestResponse>> {
  try {
    const user = requireUser(input.user);
    const body = (input.body ?? {}) as Record<string, unknown>;
    for (const field of ["accountId", "meetingId", "transcript", "occurredAt"]) {
      if (typeof body[field] !== "string" || !(body[field] as string).trim()) throw new ApiFailure("BAD_REQUEST", `${field} is required.`);
    }
    if (body.title !== undefined && typeof body.title !== "string") throw new ApiFailure("BAD_REQUEST", "title must be text.");

    const account = await authorizeAccount(user, body.accountId as string, deps.accounts);
    const source = meetingToSource({
      account,
      meetingId: body.meetingId as string,
      transcript: body.transcript as string,
      occurredAt: body.occurredAt as string,
      title: (body.title as string | undefined)?.trim() || undefined,
    });
    await save(deps.sources, [source]);
    return { status: 201, body: response({ records: [source], rejected: [] }) };
  } catch (err) {
    return toErrorResult(err);
  }
}
