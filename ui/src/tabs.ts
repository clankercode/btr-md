// The tab model. A tab is one of three kinds (discriminated on `kind`):
// a document, the empty/welcome tab, or the file-browser tab. The `TabStore`
// owns the list + active selection; `main.ts` drives it and `tabbar.ts` renders
// it. Every consumer switches on `kind` exhaustively (compile-checked under the
// scoped tsconfig via `assertNever`).

import type { EditorState } from '@codemirror/state';
import type { FileState, Mode } from './doc_state.js';

export type TabId = number;

export interface DocTab {
  kind: 'doc';
  id: TabId;
  /** Backend document id (registry key). */
  docId: number;
  filePath: string | null;
  title: string;
  mode: Mode;
  fileState: FileState;
  /** Last-loaded / last-saved text — the diff-view baseline. */
  baseContent: string;
  /** Live CodeMirror state for this tab. Held in memory only — NEVER serialized. */
  editorState: EditorState | null;
  /** Last rendered preview HTML (restored when re-activating the tab). */
  cachedHtml: string | null;
  scrollEditor: number;
  scrollPreview: number;
  /** Per-tab monotonic render sequence: a render result is applied/cached only
   *  if it is still the latest for its tab. */
  renderSeq: number;
  reloadPending: boolean;
}

export interface EmptyTab {
  kind: 'empty';
  id: TabId;
  title: string;
}

export interface BrowserTab {
  kind: 'browser';
  id: TabId;
  title: string;
}

export type Tab = DocTab | EmptyTab | BrowserTab;

export interface NewDocTab {
  docId: number;
  filePath: string | null;
  title: string;
  mode: Mode;
  fileState: FileState;
  baseContent: string;
  editorState: EditorState | null;
}

export interface TabStore {
  list(): Tab[];
  get(id: TabId): Tab | undefined;
  active(): Tab | undefined;
  activeId(): TabId | null;
  activeDoc(): DocTab | undefined;
  addDoc(spec: NewDocTab, opts?: { background?: boolean }): DocTab;
  addEmpty(opts?: { background?: boolean }): EmptyTab;
  /** Add (or focus the existing) browser tab. */
  addBrowser(opts?: { background?: boolean }): BrowserTab;
  setActive(id: TabId): void;
  close(id: TabId): Tab | undefined;
  updateDoc(id: TabId, patch: Partial<DocTab>): void;
  findDocByPath(path: string): DocTab | undefined;
  onChange(cb: () => void): void;
  onActivate(cb: (prev: Tab | undefined, next: Tab | undefined) => void): void;
}

export function createTabStore(): TabStore {
  let tabs: Tab[] = [];
  let activeId: TabId | null = null;
  let nextId = 1;
  const changeHandlers: Array<() => void> = [];
  const activateHandlers: Array<(prev: Tab | undefined, next: Tab | undefined) => void> = [];

  const byId = (id: TabId): Tab | undefined => tabs.find((t) => t.id === id);
  const notifyChange = (): void => changeHandlers.forEach((h) => h());

  function setActive(id: TabId): void {
    if (activeId === id) return;
    const prev = activeId !== null ? byId(activeId) : undefined;
    const next = byId(id);
    if (!next) return;
    activeId = id;
    activateHandlers.forEach((h) => h(prev, next));
    notifyChange();
  }

  function addDoc(spec: NewDocTab, opts?: { background?: boolean }): DocTab {
    const tab: DocTab = {
      kind: 'doc',
      id: nextId++,
      docId: spec.docId,
      filePath: spec.filePath,
      title: spec.title,
      mode: spec.mode,
      fileState: spec.fileState,
      baseContent: spec.baseContent,
      editorState: spec.editorState,
      cachedHtml: null,
      scrollEditor: 0,
      scrollPreview: 0,
      renderSeq: 0,
      reloadPending: false,
    };
    tabs.push(tab);
    if (!opts?.background) setActive(tab.id);
    else notifyChange();
    return tab;
  }

  function addEmpty(opts?: { background?: boolean }): EmptyTab {
    const tab: EmptyTab = { kind: 'empty', id: nextId++, title: 'New Tab' };
    tabs.push(tab);
    if (!opts?.background) setActive(tab.id);
    else notifyChange();
    return tab;
  }

  function addBrowser(opts?: { background?: boolean }): BrowserTab {
    const existing = tabs.find((t): t is BrowserTab => t.kind === 'browser');
    if (existing) {
      if (!opts?.background) setActive(existing.id);
      return existing;
    }
    const tab: BrowserTab = { kind: 'browser', id: nextId++, title: 'Files' };
    tabs.push(tab);
    if (!opts?.background) setActive(tab.id);
    else notifyChange();
    return tab;
  }

  function close(id: TabId): Tab | undefined {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    const [removed] = tabs.splice(idx, 1);
    if (activeId === id) {
      // Activate the neighbour (prefer the one to the left).
      const fallback = tabs[idx - 1] ?? tabs[idx] ?? undefined;
      activeId = null;
      if (fallback) {
        setActive(fallback.id);
      } else {
        activateHandlers.forEach((h) => h(removed, undefined));
      }
    }
    notifyChange();
    return removed;
  }

  function updateDoc(id: TabId, patch: Partial<DocTab>): void {
    const t = byId(id);
    if (t && t.kind === 'doc') {
      Object.assign(t, patch);
      notifyChange();
    }
  }

  function findDocByPath(path: string): DocTab | undefined {
    return tabs.find((t): t is DocTab => t.kind === 'doc' && t.filePath === path);
  }

  return {
    list: () => tabs.slice(),
    get: byId,
    active: () => (activeId !== null ? byId(activeId) : undefined),
    activeId: () => activeId,
    activeDoc: () => {
      const a = activeId !== null ? byId(activeId) : undefined;
      return a && a.kind === 'doc' ? a : undefined;
    },
    addDoc,
    addEmpty,
    addBrowser,
    setActive,
    close,
    updateDoc,
    findDocByPath,
    onChange: (cb) => {
      changeHandlers.push(cb);
    },
    onActivate: (cb) => {
      activateHandlers.push(cb);
    },
  };
}
