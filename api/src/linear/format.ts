import type { TicketDraft } from "@deeproot/shared";

/**
 * Markdown body for the Linear issue: the reviewed description, acceptance criteria as a checklist,
 * and a link back to the protected report. Email bodies are deliberately not included.
 */
export function buildIssueDescription(ticket: TicketDraft, reportUrl: string): string {
  const criteria = ticket.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
  return [
    ticket.description,
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "---",
    `Created from a reviewed Deeproot report: ${reportUrl}`,
  ].join("\n");
}

/** Keeps the fallback link under typical browser URL limits. */
const MAX_FALLBACK_DESCRIPTION = 1500;

/** Prefilled "new issue" link for when the API is down: the presenter finishes creation in Linear. */
export function buildFallbackUrl(ticket: TicketDraft, reportUrl: string, teamKey?: string): string {
  let description = buildIssueDescription(ticket, reportUrl);
  if (description.length > MAX_FALLBACK_DESCRIPTION) {
    description = `${description.slice(0, MAX_FALLBACK_DESCRIPTION)}…`;
  }
  const params = new URLSearchParams({ title: ticket.title, description });
  const base = teamKey ? `https://linear.app/team/${encodeURIComponent(teamKey)}/new` : "https://linear.new";
  return `${base}?${params}`;
}
