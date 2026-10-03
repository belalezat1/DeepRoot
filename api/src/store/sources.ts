import type { SourceRecord } from "@deeproot/shared";

export type SourceSearchRequest = {
  accountId: string;
  userId: string;
  /** Free-text terms. Empty means "the account's most recent sources". */
  query: string;
  top: number;
};

/**
 * Retrieval over ingested SourceRecords. Implemented by the Azure teammate (Azure AI Search or Cosmos
 * DB; the backend does not care which). See docs/AZURE_INTEGRATION.md.
 *
 * - Return at most `top` records, whole and unmodified, for `accountId` that list `userId` in
 *   `allowedUserIds`. Both filters belong in the query itself, never applied after ranking.
 *   Cosmos example: WHERE c.accountId = @accountId AND ARRAY_CONTAINS(c.allowedUserIds, @userId)
 *   AI Search example: accountId eq '<id>' and allowedUserIds/any(u: u eq '<user>')
 * - Empty `query`: newest first. Otherwise rank by relevance (the demo corpus fits whole, so plain
 *   newest-first is acceptable at first).
 * - Throw on service failure; the backend returns INTEGRATION_UNAVAILABLE (503).
 * - If a filter is ever missed, the agent refuses to run (500) rather than analyze the result.
 */
export interface SourceSearch {
  search(req: SourceSearchRequest): Promise<SourceRecord[]>;
}

/**
 * Stores ingested sources, upserting by `id` (re-ingesting the same input replaces it). Implemented
 * by the Azure teammate; whatever it writes, SourceSearch must be able to return. Store records as
 * given, including `allowedUserIds`. Throw on failure; the backend returns INTEGRATION_UNAVAILABLE (503).
 */
export interface SourceWriter {
  upsert(records: SourceRecord[]): Promise<void>;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Reference implementation with the required filters and simple keyword ranking. For tests and local runs. */
export class InMemorySourceStore implements SourceSearch, SourceWriter {
  private readonly sources = new Map<string, SourceRecord>();

  constructor(initial: SourceRecord[] = []) {
    for (const s of initial) this.sources.set(s.id, structuredClone(s));
  }

  async upsert(records: SourceRecord[]): Promise<void> {
    for (const r of records) this.sources.set(r.id, structuredClone(r));
  }

  async search({ accountId, userId, query, top }: SourceSearchRequest): Promise<SourceRecord[]> {
    const terms = new Set(words(query));
    return [...this.sources.values()]
      .filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId))
      .map((s) => ({ s, score: words(`${s.title} ${s.body}`).filter((w) => terms.has(w)).length }))
      .filter(({ score }) => terms.size === 0 || score > 0)
      .sort((a, b) => b.score - a.score || b.s.occurredAt.localeCompare(a.s.occurredAt))
      .slice(0, top)
      .map(({ s }) => structuredClone(s));
  }
}
