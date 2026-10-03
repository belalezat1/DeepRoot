import type { Citation, SourceRecord } from "@deeproot/shared";

/** Shorter quotes ("Blocked", "Ohio") match too much to count as evidence on their own. */
export const MIN_QUOTE_LENGTH = 8;

const QUOTE_CHARS: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"' };

/**
 * Collapses whitespace and straightens curly quotes, keeping a map from each output character back
 * to its index in the original. Models often re-wrap lines or swap quote styles when quoting; the
 * map lets us accept that and still return the exact original text.
 */
function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (out.endsWith(" ")) continue;
      out += " ";
    } else {
      out += QUOTE_CHARS[ch] ?? ch;
    }
    map.push(i);
  }
  return { text: out, map };
}

/** Finds `quote` in `body`, tolerating whitespace and quote-style differences only. */
export function locateQuote(body: string, quote: string): { start: number; end: number } | null {
  const exact = body.indexOf(quote);
  if (exact !== -1) return { start: exact, end: exact + quote.length };

  const b = normalizeWithMap(body);
  const q = normalizeWithMap(quote).text.trim();
  const at = q ? b.text.indexOf(q) : -1;
  if (at === -1) return null;
  return { start: b.map[at]!, end: b.map[at + q.length - 1]! + 1 };
}

export type CitationScope = {
  accountId: string;
  userId: string;
  /** The sources the model was given. A citation to anything else is rejected, even if it exists. */
  sourcesById: Map<string, SourceRecord>;
};

/**
 * Returns the citation with the exact source text and offsets if it is real evidence, else null.
 * Valid means: the source was in the model's context, belongs to the requested account, the user
 * may see it, and the quote appears in its body.
 */
export function validateCitation(raw: unknown, scope: CitationScope): Citation | null {
  if (raw === null || typeof raw !== "object") return null;
  const { sourceId, quote } = raw as Record<string, unknown>;
  if (typeof sourceId !== "string" || typeof quote !== "string") return null;

  const source = scope.sourcesById.get(sourceId);
  if (!source || source.accountId !== scope.accountId || !source.allowedUserIds.includes(scope.userId)) return null;

  // Models like to wrap quotes in quotation marks or ellipses; those are not part of the evidence.
  const trimmed = quote.trim().replace(/^["'“‘]+|["'”’]+$/g, "").replace(/^\.{3}|\.{3}$/g, "").trim();
  if (trimmed.length < MIN_QUOTE_LENGTH) return null;

  const at = locateQuote(source.body, trimmed);
  if (!at) return null;
  return { sourceId, quote: source.body.slice(at.start, at.end), startOffset: at.start, endOffset: at.end };
}
