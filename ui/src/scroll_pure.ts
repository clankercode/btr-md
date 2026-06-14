// Shared pure helpers for scroll sync and scroll mirror. DOM-free so they
// are unit-testable in `node:test` without a DOM shim. This file exists as
// a single source of truth for the block-collection and block-picking logic
// that both `scroll_sync.ts` and `scroll_mirror.ts` depend on.

export interface BlockDesc {
  /** 1-based start line. */
  start: number;
  /** 1-based inclusive end line; `NaN` (or `< start`) means single line. */
  end: number;
  /** DOM nesting depth within the preview content root. */
  depth: number;
}

export interface TaggedBlock {
  el: HTMLElement;
  desc: BlockDesc;
}

/** Collect all `[data-src-start]` descendants of `content`, each paired with
 *  its source-range descriptor. Tolerant of missing/empty `data-src-end`. */
export function collectBlocks(content: HTMLElement): TaggedBlock[] {
  const out: TaggedBlock[] = [];
  content.querySelectorAll<HTMLElement>('[data-src-start]').forEach((el) => {
    const start = Number(el.dataset.srcStart);
    if (!Number.isFinite(start)) return;
    const endRaw = el.dataset.srcEnd;
    const end = endRaw !== undefined && endRaw !== '' ? Number(endRaw) : NaN;
    let depth = 0;
    for (let p = el.parentElement; p && p !== content; p = p.parentElement) depth += 1;
    out.push({ el, desc: { start, end, depth } });
  });
  return out;
}

/** Index of the most-specific block covering `line`: the largest `start` that
 *  still covers the line (`start <= line <= effectiveEnd`), tie-broken by
 *  greatest DOM `depth` (so a cell/row/list-item wins over an enclosing
 *  table/list sharing the same source range). Returns -1 if none cover it. */
export function pickBlockForLine(blocks: BlockDesc[], line: number): number {
  let best = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]!;
    const end = Number.isFinite(b.end) && b.end >= b.start ? b.end : b.start;
    if (b.start > line || line > end) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const cur = blocks[best]!;
    if (b.start > cur.start || (b.start === cur.start && b.depth >= cur.depth)) {
      best = i;
    }
  }
  return best;
}
