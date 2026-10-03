import type { Account, SourceRecord } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import type { IngestResult } from "./result.js";
import { htmlToText, normalizeText, safeId, toIsoDate } from "./text.js";

/** An email as a mail export or Graph API would hand it over, before Deeproot touches it. */
export type RawEmail = {
  messageId: string;
  from: string; // "Name <address>" or a bare address
  to?: string[];
  cc?: string[];
  subject?: string;
  sentAt: string; // anything Date can parse
  text?: string;
  html?: string;
};

/**
 * Trusted, Deeproot-owned routing: each account has a mailbox the team CCs or BCCs on client mail
 * (the usual CRM pattern). An email is filed under an account only through this table.
 */
export type EmailRouting = {
  mailboxes: Record<string, string>; // lowercase address -> Deeproot account ID
};

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function addressList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * Validates untyped input into a RawEmail, keeping only known fields. Anything else on the object,
 * such as `accountId` or `allowedUserIds`, is dropped here and never reaches a SourceRecord.
 */
export function parseRawEmail(raw: unknown): RawEmail {
  if (raw === null || typeof raw !== "object") throw new ApiFailure("BAD_REQUEST", "Email is not an object.");
  const r = raw as Record<string, unknown>;

  const messageId = optionalString(r, "messageId");
  if (!messageId) throw new ApiFailure("BAD_REQUEST", "Email has no messageId.");
  const sentAt = optionalString(r, "sentAt");
  if (!sentAt) throw new ApiFailure("BAD_REQUEST", `Email ${messageId} has no sentAt.`);

  return {
    messageId,
    from: optionalString(r, "from") ?? "Unknown sender",
    to: addressList(r.to),
    cc: addressList(r.cc),
    subject: optionalString(r, "subject"),
    sentAt,
    text: optionalString(r, "text"),
    html: optionalString(r, "html"),
  };
}

/** "Dana <dana@x.example>" -> "dana@x.example". */
export function emailAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
}

// Markers that start the quoted history in a reply. Everything from here down is an older message,
// which is either ingested on its own or isn't ours to cite as this sender's words.
const QUOTE_MARKERS = [
  /^On .+wrote:$/, // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}$/i, // Outlook
  /^_{10,}$/, // Outlook separator line
  /^--$/, // signature delimiter "-- " (RFC 3676), after normalizeText trims it: not content
];

function startsQuote(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  if (QUOTE_MARKERS.some((re) => re.test(line.trim()))) return true;
  const next = lines.slice(i + 1, i + 5).map((l) => l.trim());
  // Gmail wraps long attributions: "On Fri, Sep 25, 2026 at 3:02 PM Sam Ortiz <sam@x>\nwrote:"
  if (/^On .+/.test(line) && next[0] === "wrote:") return true;
  // Outlook header block: "From:" followed closely by "Sent:" or "Date:". A lone "From:" is content.
  return /^From: .+/.test(line) && next.some((l) => /^(Sent|Date): /.test(l));
}

/** Removes quoted reply history so citations point at what this sender actually wrote. */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((_, i) => i > 0 && startsQuote(lines, i));
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept.filter((line) => !line.trimStart().startsWith(">")).join("\n");
}

/**
 * Picks the account for an email through the trusted mailbox table. Exactly one account mailbox
 * must be on the email: none means it isn't account mail, and two means filing it is a human
 * decision, not something to guess (a message CC'ing two clients must not land in both).
 */
export function routeEmail(email: RawEmail, routing: EmailRouting): string {
  const accountIds = new Set(
    [...(email.to ?? []), ...(email.cc ?? [])]
      .map((a) => routing.mailboxes[emailAddress(a)])
      .filter((id): id is string => id !== undefined),
  );
  if (accountIds.size === 0) throw new ApiFailure("BAD_REQUEST", "not addressed to any account mailbox");
  if (accountIds.size > 1) {
    throw new ApiFailure("BAD_REQUEST", `addressed to more than one account mailbox (${[...accountIds].join(", ")})`);
  }
  return [...accountIds][0]!;
}

/**
 * Normalizes one email into a SourceRecord for `account`. Plain text is preferred; HTML is the
 * fallback. Access is inherited from the Deeproot account, so nothing inside an email can widen
 * who sees it. The body stays untrusted data: it is cleaned, never interpreted.
 */
export function emailToSource(raw: RawEmail, account: Account): SourceRecord {
  const occurredAt = toIsoDate(raw.sentAt);
  if (!occurredAt) throw new ApiFailure("BAD_REQUEST", `Email ${raw.messageId} has no valid date.`);

  const content = raw.text ?? (raw.html ? htmlToText(raw.html) : "");
  const body = normalizeText(stripQuotedReply(normalizeText(content)));
  if (!body) throw new ApiFailure("BAD_REQUEST", `Email ${raw.messageId} has no body text.`);

  return {
    id: safeId(account.id, "email", raw.messageId),
    accountId: account.id,
    kind: "email",
    title: normalizeText(raw.subject ?? "") || "(no subject)",
    author: normalizeText(raw.from),
    occurredAt,
    body,
    allowedUserIds: [...account.allowedUserIds],
  };
}

/** Parses, routes, and normalizes a batch of raw emails, rejecting bad ones individually. */
export function ingestEmails(rawEmails: unknown[], routing: EmailRouting, accounts: Account[]): IngestResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result: IngestResult = { records: [], rejected: [] };
  const seen = new Set<string>();

  rawEmails.forEach((raw, index) => {
    let recordId: string | null = null;
    try {
      const email = parseRawEmail(raw);
      recordId = email.messageId;
      const accountId = routeEmail(email, routing);
      const account = byId.get(accountId);
      if (!account) throw new ApiFailure("BAD_REQUEST", `mailbox maps to unknown account "${accountId}"`);

      const record = emailToSource(email, account);
      if (seen.has(record.id)) throw new ApiFailure("BAD_REQUEST", "duplicate email in this batch");
      seen.add(record.id);
      result.records.push(record);
    } catch (err) {
      if (!(err instanceof ApiFailure)) throw err;
      result.rejected.push({ index, recordId, reason: err.message });
    }
  });

  return result;
}
