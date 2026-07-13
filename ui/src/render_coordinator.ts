// Render coordinator: owns the tab-aware render queue extracted verbatim from
// main.ts. Each render carries {tabId, seq, docId, version}; a result is painted
// only when it is still the latest render for the tab that is still active (the
// 4-part staleness gate). Renders run one at a time (the `rendering` gate) and
// drain FIFO. The post-render fan-out (mermaid/katex/code/tables decoration,
// preview-find refresh, outline, asset grants, scroll-sync recentre) is NOT
// hard-wired here: DOM decoration is a list of injected `decorators` and the
// once-per-applied-render side effects are `onApplied` subscribers, so main.ts
// keeps ownership of the wiring.

import { debounce } from './debounce.ts';
import type { RenderResult } from './document_contracts.ts';
import type { BlockRef } from './block_reconcile.ts';

export interface RenderRequest {
  docId: number;
  version: number;
  markdown: string;
  allowDocumentStyles?: boolean;
}

/** The active-doc tab as the coordinator needs it: a stable object whose
 *  `renderSeq` the coordinator increments per scheduled render. */
export interface RenderTargetTab {
  id: number;
  docId: number;
  renderSeq: number;
  /** When true, ask the backend to apply sanitized document styles. */
  documentStylesChoice?: 'unknown' | 'allow' | 'deny';
}

/** A tab as seen by the staleness gate. `kind`/`docId`/`renderSeq` are read;
 *  non-doc tabs (which lack docId/renderSeq) fail the `kind === 'doc'` guard. */
export interface StalenessTab {
  kind: string;
  docId?: number;
  renderSeq?: number;
}

/** A DOM decorator applied to a freshly-painted node (the whole root on a full
 *  replace, or each changed node after a reconcile). Runs in list order; async
 *  decorators (mermaid/katex) are awaited before the next. */
export type Decorator = (node: HTMLElement, nonce: string) => void | Promise<void>;

/** Low-level DOM writes, injected so the coordinator's queue/staleness/fallback
 *  logic is unit-testable without a real DOM. */
export interface CoordinatorDom {
  /** Replace the whole preview from HTML (`root.innerHTML = html`). */
  fullReplace: (root: HTMLElement, html: string) => void;
  /** Reconcile `root`'s children against `html` using the block manifest;
   *  returns the newly-inserted/replaced nodes for scoped decoration. Throws on
   *  desync (see `isDesyncError`). */
  reconcile: (root: HTMLElement, html: string, blocks: BlockRef[]) => HTMLElement[];
  /** After a reconcile, stamp the current nonce onto all kept nodes so a later
   *  theme re-render does not skip them. */
  refreshKeptNonces: (root: HTMLElement, nonce: string) => void;
  /** True when the reconcile throw is a benign block-manifest desync (falls
   *  back silently); false for anything else (falls back AND logs). */
  isDesyncError: (err: unknown) => boolean;
  /** Log a non-desync reconcile failure (defaults to console.error in main). */
  onReconcileError?: (err: unknown) => void;
}

export interface RenderCoordinatorDeps {
  /** Perform the backend render (docsApi.renderCmd). */
  render: (req: RenderRequest) => Promise<RenderResult>;
  /** The preview root element decorators/DOM ops act on. */
  root: HTMLElement;
  /** DOM decoration pipeline, applied to each painted node in order. */
  decorators: Decorator[];
  /** Low-level DOM writes. */
  dom: CoordinatorDom;
  /** The current active doc tab (null when none / not a doc). */
  activeDoc: () => RenderTargetTab | null | undefined;
  /** Live editor buffer text; null when there is no mounted editor (bail). */
  getValue: () => string | null;
  /** Look up a tab by id for the staleness gate. */
  getTab: (id: number) => StalenessTab | null | undefined;
  /** The id of the currently active tab. */
  activeId: () => number | null;
  /** Debounce window (ms) for `scheduleDebounced`. Defaults to 80. */
  debounceMs?: number;
}

export interface RenderCoordinator {
  /** Immediate render of the active doc. Cancels any pending debounced render
   *  (this one supersedes it), bumps the version, and enqueues. */
  schedule(): Promise<void>;
  /** Coalesced (debounced) render for keystroke bursts. */
  scheduleDebounced(): void;
  /** Latest scheduled version (monotonic). Does not advance until a debounced
   *  render actually fires — so a pre-edit reader sees the old version. */
  currentVersion(): number;
  /** Version of the most recently applied (painted) render, else 0. */
  appliedVersion(): number;
  /** Render nonce of the most recently applied render, else ''. */
  appliedNonce(): string;
  /** Subscribe to applied renders; fires exactly once per painted render, in
   *  registration order, after the DOM has settled. */
  onApplied(cb: (result: RenderResult) => void): void;
  /** Cancel any pending debounced render (teardown). */
  dispose(): void;
}

interface RenderItem {
  md: string;
  tabId: number;
  docId: number;
  seq: number;
  version: number;
  allowDocumentStyles: boolean;
  resolve: () => void;
  reject: (e: unknown) => void;
}

export function createRenderCoordinator(deps: RenderCoordinatorDeps): RenderCoordinator {
  const { render, root, decorators, dom, activeDoc, getValue, getTab, activeId } = deps;

  let renderQueue: RenderItem[] = [];
  let rendering = false;
  let currentVersion = 0;
  let appliedVersion = 0;
  let appliedNonce = '';
  const appliedSubscribers: Array<(result: RenderResult) => void> = [];

  // Debounced immediate-render. `scheduleRenderDebounced` calls `schedule()`,
  // which itself cancels this timer — so a burst coalesces to one render and an
  // immediate render always wins over a pending debounced one.
  const scheduleRenderDebounced = debounce(() => {
    void schedule();
  }, deps.debounceMs ?? 80);

  async function runDecorators(node: HTMLElement, nonce: string): Promise<void> {
    for (const decorate of decorators) {
      await decorate(node, nonce);
    }
  }

  async function paint(result: RenderResult): Promise<void> {
    const nonce = result.render_nonce;
    // Full-document replace + decorate. Used for the non-incremental path and as
    // the safety fallback when block reconcile detects a desync.
    const fullReplace = async (): Promise<void> => {
      dom.fullReplace(root, result.html);
      await runDecorators(root, nonce);
    };
    if (result.blocks && result.blocks.length > 0) {
      try {
        const changed = dom.reconcile(root, result.html, result.blocks);
        for (const node of changed) {
          await runDecorators(node, nonce);
        }
        // Refresh the nonce on all kept (unchanged) nodes so that a later theme
        // change does not skip them — it filters by the current root nonce.
        dom.refreshKeptNonces(root, nonce);
      } catch (err) {
        // A desync (or any reconcile failure) must never wedge the preview:
        // rebuild the whole thing from scratch so updates keep flowing.
        if (!dom.isDesyncError(err)) dom.onReconcileError?.(err);
        await fullReplace();
      }
    } else {
      await fullReplace();
    }
  }

  async function processRenderQueue(): Promise<void> {
    if (rendering || renderQueue.length === 0) return;
    rendering = true;
    const item = renderQueue.shift()!;
    try {
      const result = await render({
        docId: item.docId,
        version: item.version,
        markdown: item.md,
        allowDocumentStyles: item.allowDocumentStyles,
      });
      const tab = getTab(item.tabId);
      const stillCurrent =
        tab &&
        tab.kind === 'doc' &&
        tab.renderSeq === item.seq &&
        tab.docId === result.doc_id &&
        result.version === item.version &&
        activeId() === item.tabId;
      if (stillCurrent) {
        appliedVersion = result.version;
        appliedNonce = result.render_nonce;
        await paint(result);
        // The DOM is now fresh: fire the once-per-applied-render subscribers in
        // registration order (preview-find refresh, outline, asset grants,
        // scroll-sync recentre keyed on (doc id, version)).
        for (const cb of appliedSubscribers) cb(result);
      }
      item.resolve();
    } catch (e) {
      item.reject(e);
    } finally {
      rendering = false;
      void processRenderQueue();
    }
  }

  function schedule(): Promise<void> {
    // Drop any pending debounced edit-render: this render supersedes it (covers
    // immediate tab-switch/reload/merge renders, and the debounced fire itself).
    scheduleRenderDebounced.cancel();
    const tab = activeDoc();
    const md = getValue();
    if (!tab || md === null) return Promise.resolve();
    tab.renderSeq++;
    const version = ++currentVersion;
    const base: Omit<RenderItem, 'resolve' | 'reject'> = {
      md,
      tabId: tab.id,
      docId: tab.docId,
      seq: tab.renderSeq,
      version,
      allowDocumentStyles: tab.documentStylesChoice === 'allow',
    };
    return new Promise<void>((resolve, reject) => {
      renderQueue.push({ ...base, resolve, reject });
      void processRenderQueue();
    });
  }

  return {
    schedule,
    scheduleDebounced: () => scheduleRenderDebounced(),
    currentVersion: () => currentVersion,
    appliedVersion: () => appliedVersion,
    appliedNonce: () => appliedNonce,
    onApplied: (cb) => {
      appliedSubscribers.push(cb);
    },
    dispose: () => {
      scheduleRenderDebounced.cancel();
      renderQueue = [];
    },
  };
}
