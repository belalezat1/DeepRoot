// AI Search adapter. Every query is filtered to one account AND the signed-in user's access list on the
// search service itself, then checked again here, so restricted text never reaches the model.
import type { SourceRecord } from "@deeproot/shared";
import { filterPermittedSources } from "../access.js";
import { postJson } from "./http.js";

const API_VERSION = "2024-07-01";

export type SearchQuery = {
  accountId: string;
  userId: string;
  /** Free text; empty or "*" returns the account's most recent sources. */
  text: string;
  top?: number;
};

export interface SourceSearch {
  searchPermittedSources(query: SearchQuery): Promise<SourceRecord[]>;
  indexSources(sources: SourceRecord[]): Promise<void>;
}

export function createAzureSourceSearch(config: {
  endpoint: string;
  index: string;
  /** Query key: read-only, used for searches. */
  queryKey: string;
  /** Admin key: needed only for indexSources. */
  adminKey?: string;
}): SourceSearch {
  const base = `${config.endpoint.replace(/\/$/, "")}/indexes/${encodeURIComponent(config.index)}/docs`;

  return {
    async searchPermittedSources({ accountId, userId, text, top = 8 }) {
      const query = text.trim() || "*";
      const data = (await postJson(
        "Azure AI Search",
        `${base}/search?api-version=${API_VERSION}`,
        { "api-key": config.queryKey },
        {
          search: query,
          filter: permittedFilter(accountId, userId),
          top,
          ...(query === "*" ? { orderby: "occurredAt desc" } : {}),
        },
        { timeoutMs: 10_000 },
      )) as { value: Array<SourceRecord & Record<`@${string}`, unknown>> };

      const sources = data.value.map(
        (doc) => Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith("@"))) as SourceRecord,
      );
      return filterPermittedSources(
        sources.map((s) => (s.app === null ? withoutApp(s) : s)),
        accountId,
        userId,
      );
    },

    async indexSources(sources) {
      if (!config.adminKey) throw new Error("AZURE_SEARCH_ADMIN_KEY is required to index sources");
      for (let i = 0; i < sources.length; i += 500) {
        await postJson(
          "Azure AI Search",
          `${base}/index?api-version=${API_VERSION}`,
          { "api-key": config.adminKey },
          { value: sources.slice(i, i + 500).map((s) => ({ "@search.action": "mergeOrUpload", ...s })) },
        );
      }
    },
  };
}

/** In-memory search with the same access rules, for tests and local runs without Azure. */
export function createInMemorySourceSearch(initial: SourceRecord[] = []): SourceSearch {
  const sources = new Map(initial.map((s) => [s.id, structuredClone(s)]));
  return {
    async searchPermittedSources({ accountId, userId, text, top = 8 }) {
      const terms = text.toLowerCase().split(/\W+/).filter((t) => t && t !== "*");
      const permitted = filterPermittedSources([...sources.values()], accountId, userId);
      return permitted
        .filter((s) => terms.length === 0 || terms.some((t) => `${s.title} ${s.body}`.toLowerCase().includes(t)))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, top)
        .map((s) => structuredClone(s));
    },
    async indexSources(records) {
      for (const s of records) sources.set(s.id, structuredClone(s));
    },
  };
}

/** OData filter for one account and one user. Quotes are doubled so IDs can't break out of the string. */
export function permittedFilter(accountId: string, userId: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `accountId eq ${quote(accountId)} and allowedUserIds/any(u: u eq ${quote(userId)})`;
}

/** Search returns `app: null` for records without one; the contract leaves the field out instead. */
function withoutApp(source: SourceRecord): SourceRecord {
  const { app: _app, ...rest } = source;
  return rest;
}
