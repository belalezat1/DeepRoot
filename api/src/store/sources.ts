import type { SourceRecord } from "@deeproot/shared";

/**
 * Teammate 1 implements this with Cosmos DB / AI Search, applying account and allowed-user filters
 * in the query itself. Handlers still filter the results again (filterPermittedSources).
 */
export interface SourceStore {
  listForAccount(accountId: string, userId: string): Promise<SourceRecord[]>;
  save(source: SourceRecord): Promise<void>;
}

export class InMemorySourceStore implements SourceStore {
  private readonly sources = new Map<string, SourceRecord>();

  constructor(initial: SourceRecord[] = []) {
    for (const s of initial) this.sources.set(s.id, structuredClone(s));
  }

  async listForAccount(accountId: string, userId: string) {
    return [...this.sources.values()]
      .filter((s) => s.accountId === accountId && s.allowedUserIds.includes(userId))
      .map((s) => structuredClone(s));
  }

  async save(source: SourceRecord) {
    this.sources.set(source.id, structuredClone(source));
  }
}
