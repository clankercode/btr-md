// Session save/restore — pure logic shared with main.ts.
//
// The backend (state/session.rs, Tauri commands save_session / load_session /
// restore_dirty_doc) is the source of truth for the session. This module holds
// the pure, testable parts: building the `save_session` payload from the tab
// list, and classifying a loaded `SessionDoc` into a restore action. The actual
// IPC / DOM wiring lives in main.ts.

import type { Mode, FileState } from './doc_state.js';
import type { Tab } from './tabs.js';

// ---------------------------------------------------------------------------
// save_session payload (Tauri command INPUT — args are camelCased by Tauri).
// ---------------------------------------------------------------------------

/** One open doc, as sent to `save_session`. Content is the live buffer for
 *  EVERY doc; the backend decides clean/dirty by comparing to base_content. */
export interface SaveDocInput {
  docId: number;
  mode: string;
  content: string;
}

/** Which tab was focused. `null` = none; `{ doc: i }` = docs[i]; "browser". */
export type ActiveTab = null | { doc: number } | 'browser';

export interface SaveSessionPayload {
  docs: SaveDocInput[];
  active: ActiveTab;
  browserTab: boolean;
}

/** A snapshot of one tab as needed to build the save payload. `buffer` is the
 *  live text from `tabBuffer(tab)`; absent for non-doc tabs. */
export interface TabSnapshot {
  kind: Tab['kind'];
  docId?: number;
  mode?: Mode;
  buffer?: string;
}

/**
 * Build the `save_session` payload from tab snapshots in tab order plus the id
 * of the active tab. The browser tab is excluded from `docs` and represented by
 * `browserTab` + `active: "browser"`.
 */
export function buildSavePayload(
  tabs: TabSnapshot[],
  activeIndex: number,
): SaveSessionPayload {
  const docs: SaveDocInput[] = [];
  let browserTab = false;
  // Map each tab's position to its index within `docs` (doc tabs only), so the
  // active tab can be expressed as an index into `docs`.
  const docIndexByTab: Array<number | null> = [];
  for (const tab of tabs) {
    if (tab.kind === 'doc' && tab.docId !== undefined) {
      docIndexByTab.push(docs.length);
      docs.push({
        docId: tab.docId,
        mode: tab.mode ?? 'split',
        content: tab.buffer ?? '',
      });
    } else {
      if (tab.kind === 'browser') browserTab = true;
      docIndexByTab.push(null);
    }
  }

  let active: ActiveTab = null;
  const activeTab = activeIndex >= 0 ? tabs[activeIndex] : undefined;
  if (activeTab) {
    if (activeTab.kind === 'browser') {
      active = 'browser';
    } else if (activeTab.kind === 'doc') {
      const di = docIndexByTab[activeIndex];
      if (di !== null) active = { doc: di };
    }
  }

  return { docs, active, browserTab };
}

// ---------------------------------------------------------------------------
// load_session result (Tauri command OUTPUT — fields are snake_case).
// ---------------------------------------------------------------------------

export interface UnsavedBuffer {
  content: string;
  baseline_content?: string;
}

export interface SessionDoc {
  path: string | null;
  mode: string;
  unsaved?: UnsavedBuffer;
}

export interface LoadedSession {
  version: number;
  docs: SessionDoc[];
  active: ActiveTab;
  browser_tab: boolean;
}

/** OpenedDoc shape returned by restore_dirty_doc / register_doc paths. */
export interface OpenedDocResult {
  doc_id: number;
  path: string;
  contents: string;
  state: FileState;
}

// A restore action classifies how a SessionDoc should be reopened.
export type RestoreAction =
  | { kind: 'untitled'; content: string; mode: Mode }
  | { kind: 'clean'; path: string; mode: Mode }
  | { kind: 'dirty'; path: string; content: string; baselineContent: string; mode: Mode };

function asMode(mode: string): Mode {
  return mode === 'source' || mode === 'preview' ? mode : 'split';
}

/**
 * Classify a loaded `SessionDoc` into the restore action main.ts should run:
 *  - path === null      -> untitled (register_doc with the buffer)
 *  - unsaved absent      -> clean (reopen from disk via openFile)
 *  - unsaved present + path -> dirty (restore_dirty_doc)
 */
export function classifyRestore(doc: SessionDoc): RestoreAction {
  const mode = asMode(doc.mode);
  if (doc.path === null) {
    return { kind: 'untitled', content: doc.unsaved?.content ?? '', mode };
  }
  if (!doc.unsaved) {
    return { kind: 'clean', path: doc.path, mode };
  }
  return {
    kind: 'dirty',
    path: doc.path,
    content: doc.unsaved.content,
    baselineContent: doc.unsaved.baseline_content ?? '',
    mode,
  };
}
