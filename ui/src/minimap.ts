/**
 * Lightweight canvas minimap for the source editor (B010).
 *
 * Mounted on the RHS of the editor host: paints a zoomed-out density overview,
 * a VS Code–style viewport indicator, and green/red/amber ticks for the last
 * B009 reload-flash hunks (`getLastFlashHunks` / `flashLineMarks`).
 *
 * No extra npm deps — pure canvas + CodeMirror scroll/update hooks.
 */

import type { EditorView } from '@codemirror/view';
import {
  flashLineMarks,
  type FlashHunk,
  type FlashLineClass,
} from './reload_flash.js';
import {
  lineBandHeight,
  lineTopY,
  sampleLineDensities,
  scrollTopForMinimapY,
  viewportRect,
} from './minimap_geometry.js';

export interface MinimapOptions {
  /** Last flash hunks (defaults to always-empty). */
  getFlashHunks?: () => readonly FlashHunk[];
}

export interface MinimapHandle {
  /** Full repaint (content + viewport + markers). */
  redraw(): void;
  /** Repaint markers + viewport after a reload flash (content unchanged). */
  refreshMarkers(): void;
  /** React to a CodeMirror view update. */
  onViewUpdate(update: {
    docChanged: boolean;
    viewportChanged?: boolean;
    geometryChanged?: boolean;
    heightChanged?: boolean;
  }): void;
  destroy(): void;
}

const MARKER_COLORS: Record<FlashLineClass, string> = {
  'pmd-flash-add': 'rgba(34, 187, 34, 0.85)',
  'pmd-flash-remove': 'rgba(238, 68, 51, 0.9)',
  'pmd-flash-replace': 'rgba(218, 160, 32, 0.9)',
};

export function attachMinimap(
  view: EditorView,
  host: HTMLElement,
  options: MinimapOptions = {},
): MinimapHandle {
  const getFlashHunks = options.getFlashHunks ?? (() => []);

  host.classList.add('pmd-minimap');
  host.setAttribute('role', 'scrollbar');
  host.setAttribute('aria-label', 'Document minimap');
  host.setAttribute('aria-orientation', 'vertical');
  host.tabIndex = -1;

  const canvas = document.createElement('canvas');
  canvas.className = 'pmd-minimap-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Extremely rare; leave empty host and no-op handle.
    return {
      redraw: () => {},
      refreshMarkers: () => {},
      onViewUpdate: () => {},
      destroy: () => {
        host.replaceChildren();
      },
    };
  }

  let destroyed = false;
  let dragging = false;
  let densityCache: Float32Array | null = null;
  let densityForLines = -1;
  let densityForHeight = -1;
  let raf = 0;
  let needsContent = true;

  function cssSize(): { w: number; h: number; dpr: number } {
    const w = Math.max(0, host.clientWidth);
    const h = Math.max(0, host.clientHeight);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return { w, h, dpr };
  }

  function ensureCanvasSize(w: number, h: number, dpr: number): void {
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      needsContent = true;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rebuildDensity(lineCount: number, h: number): Float32Array {
    if (
      densityCache &&
      densityForLines === lineCount &&
      densityForHeight === h &&
      !needsContent
    ) {
      return densityCache;
    }
    const doc = view.state.doc;
    densityCache = sampleLineDensities(lineCount, h, (i) => {
      // CodeMirror lines are 1-based.
      try {
        return doc.line(i + 1).text as string;
      } catch {
        return '';
      }
    });
    densityForLines = lineCount;
    densityForHeight = h;
    needsContent = false;
    return densityCache;
  }

  function themeColors(): {
    strip: string;
    viewportFill: string;
    viewportStroke: string;
  } {
    // Prefer design-system CSS vars when present; fall back for headless tests.
    let muted = '';
    let border = '';
    try {
      const styles = getComputedStyle(host);
      muted = styles.getPropertyValue('--pmd-fg-muted').trim();
      border = styles.getPropertyValue('--pmd-border').trim();
    } catch {
      /* no DOM styles */
    }
    const strip = muted || 'rgba(140, 150, 170, 0.55)';
    return {
      strip,
      viewportFill: 'rgba(100, 140, 220, 0.16)',
      viewportStroke: border || 'rgba(120, 140, 200, 0.55)',
    };
  }

  function paint(): void {
    if (destroyed) return;
    const { w, h, dpr } = cssSize();
    if (w < 2 || h < 2) return;
    ensureCanvasSize(w, h, dpr);

    const colors = themeColors();
    ctx!.clearRect(0, 0, w, h);

    const lineCount = Math.max(1, view.state.doc.lines);
    const density = rebuildDensity(lineCount, h);

    // Content strips (left-aligned bars by line density).
    const padX = 4;
    const maxBar = Math.max(4, w - padX * 2 - 4);
    ctx!.fillStyle = colors.strip;
    for (let y = 0; y < density.length; y++) {
      const d = density[y]!;
      if (d <= 0.01) continue;
      const barW = Math.max(2, d * maxBar);
      ctx!.fillRect(padX, y, barW, 1);
    }

    // B009 flash markers (subtle ticks until next reload).
    const marks = flashLineMarks(getFlashHunks(), lineCount);
    if (marks.length > 0) {
      const band = Math.max(2, lineBandHeight(lineCount, h));
      for (const m of marks) {
        const y = lineTopY(m.line, lineCount, h);
        const color = MARKER_COLORS[m.className] ?? MARKER_COLORS['pmd-flash-replace'];
        // Faint full-width wash + solid left spine so dense hunks stay visible.
        const wash = color.replace(/,\s*[\d.]+\)$/, ', 0.18)');
        ctx!.fillStyle = wash;
        ctx!.fillRect(0, y, w, Math.max(2, band));
        ctx!.fillStyle = color;
        ctx!.fillRect(0, y, 3, Math.max(2, band));
      }
    }

    // Viewport indicator (drawn on top).
    const sc = view.scrollDOM;
    const vr = viewportRect(sc.scrollTop, sc.clientHeight, sc.scrollHeight, h);
    ctx!.fillStyle = colors.viewportFill;
    ctx!.fillRect(0, vr.top, w, vr.height);
    ctx!.strokeStyle = colors.viewportStroke;
    ctx!.lineWidth = 1;
    ctx!.strokeRect(0.5, vr.top + 0.5, Math.max(0, w - 1), Math.max(0, vr.height - 1));
  }

  function schedulePaint(invalidateContent = false): void {
    if (destroyed) return;
    if (invalidateContent) needsContent = true;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function seekToY(clientY: number): void {
    const rect = host.getBoundingClientRect();
    const y = clientY - rect.top;
    const sc = view.scrollDOM;
    sc.scrollTop = scrollTopForMinimapY(
      y,
      Math.max(1, host.clientHeight),
      sc.scrollHeight,
      sc.clientHeight,
    );
    // Immediate indicator update (don't wait for CM update cycle).
    schedulePaint(false);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    seekToY(e.clientY);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    e.preventDefault();
    seekToY(e.clientY);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      host.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onScroll(): void {
    schedulePaint(false);
  }

  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', onPointerUp);
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => schedulePaint(true))
      : null;
  ro?.observe(host);

  // Initial paint (next frame so layout has settled).
  schedulePaint(true);

  return {
    redraw: () => schedulePaint(true),
    refreshMarkers: () => schedulePaint(false),
    onViewUpdate: (update) => {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.heightChanged ||
        update.viewportChanged
      ) {
        schedulePaint(!!update.docChanged || !!update.heightChanged);
      }
    },
    destroy: () => {
      destroyed = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      ro?.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      view.scrollDOM.removeEventListener('scroll', onScroll);
      host.replaceChildren();
      host.classList.remove('pmd-minimap');
    },
  };
}
