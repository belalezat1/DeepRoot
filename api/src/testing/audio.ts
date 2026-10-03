// Test helpers: the smallest byte arrays that pass or fail audio sniffing.

const ascii = (s: string) => new TextEncoder().encode(s);

/** A minimal valid WAV header; the content does not matter to ingest. */
export function wav(): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes.set(ascii("RIFF"), 0);
  bytes.set(ascii("WAVE"), 8);
  return bytes;
}

/** The header Zoom's .m4a recordings start with. */
export function m4a(): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes.set(ascii("ftypM4A "), 4);
  return bytes;
}
