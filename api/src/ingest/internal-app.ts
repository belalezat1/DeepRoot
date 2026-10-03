import type { Account, SourceRecord } from "@deeproot/shared";
import { normalizeText, safeId, toIsoDate } from "./text.js";

/**
 * A declarative connector: everything needed to bring an internal tool's records into Deeproot.
 * Adding a new internal app means writing one of these, not new ingestion code. Paths use dot
 * notation into the app's own JSON ("customer.code").
 */
export type InternalAppConnector = {
  appId: string; // stable, ID-safe: "impl-tracker"
  appName: string; // shown in the UI: "Implementation Tracker"
  fields: {
    id: string; // the app's own record ID
    customerKey: string; // the app's identifier for the client
    title: string;
    occurredAt: string; // last-updated time, ISO string or epoch ms
    author?: string;
  };
  /** Body lines, in order. Each becomes "Label: value" so citations quote readable text. */
  body: Array<{ label: string; path: string; ifMissing?: string }>;
  /**
   * The app's customer keys mapped to Deeproot account IDs. A record whose key is not listed is
   * rejected: the connector never guesses an account, because the account decides who can read it.
   */
  accounts: Record<string, string>;
};

export type RejectedRecord = { index: number; recordId: string | null; reason: string };

export type InternalAppIngestResult = {
  records: SourceRecord[];
  rejected: RejectedRecord[];
};

/** Reads a dot path out of untyped JSON. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return normalizeText(value) || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null; // objects, arrays, null: not something we can quote reliably
}

/**
 * Maps raw records from an internal app into SourceRecords. Bad records are reported in `rejected`
 * rather than failing the batch, so one malformed row never blocks the rest of an export.
 * Access always comes from the Deeproot account; fields inside the app record cannot grant access.
 */
export function ingestInternalAppRecords(
  connector: InternalAppConnector,
  rawRecords: unknown[],
  accounts: Account[],
): InternalAppIngestResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result: InternalAppIngestResult = { records: [], rejected: [] };
  const seen = new Set<string>();

  rawRecords.forEach((raw, index) => {
    const recordId = asText(getPath(raw, connector.fields.id));
    const reject = (reason: string) => result.rejected.push({ index, recordId, reason });

    if (!recordId) return reject(`missing ${connector.fields.id}`);

    const customerKey = asText(getPath(raw, connector.fields.customerKey));
    const accountId = customerKey ? connector.accounts[customerKey] : undefined;
    const account = accountId ? byId.get(accountId) : undefined;
    if (!account) return reject(`customer "${customerKey ?? ""}" is not mapped to a Deeproot account`);

    const title = asText(getPath(raw, connector.fields.title));
    if (!title) return reject(`missing ${connector.fields.title}`);

    const occurredAt = toIsoDate(getPath(raw, connector.fields.occurredAt));
    if (!occurredAt) return reject(`invalid date in ${connector.fields.occurredAt}`);

    const body = connector.body
      .map(({ label, path, ifMissing }) => {
        const value = asText(getPath(raw, path)) ?? ifMissing;
        return value === undefined ? null : `${label}: ${value}`;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
    if (!body) return reject("no body fields present");

    const id = safeId(account.id, connector.appId, recordId);
    if (seen.has(id)) return reject("duplicate record in this batch");
    seen.add(id);

    const author = connector.fields.author ? asText(getPath(raw, connector.fields.author)) : null;

    result.records.push({
      id,
      accountId: account.id,
      kind: "internal_app",
      title,
      author: author ?? connector.appName,
      occurredAt,
      body,
      allowedUserIds: [...account.allowedUserIds],
      app: { id: connector.appId, name: connector.appName },
    });
  });

  return result;
}
