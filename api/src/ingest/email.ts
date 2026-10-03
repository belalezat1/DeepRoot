import type { Account, SourceRecord } from "@deeproot/shared";
import { ApiFailure } from "../errors.js";
import { htmlToText, normalizeText, safeId, toIsoDate } from "./text.js";

/** An email as a mail export or Graph API would hand it over, before Deeproot touches it. */
export type RawEmail = {
  messageId: string;
  from: string; // "Name <address>" or a bare address
  subject: string;
  sentAt: string; // anything Date can parse
  text?: string;
  html?: string;
};

// Markers that start the quoted history in a reply. Everything from here down is an older message,
// which is either ingested on its own or isn't ours to cite as this sender's words.
const QUOTE_MARKERS = [
  /^On .+wrote:$/, // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}$/i, // Outlook
  /^From: .+$/, // Outlook header block in a forwarded/replied message
  /^_{10,}$/, // Outlook separator line
];

/** Removes quoted reply history so citations point at what this sender actually wrote. */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((line, i) => i > 0 && QUOTE_MARKERS.some((re) => re.test(line.trim())));
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept.filter((line) => !line.trimStart().startsWith(">")).join("\n");
}

/**
 * Normalizes one email into a SourceRecord for `account`. Which account an email belongs to is
 * decided by the caller (e.g. the mailbox or thread it was filed under), never by the email itself.
 * Access is inherited from the Deeproot account, so nothing inside an email can widen who sees it.
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
    title: normalizeText(raw.subject) || "(no subject)",
    author: normalizeText(raw.from),
    occurredAt,
    body,
    allowedUserIds: [...account.allowedUserIds],
  };
}
