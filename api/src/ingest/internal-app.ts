import type { Account } from "@deeproot/shared";
import type { IngestResult } from "./result.js";
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
  /** Trusted field/identity mappings, never supplied by an import request. */
  permissions?: { path: string; users: Record<string, string> };
  classification?: { path: string; deliveryValues: string[] };
};

/**
 * Catches connector config mistakes when the app starts rather than as a batch of rejected rows.
 * Checks the config's own shape only; it cannot know the app's field names are right.
 */
export function assertValidConnector(connector: InternalAppConnector, accounts: Account[]): void {
  const problems: string[] = [];
  if (safeId(connector.appId) !== connector.appId) problems.push(`appId "${connector.appId}" is not ID-safe`);
  if (!connector.appName.trim()) problems.push("appName is empty");
  if (connector.body.length === 0) problems.push("body maps no fields");
  const known = new Set(accounts.map((a) => a.id));
  for (const [key, accountId] of Object.entries(connector.accounts)) {
    if (!known.has(accountId)) problems.push(`customer "${key}" maps to unknown account "${accountId}"`);
  }
  if (problems.length > 0) {
    throw new Error(`Connector ${connector.appId} is misconfigured: ${problems.join("; ")}`);
  }
}

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
  if (Array.isArray(value)) {
    // Lists of plain values read as "a, b"; lists of objects are skipped like any other object.
    const parts = value.map((v) => (Array.isArray(v) ? null : asText(v)));
    return parts.every((p) => p !== null) && parts.length > 0 ? parts.join(", ") : null;
  }
  return null; // objects and null: not something we can quote reliably
}

/**
 * Maps raw records from an internal app into SourceRecords. Text fields are untrusted data: they
 * are cleaned and labelled, never interpreted. Bad records are reported in `rejected`
 * rather than failing the batch, so one malformed row never blocks the rest of an export.
 * Access always comes from the Deeproot account; fields inside the app record cannot grant access.
 */
export function ingestInternalAppRecords(
  connector: InternalAppConnector,
  rawRecords: unknown[],
  accounts: Account[],
): IngestResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result: IngestResult = { records: [], rejected: [] };
  const seen = new Set<string>();

  rawRecords.forEach((raw, index) => {
    const recordId = asText(getPath(raw, connector.fields.id));
    const reject = (reason: string) => result.rejected.push({ index, recordId, reason });

    if (!recordId) return reject(`missing ${connector.fields.id}`);

    const customerKey = asText(getPath(raw, connector.fields.customerKey));
    const accountId = customerKey ? connector.accounts[customerKey] : undefined;
    const account = accountId ? byId.get(accountId) : undefined;
    if (!account) return reject(`customer "${customerKey ?? ""}" is not mapped to a Deeproot account`);

    if (connector.classification && !connector.classification.deliveryValues.includes(String(getPath(raw, connector.classification.path)))) return reject("record is not classified for account delivery");
    let allowedUserIds = [...account.allowedUserIds];
    if (connector.permissions) {
      const upstream = getPath(raw, connector.permissions.path);
      if (!Array.isArray(upstream) || !upstream.length || upstream.some(id => typeof id !== "string" || !Object.hasOwn(connector.permissions!.users, id))) return reject("missing or unmapped source permissions");
      allowedUserIds = [...new Set(upstream.map(id => connector.permissions!.users[id as string]!))].filter(id => account.allowedUserIds.includes(id));
      if (!allowedUserIds.length) return reject("source permissions grant no account access");
    }
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
      allowedUserIds,
      policy: { classification: "delivery", accessMode: connector.permissions ? "source" : "account" },
      app: { id: connector.appId, name: connector.appName },
    });
  });

  return result;
}
