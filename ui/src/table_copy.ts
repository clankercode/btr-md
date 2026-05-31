// Copy a rendered table back to its Markdown source. emit.rs tags each block
// with `data-src-start`/`data-src-end` = 1-based, inclusive LINE numbers (from
// the source map), so we slice the document by lines. Falls back to TSV when
// the source map is unavailable. The DOM decoration is idempotent.
import { selfAndDescendants } from './dom_scope.ts';

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

/** Tall tables past this height collapse behind an expand toggle, mirroring the
 *  code-block expand affordance (see makeExpandButton in code_blocks.ts). */
const EXPAND_THRESHOLD_PX = 360;

/** Wrap each table with a top-right controls row: a "Copy" button (markdown
 *  source, TSV fallback) and — for tall tables — an Expand/Collapse toggle.
 *  `getSource` returns the current editor document. Idempotent. */
export function decorateTables(root: HTMLElement, getSource: () => string): void {
  selfAndDescendants<HTMLTableElement>(root, 'table').forEach((table) => {
    const parent = table.parentElement;
    if (parent && parent.classList.contains('pmd-table-wrap')) return; // already decorated

    const wrap = document.createElement('div');
    wrap.className = 'pmd-table-wrap';
    table.parentNode?.insertBefore(wrap, table);

    // The table scrolls/collapses inside an inner viewport; the controls sit on
    // the wrap (which never clips) so they stay visible when collapsed.
    const viewport = document.createElement('div');
    viewport.className = 'pmd-table-viewport';
    wrap.appendChild(viewport);
    viewport.appendChild(table);

    const controls = document.createElement('div');
    controls.className = 'pmd-table-controls';
    wrap.appendChild(controls);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmd-table-btn pmd-table-copy';
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

    controls.appendChild(btn);

    // Collapse tall tables behind an Expand toggle that sits next to Copy.
    // Measured after layout so scrollHeight is meaningful (deferred a frame).
    requestAnimationFrame(() => {
      if (viewport.scrollHeight <= EXPAND_THRESHOLD_PX) return;
      viewport.classList.add('pmd-table-collapsed');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pmd-table-btn pmd-table-expand';
      toggle.textContent = 'Expand';
      toggle.title = 'Expand the full table';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const collapsed = viewport.classList.toggle('pmd-table-collapsed');
        toggle.textContent = collapsed ? 'Expand' : 'Collapse';
        toggle.title = collapsed ? 'Expand the full table' : 'Collapse the table';
        toggle.setAttribute('aria-expanded', String(!collapsed));
      });
      controls.appendChild(toggle);
    });
  });
}
