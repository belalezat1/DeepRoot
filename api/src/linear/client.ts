import type { TicketPriority } from "@deeproot/shared";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export type LinearConfig = {
  apiKey: string;
  teamId: string; // team UUID, not the "DEE" key
  teamKey?: string; // used only for the prefilled fallback link
  fetch?: typeof fetch; // injectable for tests
};

export type CreatedLinearIssue = { id: string; identifier: string; url: string };

export class LinearError extends Error {}

/** Linear priorities: 1 urgent, 2 high, 3 medium, 4 low. */
const PRIORITY: Record<TicketPriority, number> = { high: 2, medium: 3, low: 4 };

const ISSUE_CREATE = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier url }
    }
  }
`;

export async function createLinearIssue(
  config: LinearConfig,
  issue: { title: string; description: string; priority: TicketPriority },
): Promise<CreatedLinearIssue> {
  const doFetch = config.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: config.apiKey },
      body: JSON.stringify({
        query: ISSUE_CREATE,
        variables: {
          input: {
            teamId: config.teamId,
            title: issue.title,
            description: issue.description,
            priority: PRIORITY[issue.priority],
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new LinearError(`Could not reach Linear: ${(err as Error).message}`);
  }

  const json = (await res.json().catch(() => null)) as {
    data?: { issueCreate?: { success: boolean; issue?: CreatedLinearIssue | null } | null };
    errors?: Array<{ message: string }>;
  } | null;

  // Linear can return HTTP 200 with an `errors` array, so check both.
  if (!res.ok || json?.errors?.length) {
    const detail = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new LinearError(`Linear rejected the issue: ${detail}`);
  }
  const created = json?.data?.issueCreate;
  if (!created?.success || !created.issue) {
    throw new LinearError("Linear did not confirm the issue was created.");
  }
  return created.issue;
}
