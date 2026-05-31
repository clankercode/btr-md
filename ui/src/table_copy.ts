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

function isDecoratedTable(table: HTMLTableElement): boolean {
  const viewport = table.parentElement;
  return Boolean(
    viewport?.classList.contains('pmd-table-viewport') &&
      viewport.parentElement?.classList.contains('pmd-table-wrap')
  );
}

/** Apply the expanded/collapsed state to a decorated table. Expanding grows the
 *  table on BOTH axes: it drops the vertical clip (`pmd-table-collapsed` on the
 *  viewport) AND lets the wrap break out of the reading column to the full
 *  preview-pane width (`is-expanded` on the wrap — see `.pmd-table-wrap.is-expanded`
 *  in components.css, which mirrors the code-block `cqi` breakout). Collapsing
 *  restores the constrained state. Pure DOM mutation, no layout reads. */
export function applyTableExpanded(
  viewport: HTMLElement,
  wrap: HTMLElement,
  toggle: HTMLButtonElement,
  expanded: boolean,
  collapseVertically = true
): void {
  viewport.classList.toggle('pmd-table-collapsed', collapseVertically && !expanded);
  wrap.classList.toggle('is-expanded', expanded);
  toggle.textContent = expanded ? 'Collapse' : 'Expand';
  toggle.title = expanded ? 'Collapse the table' : 'Expand the full table';
  toggle.setAttribute('aria-expanded', String(expanded));
}

/** Wrap each table with a top-right controls row: a "Copy" button (markdown
 *  source, TSV fallback) and — for tall tables — an Expand/Collapse toggle.
 *  `getSource` returns the current editor document. Idempotent. */
export function decorateTables(root: HTMLElement, getSource: () => string): void {
  selfAndDescendants<HTMLTableElement>(root, 'table').forEach((table) => {
    if (isDecoratedTable(table)) return;

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

    // Offer an Expand toggle when the table is clipped on EITHER axis: too tall
    // (scrollHeight) or too wide for the reading column (scrollWidth overflows
    // the viewport). Expanding then grows both axes. Measured after layout so
    // the scroll dimensions are meaningful (deferred a frame).
    requestAnimationFrame(() => {
      if (!wrap.isConnected) return;
      const tooTall = viewport.scrollHeight > EXPAND_THRESHOLD_PX;
      const tooWide = viewport.scrollWidth > viewport.clientWidth + 1;
      if (!tooTall && !tooWide) return;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pmd-table-btn pmd-table-expand';
      // Only tall tables get the vertical clip; wide-but-short ones stay open
      // vertically and just gain the horizontal breakout when expanded.
      applyTableExpanded(viewport, wrap, toggle, false, tooTall);
      toggle.addEventListener('click', () => {
        const expanded = !wrap.classList.contains('is-expanded');
        applyTableExpanded(viewport, wrap, toggle, expanded, tooTall);
      });
      controls.appendChild(toggle);
    });
  });
}
