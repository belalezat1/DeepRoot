// AI Search adapter for the backend's SourceSearch. Every query is filtered to one account AND the
// signed-in user's access list on the search service itself, then checked again here.
import type { SourceRecord } from "@deeproot/shared";
import { filterPermittedSources } from "../access.js";
import type { SourceSearch, SourceSearchRequest } from "../store/sources.js";
import { AdapterError, postJson } from "./http.js";

const API_VERSION = "2024-07-01";

export class AzureSourceSearch implements SourceSearch {
  private readonly docsUrl: string;

  constructor(
    private readonly config: {
      endpoint: string;
      index: string;
      /** Query key: read-only, used for searches. */
      queryKey: string;
      /** Admin key: needed only to index sources. */
      adminKey?: string;
    },
  ) {
    this.docsUrl = `${config.endpoint.replace(/\/$/, "")}/indexes/${encodeURIComponent(config.index)}/docs`;
  }

  async search({ accountId, userId, query, top, signal }: SourceSearchRequest): Promise<SourceRecord[]> {
    const text = query.trim();
    const data = (await postJson(
      "Azure AI Search",
      `${this.docsUrl}/search?api-version=${API_VERSION}`,
      { "api-key": this.config.queryKey },
      {
        search: text || "*",
        filter: permittedFilter(accountId, userId),
        top,
        // An empty query means "most recent"; otherwise Search ranks by relevance.
        ...(text ? {} : { orderby: "occurredAt desc" }),
      },
      { timeoutMs: 10_000, signal },
    )) as { value: Array<Record<string, unknown>> };

    return filterPermittedSources(data.value.map(toSourceRecord), accountId, userId);
  }

  async remove(sourceId: string): Promise<void> {
    if (!this.config.adminKey) throw new Error("AZURE_SEARCH_ADMIN_KEY is required to delete sources");
    const result = await postJson("Azure AI Search", `${this.docsUrl}/index?api-version=${API_VERSION}`, { "api-key": this.config.adminKey }, { value: [{ "@search.action": "delete", id: sourceId }] }) as { value?: Array<{ key: string; status: boolean }> };
    if (!result.value?.some(r => r.key === sourceId && r.status === true)) throw new AdapterError("Source removal was not indexed; retry sync.", "Azure AI Search");
  }

  /** Adds or replaces sources by ID. */
  async index(sources: SourceRecord[]): Promise<void> {
    if (!this.config.adminKey) throw new Error("AZURE_SEARCH_ADMIN_KEY is required to index sources");
    for (let i = 0; i < sources.length; i += 500) {
      const result = await postJson(
        "Azure AI Search",
        `${this.docsUrl}/index?api-version=${API_VERSION}`,
        { "api-key": this.config.adminKey },
        { value: sources.slice(i, i + 500).map((s) => ({ "@search.action": "mergeOrUpload", ...searchDocument(s) })) },
      ) as { value?: Array<{ key: string; status: boolean; statusCode: number; errorMessage?: string }> } | null;
      const expected = sources.slice(i, i + 500);
      const results = Array.isArray(result?.value) ? result.value : [];
      const indexed = new Set(results.filter((r) => r?.status === true).map((r) => r.key));
      if (results.some((r) => r?.status !== true) || expected.some((source) => !indexed.has(source.id))) {
        throw new AdapterError("Azure AI Search did not index every document; retry the source batch.", "Azure AI Search");
      }
    }
  }
}

/** OData filter for one account and one user. Quotes are doubled so IDs can't break out of the string. */
export function permittedFilter(accountId: string, userId: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `accountId eq ${quote(accountId)} and allowedUserIds/any(u: u eq ${quote(userId)})`;
}

/** Drops Search metadata (@search.score) and the null `app` Search returns for records without one. */
function toSourceRecord(doc: Record<string, unknown>): SourceRecord {
  const entries = Object.entries(doc).filter(([key, value]) => !key.startsWith("@") && !(key === "app" && value === null));
  return Object.fromEntries(entries) as SourceRecord;
}

function searchDocument(source: SourceRecord) { const { policy: _private, ...document } = source; return document; }
