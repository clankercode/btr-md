/**
 * Pure geometry helpers for the source-editor RHS minimap (B010).
 *
 * DOM-free so unit tests can exercise scroll ↔ line mapping under `node:test`
 * without a browser. The canvas controller in `minimap.ts` is the only
 * consumer that touches `EditorView` / DOM.
 */

/** Clamp `n` into `[lo, hi]`. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Maximum `scrollTop` for a scroll container (`0` when content fits). */
export function maxScrollTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/**
 * Map `scrollTop` → fraction in `[0, 1]` along the scrollable range.
 * When nothing scrolls, returns `0`.
 */
export function scrollFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = maxScrollTop(scrollHeight, clientHeight);
  if (max <= 0) return 0;
  return clamp(scrollTop / max, 0, 1);
}

/** Inverse of {@link scrollFraction}: fraction `[0, 1]` → `scrollTop`. */
export function scrollTopFromFraction(
  fraction: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return clamp(fraction, 0, 1) * maxScrollTop(scrollHeight, clientHeight);
}

/**
 * Viewport indicator rectangle on the minimap surface, document-proportional.
 *
 * `top` / `height` are CSS pixels within a minimap of height `minimapHeight`.
 * When content fits the editor (`scrollHeight <= clientHeight`), the indicator
 * covers the full minimap.
 */
export function viewportRect(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  minimapHeight: number,
): { top: number; height: number } {
  const h = Math.max(0, minimapHeight);
  if (h <= 0) return { top: 0, height: 0 };
  const sh = Math.max(1, scrollHeight);
  const ch = Math.max(0, clientHeight);
  if (sh <= ch) {
    return { top: 0, height: h };
  }
  const top = clamp((scrollTop / sh) * h, 0, h);
  const height = clamp((ch / sh) * h, 1, h - top);
  return { top, height };
}

/**
 * Map a minimap Y (CSS px from top) to a target `scrollTop`.
 *
 * Places the document position under the pointer near the center of the
 * viewport when possible (VS Code–style click-to-jump).
 */
export function scrollTopForMinimapY(
  y: number,
  minimapHeight: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const h = Math.max(1, minimapHeight);
  const frac = clamp(y / h, 0, 1);
  const docY = frac * Math.max(1, scrollHeight);
  return clamp(docY - clientHeight / 2, 0, maxScrollTop(scrollHeight, clientHeight));
}

/**
 * Map a 0-based line index to the top Y of its band on the minimap.
 * `lineCount` is the document line count (≥ 1 in CodeMirror).
 */
export function lineTopY(lineIndex: number, lineCount: number, minimapHeight: number): number {
  const n = Math.max(1, lineCount);
  const h = Math.max(0, minimapHeight);
  return (clamp(lineIndex, 0, n) / n) * h;
}

/** Height of one line band on the minimap (may be sub-pixel for large docs). */
export function lineBandHeight(lineCount: number, minimapHeight: number): number {
  const n = Math.max(1, lineCount);
  const h = Math.max(0, minimapHeight);
  return h / n;
}

/** 0-based line index under minimap Y. */
export function lineIndexFromY(y: number, lineCount: number, minimapHeight: number): number {
  const n = Math.max(1, lineCount);
  const h = Math.max(1, minimapHeight);
  return clamp(Math.floor((y / h) * n), 0, n - 1);
}

/**
 * Relative line "density" in `[0, 1]` from character length, used to paint
 * simplified content strips. Empty / whitespace-only lines → `0`.
 */
export function lineDensity(text: string, maxChars = 80): number {
  if (text.length === 0) return 0;
  // Ignore pure-whitespace lines (still count indent-only as empty).
  if (text.trim().length === 0) return 0;
  return clamp(text.length / Math.max(1, maxChars), 0, 1);
}

/**
 * Sample document lines into `bucketCount` density values for cheap painting.
 * Each bucket averages the lines that map into that vertical pixel band.
 *
 * `getLineText(i)` receives a 0-based line index and returns the line string.
 */
export function sampleLineDensities(
  lineCount: number,
  bucketCount: number,
  getLineText: (lineIndex: number) => string,
  maxChars = 80,
): Float32Array {
  const n = Math.max(1, lineCount);
  const buckets = Math.max(0, bucketCount | 0);
  const out = new Float32Array(buckets);
  if (buckets === 0) return out;

  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b / buckets) * n);
    const to = Math.max(from + 1, Math.floor(((b + 1) / buckets) * n));
    let sum = 0;
    let count = 0;
    for (let i = from; i < to && i < n; i++) {
      sum += lineDensity(getLineText(i), maxChars);
      count++;
    }
    out[b] = count > 0 ? sum / count : 0;
  }
  return out;
}
