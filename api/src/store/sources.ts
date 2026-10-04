import type { SourceRecord } from "@deeproot/shared";

export type SourceSearchRequest = {
  accountId: string;
  userId: string;
  /** Free-text terms. Empty means "the account's most recent sources". */
  query: string;
  top: number;
  signal?: AbortSignal;
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
  /** Authoritative point read. Configured adapters always implement this; optional for legacy test adapters. */
  get?(accountId: string, sourceId: string): Promise<SourceRecord | null>;
}

/**
 * Stores a source (an ingested email or app record, or a reviewed meeting transcript) so later
 * searches find it. Implemented by the Azure teammate (Cosmos DB, plus an AI Search index update if
 * Search is used). Saving the same `id` replaces it. Store the record as given, including
 * `allowedUserIds`. Throw on failure; the backend returns INTEGRATION_UNAVAILABLE (503).
 */
export interface SourceWriter {
  save(source: SourceRecord): Promise<void>;
  remove?(accountId: string, sourceId: string): Promise<void>;
}

/** Older exports cannot replace newer content or restore access revoked by either version. */
export function sourceForUpdate(incoming: SourceRecord, current?: SourceRecord | null): SourceRecord {
  if (incoming.kind !== "internal_app" || !current || current.occurredAt <= incoming.occurredAt) return incoming;
  return { ...current, allowedUserIds: current.allowedUserIds.filter(id => incoming.allowedUserIds.includes(id)),
    ...(incoming.policy?.classification === "restricted_payroll" ? { policy: incoming.policy } : {}) };
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Reference implementation with the required filters and simple keyword ranking. For tests and local runs. */
export class InMemorySourceSearch implements SourceSearch, SourceWriter {
  private readonly sources = new Map<string, SourceRecord>();

  constructor(initial: SourceRecord[] = []) {
    for (const s of initial) this.sources.set(s.id, structuredClone(s));
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

  async get(accountId: string, sourceId: string): Promise<SourceRecord | null> {
    const source = this.sources.get(sourceId);
    return source?.accountId === accountId ? structuredClone(source) : null;
  }

  async remove(accountId: string, sourceId: string): Promise<void> { if (this.sources.get(sourceId)?.accountId === accountId) this.sources.delete(sourceId); }

  async save(source: SourceRecord): Promise<void> {
    const current = this.sources.get(source.id);
    this.sources.set(source.id, structuredClone(sourceForUpdate(source, current)));
  }
}
