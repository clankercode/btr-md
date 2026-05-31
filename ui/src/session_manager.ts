// Session persistence orchestration. The backend (`state/session.rs`) is the
// source of truth: `save_session` takes the live buffer of every open doc and
// decides clean/dirty by comparing to its stored base_content; `load_session`
// returns the full Session to restore.
//
// This module owns the *wiring* (debounced save, restore dispatch, close-flush)
// and stays out of main.ts; the pure payload/classification logic lives in
// `session.ts`. Dependencies that touch the editor/tab singletons in main.ts
// (the store, buffer snapshotting, tab creation, file opening) are injected so
// there is no import cycle.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { debounce, type Debounced } from './debounce.js';
import {
  buildSavePayload,
  classifyRestore,
  type TabSnapshot,
  type LoadedSession,
  type OpenedDocResult,
} from './session.js';
import type { TabStore, DocTab } from './tabs.js';
import type { FileState } from './doc_state.js';

const STALE_LOCALSTORAGE_KEY = 'pmd:session';

export interface SessionManagerDeps {
  store: TabStore;
  /** Snapshot one tab's live buffer (active = mounted editor, else stashed state). */
  tabBuffer: (tab: DocTab) => string;
  addDocTab: (
    doc: OpenedDocResult,
    opts: { background: boolean; title?: string; baseContent?: string },
  ) => Promise<DocTab>;
  openFile: (path: string, opts?: { background?: boolean }) => Promise<void>;
}

export interface SessionManager {
  /** Debounced session save; call from any state-changing site. */
  readonly saveSession: Debounced<[], Promise<void>>;
  /** Force the pending save to complete now (used on window close). */
  flushSessionNow: () => Promise<void>;
  /** Reopen every doc from a loaded session; returns whether anything opened. */
  restoreSession: (session: LoadedSession) => Promise<boolean>;
  /** Wire the Tauri window close to flush the session before exiting. */
  installCloseFlush: () => void;
  /** Drop the obsolete localStorage session key (one-time, on first run). */
  clearStaleSession: () => void;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const { store, tabBuffer, addDocTab, openFile } = deps;

  /** Snapshot the open tabs into the `save_session` payload + the active index. */
  function buildSessionPayloadFromStore() {
    const tabs = store.list();
    const snapshots: TabSnapshot[] = tabs.map((tab) =>
      tab.kind === 'doc'
        ? { kind: 'doc', docId: tab.docId, mode: tab.mode, buffer: tabBuffer(tab) }
        : { kind: tab.kind },
    );
    const activeId = store.activeId();
    const activeIndex = activeId === null ? -1 : tabs.findIndex((t) => t.id === activeId);
    return buildSavePayload(snapshots, activeIndex);
  }

  async function doSaveSession(): Promise<void> {
    const { docs, active, browserTab } = buildSessionPayloadFromStore();
    try {
      await invoke('save_session', { docs, active, browserTab });
    } catch (e) {
      // Same fault-tolerance as the old localStorage catch: never block the UI.
      console.error('save_session failed:', e);
    }
  }

  const saveSession = debounce(doSaveSession, 300);

  async function flushSessionNow(): Promise<void> {
    // Run the debounced call if one is pending; otherwise save the current state.
    await (saveSession.flush() ?? doSaveSession());
  }

  /** Register an untitled doc holding `content` and add it as a background tab. */
  async function restoreUntitled(content: string, mode: DocTab['mode']): Promise<void> {
    const reg = await invoke<{ doc_id: number; state: FileState }>('register_doc', {
      path: null,
      contents: content,
    });
    const tab = await addDocTab(
      { doc_id: reg.doc_id, path: '', contents: content, state: reg.state },
      { background: true },
    );
    store.updateDoc(tab.id, { mode });
  }

  async function restoreSession(session: LoadedSession): Promise<boolean> {
    let opened = 0;
    for (const d of session.docs) {
      try {
        const action = classifyRestore(d);
        if (action.kind === 'untitled') {
          await restoreUntitled(action.content, action.mode);
          opened++;
        } else if (action.kind === 'clean') {
          await openFile(action.path, { background: true });
          const tab = store.findDocByPath(action.path);
          if (tab) {
            store.updateDoc(tab.id, { mode: action.mode });
            opened++;
          }
        } else {
          // Dirty saved doc: reconstruct the authoritative FileState via the
          // backend, seeding the editor with the returned live buffer.
          try {
            const doc = await invoke<OpenedDocResult>('restore_dirty_doc', {
              path: action.path,
              content: action.content,
              baselineContent: action.baselineContent,
              background: true,
            });
            const tab = await addDocTab(doc, {
              background: true,
              baseContent: action.baselineContent,
            });
            store.updateDoc(tab.id, { mode: action.mode });
            opened++;
          } catch (e) {
            // File gone / non-admissible: never drop unsaved work — fall back to
            // an untitled buffer holding the unsaved content.
            console.error('restore_dirty_doc failed, falling back to untitled:', e);
            await restoreUntitled(action.content, action.mode);
            opened++;
          }
        }
      } catch (e) {
        // One bad entry never aborts the whole restore.
        console.error('Skipping un-restorable session doc:', e);
      }
    }

    if (session.browser_tab) store.addBrowser({ background: true });

    // Restore the focused tab. `active.doc` indexes into the restored docs, but
    // some docs may have been skipped, so resolve positionally over doc tabs.
    const active = session.active;
    if (active === 'browser') {
      store.addBrowser();
    } else if (active && typeof active === 'object') {
      const docTabs = store.list().filter((t): t is DocTab => t.kind === 'doc');
      const target = docTabs[active.doc];
      if (target) store.setActive(target.id);
    }

    return opened > 0 || session.browser_tab;
  }

  function installCloseFlush(): void {
    // Flush the (debounced) session save before the window actually closes —
    // beforeunload cannot await async IPC, so onCloseRequested is required.
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flushSessionNow();
        } catch (e) {
          console.error('Session flush on close failed:', e);
        }
        void getCurrentWindow().destroy();
      })
      .catch((e) => console.error('onCloseRequested setup failed:', e));
  }

  function clearStaleSession(): void {
    // The old localStorage session store is gone (backend is now the source of
    // truth). Drop any stale key on first run after upgrade.
    try {
      localStorage.removeItem(STALE_LOCALSTORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return { saveSession, flushSessionNow, restoreSession, installCloseFlush, clearStaleSession };
}
