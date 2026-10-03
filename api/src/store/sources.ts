import type { SourceRecord } from "@deeproot/shared";

export type SourceSearchRequest = {
  accountId: string;
  userId: string;
  /** Free-text terms. Empty means "the account's most recent sources". */
  query: string;
  top: number;
};

/**
 * Retrieval over ingested SourceRecords. Teammate 1 implements this with Azure AI Search; every query
 * must filter on both fields, in the index, before ranking:
 *   accountId eq '<accountId>' and allowedUserIds/any(u: u eq '<userId>')
 * The agent re-checks every result anyway, and refuses to run if a filter was missed.
 */
export interface SourceSearch {
  search(req: SourceSearchRequest): Promise<SourceRecord[]>;
}

/**
 * Stores a new source (such as a reviewed meeting transcript) so later searches find it.
 * Teammate 1 implements this with Cosmos DB plus an AI Search index update. Saving the same ID replaces it.
 */
export interface SourceWriter {
  save(source: SourceRecord): Promise<void>;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Same filters as the Azure version, with simple keyword ranking. For tests and local runs. */
export class InMemorySourceSearch implements SourceSearch, SourceWriter {
  private readonly sources: SourceRecord[];

  constructor(sources: SourceRecord[]) {
    this.sources = sources.map((s) => structuredClone(s));
  }

  async search({ accountId, userId, query, top }: SourceSearchRequest): Promise<SourceRecord[]> {
    const terms = new Set(words(query));
    return this.sources
      .filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId))
      .map((s) => ({ s, score: words(`${s.title} ${s.body}`).filter((w) => terms.has(w)).length }))
      .filter(({ score }) => terms.size === 0 || score > 0)
      .sort((a, b) => b.score - a.score || b.s.occurredAt.localeCompare(a.s.occurredAt))
      .slice(0, top)
      .map(({ s }) => structuredClone(s));
  }

  async save(source: SourceRecord) {
    const i = this.sources.findIndex((s) => s.id === source.id);
    if (i === -1) this.sources.push(structuredClone(source));
    else this.sources[i] = structuredClone(source);
  }
}
