import type { Citation, SourceRecord } from "@deeproot/shared";

/** Collapses whitespace so a quote still matches across line breaks or double spaces. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Keeps a citation only if its source is in `permitted` and its quote appears in that source's body.
 * Returns the citation with offsets pointing at the matched text, or null.
 */
export function verifyCitation(citation: unknown, permitted: Map<string, SourceRecord>): Citation | null {
  const c = citation as Partial<Citation> | null;
  if (typeof c?.sourceId !== "string" || typeof c.quote !== "string") return null;
  const source = permitted.get(c.sourceId);
  const quote = c.quote.trim();
  if (!source || quote.length < 3) return null;

  const exact = source.body.indexOf(quote);
  if (exact >= 0) return { sourceId: source.id, quote, startOffset: exact, endOffset: exact + quote.length };

  // Whitespace-insensitive fallback: no offsets, since they would not map onto the original body.
  return collapse(source.body).includes(collapse(quote)) ? { sourceId: source.id, quote } : null;
}

/** Verifies a list of citations, dropping invalid ones and duplicates. */
export function verifyCitations(citations: unknown, permitted: Map<string, SourceRecord>): Citation[] {
  if (!Array.isArray(citations)) return [];
  const seen = new Set<string>();
  const kept: Citation[] = [];
  for (const raw of citations) {
    const c = verifyCitation(raw, permitted);
    if (!c) continue;
    const key = `${c.sourceId}\u0000${c.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return kept;
}

export function indexSources(sources: SourceRecord[]): Map<string, SourceRecord> {
  return new Map(sources.map((s) => [s.id, s]));
}
