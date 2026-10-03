import type { CreateLinearIssueResponse, LinearIssueRef, TicketDraft, TicketPriority } from "@deeproot/shared";
import { type AccountDirectory, type SignedInUser, authorizeAccount, notFound, requireUser } from "../access.js";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { type LinearConfig, createLinearIssue } from "../linear/client.js";
import { buildFallbackUrl, buildIssueDescription } from "../linear/format.js";
import type { ReportStore } from "../store/reports.js";

export type CreateLinearIssueDeps = {
  reports: ReportStore;
  accounts: AccountDirectory;
  /** null when LINEAR_API_KEY / LINEAR_TEAM_ID are not configured: the handler returns the fallback link. */
  linear: LinearConfig | null;
  appBaseUrl: string;
};

export type CreateLinearIssueInput = {
  user: SignedInUser | null;
  reportId: string;
  body: unknown;
};

/**
 * Creations in progress or finished, per report, in this process. A double click awaits the same
 * creation instead of starting a second one. The saved `linearIssue` on the report covers later retries.
 */
const creations = new Map<string, Promise<LinearIssueRef>>();

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
    await authorizeAccount(user, report.accountId, deps.accounts);

    if (report.linearIssue) {
      return { status: 200, body: { issue: report.linearIssue, alreadyCreated: true } };
    }

    const reportUrl = `${deps.appBaseUrl.replace(/\/$/, "")}/reports/${encodeURIComponent(report.id)}`;
    const fallbackUrl = buildFallbackUrl(ticket, reportUrl, deps.linear?.teamKey);
    const linear = deps.linear;
    if (!linear) {
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Linear is not configured. Use the prefilled link instead.", fallbackUrl);
    }

    let creation = creations.get(report.id);
    const alreadyCreated = creation !== undefined;
    if (!creation) {
      creation = (async (): Promise<LinearIssueRef> => {
        const created = await createLinearIssue(linear, {
          title: ticket.title,
          description: buildIssueDescription(ticket, reportUrl),
          priority: ticket.priority,
        });
        const issue = { identifier: created.identifier, url: created.url };
        await deps.reports.save({ ...report, ticketDraft: ticket, linearIssue: issue });
        return issue;
      })();
      creations.set(report.id, creation);
    }

    try {
      const issue = await creation;
      return { status: alreadyCreated ? 200 : 201, body: { issue, alreadyCreated } };
    } catch (err) {
      if (creations.get(report.id) === creation) creations.delete(report.id); // allow a retry
      console.error("Linear issue creation failed", err);
      throw new ApiFailure("INTEGRATION_UNAVAILABLE", "Linear is unavailable. Use the prefilled link instead.", fallbackUrl);
    }
  } catch (err) {
    return toErrorResult(err);
  }
}

const PRIORITIES: TicketPriority[] = ["low", "medium", "high"];

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
  if (!PRIORITIES.includes(ticket?.priority as TicketPriority)) {
    throw new ApiFailure("BAD_REQUEST", "Priority must be low, medium, or high.");
  }
  return { title, description, acceptanceCriteria, priority: ticket!.priority as TicketPriority };
}
