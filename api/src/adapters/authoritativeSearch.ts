import type { SourceRecord } from "@deeproot/shared";
import { filterPermittedSources } from "../access.js";
import type { SourceSearch, SourceSearchRequest } from "../store/sources.js";

/** Search ranks candidate IDs; Cosmos supplies current content, classification and permissions. */
export class AuthoritativeSourceSearch implements SourceSearch {
  constructor(private index: SourceSearch, private reader: { get(accountId: string, id: string): Promise<SourceRecord | null> }) {}
  get(accountId: string, id: string) { return this.reader.get(accountId, id); }
  async search(req: SourceSearchRequest): Promise<SourceRecord[]> {
    const indexed = await this.index.search(req);
    const records = await Promise.all(indexed.map(s => this.reader.get(req.accountId, s.id)));
    return filterPermittedSources(records.filter((s): s is SourceRecord => s !== null), req.accountId, req.userId);
  }
}
