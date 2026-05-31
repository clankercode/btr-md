/** A match as a half-open offset range `[from, to)` into the searched string. */
export type MatchRange = [number, number];

/**
 * Enumerate case-insensitive, non-overlapping matches of `query` in `text`,
 * left to right. An empty query yields no matches.
 */
export function findMatches(text: string, query: string): MatchRange[] {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    ranges.push([idx, idx + needle.length]);
    from = idx + needle.length;
  }
  return ranges;
}
