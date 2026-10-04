import { assertReportEvidence } from "../store/authorization.js";
import type { SourceSearch } from "../store/sources.js";
import { TICKET_PRIORITIES, type CreateLinearIssueResponse, type LinearIssueRef, type TicketDraft, type TicketPriority } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, notFound, requireUser } from "../access.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { type LinearConfig, createLinearIssue, findLinearIssue } from "../linear/client.js";
import { buildFallbackUrl, buildIssueDescription } from "../linear/format.js";
import type { ReportStore } from "../store/reports.js";
import { assertDeliveryContent, containsPersonalPayroll } from "../dataPolicy.js";

export type CreateLinearIssueDeps = {
  search?: SourceSearch;
  reports: ReportStore;
  accounts: AccountDirectory;
  /** null when LINEAR_API_KEY / LINEAR_TEAM_ID are not configured: the handler returns the fallback link. */
  linear: LinearConfig | null;
  appBaseUrl: string;
  pendingCreations?: Map<string, Promise<LinearIssueRef>>;
};

export type CreateLinearIssueInput = {
  user: SignedInUser | null;
  reportId: string;
  body: unknown;
};

// Only an optimization: durable reservations and the remote UUID provide coordination across instances.
const pendingByStore = new WeakMap<ReportStore, Map<string, Promise<LinearIssueRef>>>();

/** POST /api/reports/:id/linear: create one Linear issue from the reviewed ticket. */
export async function handleCreateLinearIssue(
  input: CreateLinearIssueInput,
  deps: CreateLinearIssueDeps,
): Promise<HandlerResult<CreateLinearIssueResponse>> {
  try {
    const user = requireUser(input.user);
    const ticket = parseTicket(input.body);

    const report = await deps.reports.get(input.reportId);
    if (!report) throw notFound();
    const account = await authorizeAccount(user, report.accountId, deps.accounts);
    await assertReportEvidence(report, account, user.userId, deps.search);
    if (report.ticketStatus === "none") throw new ApiFailure("BAD_REQUEST", "No actionable task was established in this report.");
    assertDeliveryContent(JSON.stringify(ticket));
    if (containsPersonalPayroll(JSON.stringify(report))) throw notFound();

    if (report.linearIssue) {
      return { status: 200, body: { issue: report.linearIssue, alreadyCreated: true } };
    }

    const reportUrl = `${deps.appBaseUrl.replace(/\/$/, "")}/?report=${encodeURIComponent(report.id)}`;
    const linear = deps.linear;
    if (!linear) {
      // A pending attempt may already have created an issue, even if configuration was later removed.
      if (report.linearCreation) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Restore Linear configuration to reconcile the pending issue.");
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Linear is not configured. Use the prefilled link instead.",
        buildFallbackUrl(ticket, reportUrl));
    }

    const reservation = await deps.reports.reserveLinearCreation(report.id, {
      issueId: crypto.randomUUID(), teamId: linear.teamId, ticket,
      description: buildIssueDescription(ticket, reportUrl),
    });
    if (reservation.report.linearIssue) return { status: 200, body: { issue: reservation.report.linearIssue, alreadyCreated: true } };
    const accepted = reservation.report.linearCreation!;
    if (accepted.teamId !== linear.teamId) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Restore the original Linear team to reconcile the pending issue.");

    let pending = deps.pendingCreations ?? pendingByStore.get(deps.reports);
    if (!pending) { pending = new Map(); pendingByStore.set(deps.reports, pending); }
    let creation = pending.get(report.id);
    if (!creation) {
      creation = (async (): Promise<LinearIssueRef> => {
        let created = reservation.reserved ? null : await findLinearIssue(linear, accepted.issueId);
        if (!created) {
          try {
            created = await createLinearIssue(linear, {
              id: accepted.issueId, title: accepted.ticket.title,
              description: accepted.description, priority: accepted.ticket.priority,
            });
          } catch (err) {
            // A timeout or UUID conflict may mean creation succeeded elsewhere. Never allocate a new ID.
            created = await findLinearIssue(linear, accepted.issueId);
            if (!created) throw err;
          }
        }
        const issue = { identifier: created.identifier, url: created.url };
        await deps.reports.completeLinearCreation(report.id, issue);
        return issue;
      })();
      pending.set(report.id, creation);
    }
    try {
      const issue = await creation;
      return { status: reservation.reserved ? 201 : 200, body: { issue, alreadyCreated: !reservation.reserved } };
    } catch (err) {
      console.error("Linear issue reconciliation failed", err);
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "The issue outcome is pending. Retry to reconcile the original reviewed draft; do not create another issue manually.");
    } finally {
      if (pending.get(report.id) === creation) pending.delete(report.id);
    }
  } catch (err) {
    return toErrorResult(err);
  }
}

function parseTicket(body: unknown): TicketDraft {
  const ticket = (body as { ticket?: unknown } | null)?.ticket as Partial<TicketDraft> | undefined;
  const title = typeof ticket?.title === "string" ? ticket.title.trim() : "";
  const description = typeof ticket?.description === "string" ? ticket.description.trim() : "";
  const criteria = Array.isArray(ticket?.acceptanceCriteria) ? ticket.acceptanceCriteria : null;

  if (!title) throw new ApiFailure("BAD_REQUEST", "The ticket needs a title.");
  if (!criteria || !criteria.every((c) => typeof c === "string")) {
    throw new ApiFailure("BAD_REQUEST", "Acceptance criteria must be a list of text items.");
  }
  const acceptanceCriteria = criteria.map((c) => c.trim()).filter(Boolean);
  if (acceptanceCriteria.length === 0) throw new ApiFailure("BAD_REQUEST", "Add at least one acceptance criterion.");
  if (!TICKET_PRIORITIES.includes(ticket?.priority as TicketPriority)) {
    throw new ApiFailure("BAD_REQUEST", "Priority must be low, medium, or high.");
  }
  return { title, description, acceptanceCriteria, priority: ticket!.priority as TicketPriority };
}
