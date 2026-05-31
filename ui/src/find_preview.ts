import { findMatches, type MatchRange } from './find_query.ts';

/** A flattened text node: its concatenation `start` offset and `text`. The
 *  `node` field is `Text` at runtime; tests pass a string stand-in. */
export interface TextChunk {
  node: unknown;
  start: number;
  text: string;
}

/** A highlight sub-range within a single text node, tagged with the index of
 *  the LOGICAL match it belongs to (a cross-node match shares one matchIndex). */
export interface NodeRange {
  matchIndex: number;
  node: unknown;
  from: number;
  to: number;
}

/**
 * Split flat-text match ranges into per-text-node sub-ranges. A match that
 * spans several chunks produces one sub-range per overlapped chunk, all tagged
 * with that match's index (its position in `matches`). Pure.
 */
export function mapMatchesToNodeRanges(
  chunks: TextChunk[],
  matches: MatchRange[],
): NodeRange[] {
  const out: NodeRange[] = [];
  matches.forEach(([mFrom, mTo], matchIndex) => {
    for (const chunk of chunks) {
      const chunkEnd = chunk.start + chunk.text.length;
      const overlapFrom = Math.max(mFrom, chunk.start);
      const overlapTo = Math.min(mTo, chunkEnd);
      if (overlapFrom < overlapTo) {
        out.push({
          matchIndex,
          node: chunk.node,
          from: overlapFrom - chunk.start,
          to: overlapTo - chunk.start,
        });
      }
    }
  });
  return out;
}

const HIGHLIGHT_NAME = 'pmd-find';
const MARK_CLASS = 'pmd-find';

/** True when the webview supports the CSS Custom Highlight API (Phase 0 rule). */
export function supportsHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

function collectTextChunks(root: HTMLElement): TextChunk[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: TextChunk[] = [];
  let start = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    if (text.length > 0) {
      chunks.push({ node, start, text });
      start += text.length;
    }
    node = walker.nextNode();
  }
  return chunks;
}

export interface PreviewFind {
  /** Re-run the current query against the live preview DOM. Safe to call often. */
  recompute(): void;
  /** Set the query and recompute; returns total match count. */
  setQuery(query: string): number;
  /** Number of matches from the last recompute. */
  count(): number;
  /** Move the current highlight; wraps around. No-op when there are no matches. */
  next(): void;
  previous(): void;
  /** 1-based index of the current match, or 0 when none. */
  currentIndex(): number;
  /** Clear all highlights/marks. */
  clear(): void;
}

export function createPreviewFind(root: HTMLElement): PreviewFind {
  const useHighlightApi = supportsHighlightApi();
  let query = '';
  let rangesByMatch: Range[][] = [];
  let allRanges: Range[] = [];
  let current = -1;

  function tearDownMarks(): void {
    root.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function clearHighlights(): void {
    if (useHighlightApi) {
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HIGHLIGHT_NAME);
    } else {
      tearDownMarks();
    }
    rangesByMatch = [];
    allRanges = [];
  }

  function buildRanges(): Range[][] {
    const chunks = collectTextChunks(root);
    const flat = chunks.map((c) => c.text).join('');
    const matches = findMatches(flat, query);
    const nodeRanges = mapMatchesToNodeRanges(chunks, matches);
    const byMatch: Range[][] = matches.map(() => []);
    for (const nr of nodeRanges) {
      try {
        const r = document.createRange();
        r.setStart(nr.node as Node, nr.from);
        r.setEnd(nr.node as Node, nr.to);
        byMatch[nr.matchIndex].push(r);
      } catch {
        // Concurrent preview reconciliation can stale a node; skip safely.
      }
    }
    return byMatch.filter((group) => group.length > 0);
  }

  function paint(): void {
    if (useHighlightApi) {
      const HighlightCtor = (globalThis as { Highlight: new (...ranges: Range[]) => unknown })
        .Highlight;
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(
        HIGHLIGHT_NAME,
        new HighlightCtor(...allRanges),
      );
      return;
    }

    for (let i = allRanges.length - 1; i >= 0; i--) {
      try {
        const mark = document.createElement('mark');
        mark.className = MARK_CLASS;
        allRanges[i].surroundContents(mark);
      } catch {
        // Some ranges cannot be wrapped; the Custom Highlight path covers these
        // on capable WebViews, and the fallback should never break rendering.
      }
    }
  }

  function scrollCurrentIntoView(): void {
    const range = rangesByMatch[current]?.[0];
    const parent = range?.startContainer.parentElement;
    parent?.scrollIntoView({ block: 'center' });
  }

  function recompute(): void {
    clearHighlights();
    if (query.length === 0) {
      current = -1;
      return;
    }
    rangesByMatch = buildRanges();
    allRanges = rangesByMatch.flat();
    current =
      rangesByMatch.length > 0 ? Math.min(Math.max(current, 0), rangesByMatch.length - 1) : -1;
    paint();
  }

  return {
    recompute,
    setQuery(next: string): number {
      query = next;
      current = -1;
      recompute();
      return rangesByMatch.length;
    },
    count: () => rangesByMatch.length,
    next(): void {
      if (rangesByMatch.length === 0) return;
      current = (current + 1) % rangesByMatch.length;
      scrollCurrentIntoView();
    },
    previous(): void {
      if (rangesByMatch.length === 0) return;
      current = (current - 1 + rangesByMatch.length) % rangesByMatch.length;
      scrollCurrentIntoView();
    },
    currentIndex: () => (current >= 0 ? current + 1 : 0),
    clear(): void {
      query = '';
      current = -1;
      clearHighlights();
    },
  };
}
