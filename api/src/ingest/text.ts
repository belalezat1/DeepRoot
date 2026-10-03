// Text cleanup shared by every input. Citations are matched verbatim against `body`, so every source
// must be normalized once, at ingest, and never rewritten afterwards.

/** Line endings, odd whitespace, and runs of blank lines, made consistent. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ") // non-breaking spaces become plain spaces
    .replace(/[​-‍﻿]/g, "") // zero-width characters
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] !== "#") return ENTITIES[m.toLowerCase()] ?? m;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/**
 * Good-enough HTML-to-text for email bodies. Drops non-content elements and the quoted history that
 * mail clients wrap in blockquotes. Not a sanitizer: the output is only ever handled as plain text.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|script|style|title)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*class="[^"]*gmail_quote[\s\S]*$/i, "") // Gmail: quoted history runs to the end
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text);
}

/** An ID safe for Cosmos DB and AI Search keys: letters, digits, dashes, underscores. */
export function safeId(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** Parses an ISO string or epoch milliseconds into ISO 8601, or returns null when it is not a date. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
