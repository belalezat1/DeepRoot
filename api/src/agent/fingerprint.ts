import { createHash } from "node:crypto";
import type { SourceRecord } from "@deeproot/shared";

/** Order-independent fingerprint of the complete permitted records, including their access lists. */
export function sourceFingerprint(sources: SourceRecord[]): string {
  const records = [...sources].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [
    s.id, s.accountId, s.kind, s.title, s.author, s.occurredAt, s.body,
    [...s.allowedUserIds].sort(), s.app?.id, s.app?.name,
  ]);
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}
