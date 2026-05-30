// Copy a rendered table back to its Markdown source. emit.rs tags each block
// with `data-src-start`/`data-src-end` = 1-based, inclusive LINE numbers (from
// the source map), so we slice the document by lines. Falls back to TSV when
// the source map is unavailable. The DOM decoration is idempotent.

/** Extract the verbatim markdown for a table from its 1-based, inclusive line
 *  range (`data-src-start`/`data-src-end`). Returns null if absent/invalid. */
export function markdownForTable(
  source: string,
  startAttr: string | null | undefined,
  endAttr: string | null | undefined
): string | null {
  if (startAttr == null || endAttr == null) return null;
  // Require strictly numeric strings so partial parses like "2junk" are rejected.
  if (!/^\d+$/.test(startAttr) || !/^\d+$/.test(endAttr)) return null;
  const start = Number(startAttr);
  const end = Number(endAttr);
  if (start < 1 || end < start) return null;
  const lines = source.split('\n');
  if (end > lines.length) return null;
  return lines.slice(start - 1, end).join('\n');
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

const COPIED_REVERT_MS = 1200;

/** Wrap each table with a "Copy" button that yields its markdown source (or a
 *  TSV fallback). `getSource` returns the current editor document. Idempotent. */
export function decorateTables(root: HTMLElement, getSource: () => string): void {
  root.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (parent && parent.classList.contains('pmd-table-wrap')) return; // already decorated

    const wrap = document.createElement('div');
    wrap.className = 'pmd-table-wrap';
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-table-copy';
    btn.textContent = 'Copy';
    btn.title = 'Copy table as Markdown';

    let revert: ReturnType<typeof setTimeout> | undefined;
    const flash = (label: string): void => {
      btn.textContent = label;
      if (revert !== undefined) clearTimeout(revert);
      revert = setTimeout(() => {
        btn.textContent = 'Copy';
      }, COPIED_REVERT_MS);
    };

    btn.addEventListener('click', () => {
      const md =
        markdownForTable(getSource(), table.dataset.srcStart, table.dataset.srcEnd) ??
        tableToTsv(table);
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== 'function') {
        flash('Failed');
        return;
      }
      clip.writeText(md).then(() => flash('Copied')).catch(() => flash('Failed'));
    });

    wrap.appendChild(btn);
  });
}
