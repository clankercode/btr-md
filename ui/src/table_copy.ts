/** Slice the verbatim markdown source for a table given its source-map byte offsets
 *  (from emit.rs `data-src-start`/`data-src-end`). Returns null if offsets are absent/invalid. */
export function markdownForTable(
  source: string,
  startAttr: string | null | undefined,
  endAttr: string | null | undefined
): string | null {
  if (startAttr == null || endAttr == null) return null;
  const start = parseInt(startAttr, 10);
  const end = parseInt(endAttr, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (isNaN(start) || isNaN(end)) return null;
  if (start < 0 || end <= start || end > source.length) return null;
  const slice = source.slice(start, end);
  // Trim a single trailing newline if present
  return slice.endsWith('\n') ? slice.slice(0, -1) : slice;
}

/** DOM fallback: serialize a rendered <table> to TSV. */
export function tableToTsv(table: HTMLTableElement): string {
  const rows: string[] = [];
  for (const row of Array.from(table.rows)) {
    const cells: string[] = [];
    for (const cell of Array.from(row.cells)) {
      cells.push(cell.textContent ?? '');
    }
    rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}
