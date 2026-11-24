/** Escape text for safe use inside HTML or SVG markup. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Escape, then turn **key term** into a highlighted <mark>. */
export function rich(value: unknown): string {
  return esc(value).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>").replace(/\*\*/g, "");
}

/** Split text into paragraphs on blank lines or single newlines. */
export function paragraphs(value: unknown): string[] {
  return String(value ?? "")
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wordCount(value: string): number {
  return (value.match(/\S+/g) ?? []).length;
}

/**
 * Strip caption-file noise from a transcript: WEBVTT headers, SRT cue numbers,
 * "00:01:02,000 --> ..." timing lines, inline [00:12] timestamps and tags.
 */
export function cleanTranscript(raw: string): string {
  return String(raw ?? "")
    .replace(/\r/g, "")
    .replace(/^WEBVTT.*$/m, "")
    .split("\n")
    .filter((l) => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^(NOTE|STYLE)\b/.test(l))
    .join("\n")
    .replace(/\[?\(?\b\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\)?\]?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
