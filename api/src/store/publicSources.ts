import { createHash } from "node:crypto";
import type { Citation, PublicSource, SourceRecord } from "@deeproot/shared";

export function sourceVersion(source: Pick<SourceRecord, "body" | "occurredAt" | "title" | "author">): string {
  return createHash("sha256").update(JSON.stringify([source.body, source.occurredAt, source.title, source.author])).digest("hex").slice(0, 20);
}

export function toPublicSource(source: SourceRecord): PublicSource {
  const { allowedUserIds: _omit, policy: _policy, ...rest } = source;
  return { ...rest, version: sourceVersion(source) };
}

/** Unique supporting records in first-cited order, with access lists kept on the server. */
export function publicSourcesFor(citations: Citation[], sourcesById: Map<string, SourceRecord>): PublicSource[] {
  return [...new Set(citations.map((c) => c.sourceId))].flatMap((id) => {
    const source = sourcesById.get(id);
    return source ? [toPublicSource(source)] : [];
  });
}
