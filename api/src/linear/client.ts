import type { TicketPriority } from "@deeproot/shared";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
export type LinearConfig = { apiKey: string; teamId: string; teamKey?: string; fetch?: typeof fetch };
export type CreatedLinearIssue = { id: string; identifier: string; url: string };
export class LinearError extends Error {}
const PRIORITY: Record<TicketPriority, number> = { high: 2, medium: 3, low: 4 };

async function graphql(config: LinearConfig, query: string, variables: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(LINEAR_GRAPHQL_URL, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: config.apiKey },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new LinearError(`Could not reach Linear: ${(err as Error).message}`);
  }
  const json = await response.json().catch(() => null) as {
    data?: Record<string, unknown>; errors?: Array<{ message: string }>;
  } | null;
  if (!response.ok || json?.errors?.length || !json?.data) {
    throw new LinearError(`Linear rejected the request: ${json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${response.status}`}`);
  }
  return json.data;
}

function checkedIssue(raw: unknown, issueId: string): CreatedLinearIssue {
  const issue = raw as Partial<CreatedLinearIssue> | null;
  if (issue?.id !== issueId || typeof issue.identifier !== "string" || !issue.identifier ||
      typeof issue.url !== "string" || !/^https:\/\//.test(issue.url)) {
    throw new LinearError("Linear did not return the requested issue identity and link.");
  }
  return issue as CreatedLinearIssue;
}

/** Identity lookup also includes archived issues, so archiving never causes a second creation. */
export async function findLinearIssue(config: LinearConfig, issueId: string): Promise<CreatedLinearIssue | null> {
  const data = await graphql(config, `query FindIssue($id: ID!) {
    issues(filter: { id: { eq: $id } }, first: 1, includeArchived: true) {
      nodes { id identifier url }
    }
  }`, { id: issueId });
  const connection = data.issues as { nodes?: unknown[] } | undefined;
  if (!Array.isArray(connection?.nodes)) throw new LinearError("Linear returned an unreadable lookup result.");
  return connection.nodes.length ? checkedIssue(connection.nodes[0], issueId) : null;
}

/** Caller-supplied UUID is persisted before this mutation; every retry reuses it. */
export async function createLinearIssue(
  config: LinearConfig,
  issue: { id: string; title: string; description: string; priority: TicketPriority },
): Promise<CreatedLinearIssue> {
  const data = await graphql(config, `mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { id identifier url } }
  }`, { input: { ...issue, priority: PRIORITY[issue.priority], teamId: config.teamId } });
  const created = data.issueCreate as { success?: boolean; issue?: unknown } | undefined;
  if (created?.success !== true) throw new LinearError("Linear did not confirm the issue was created.");
  return checkedIssue(created.issue, issue.id);
}
