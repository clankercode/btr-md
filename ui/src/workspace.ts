// Pure, DOM-free workspace model shared by the sidebar and the folder tab.
// Paths are canonical POSIX-style absolute paths as returned by the backend.

import type { DirEntry, DirListing } from "./file_browser.js";

/** Parent of an absolute path, or null if it is the filesystem root. */
export function parentOf(path: string): string | null {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trimmed === "/") return null;
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return null;
  return idx === 0 ? "/" : trimmed.slice(0, idx);
}

/** Component-wise descendant test: is `child` equal to or under `dir`? */
export function isUnder(dir: string, child: string): boolean {
  const d = dir.replace(/\/+$/, "").split("/");
  const c = child.replace(/\/+$/, "").split("/");
  if (c.length < d.length) return false;
  return d.every((seg, i) => seg === c[i]);
}

/** Subset of `expanded` whose entries are under `root` (lazy prune on re-root). */
export function prunedExpanded(expanded: Set<string>, root: string): Set<string> {
  return new Set([...expanded].filter((p) => isUnder(root, p)));
}

const EXPANDED_KEY = "pmd:browser:expanded";

function loadExpanded(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistExpanded(expanded: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export interface WorkspaceDeps {
  listDir: (dir: string) => Promise<DirListing>;
}

export interface WorkspaceModel {
  root(): string | null;
  expanded(): Set<string>;
  selected(): string | null;
  activeFile(): string | null;
  entriesOf(dir: string): DirEntry[] | undefined;
  onChange(cb: () => void): void;
  setRoot(path: string): Promise<void>;
  navigateUp(): Promise<boolean>;
  expand(path: string): Promise<void>;
  collapse(path: string): void;
  toggleDir(path: string): Promise<void>;
  select(path: string | null): void;
  setActiveFile(path: string | null): void;
  revealFile(path: string): Promise<void>;
  refresh(): Promise<void>;
}

export function createWorkspaceModel(deps: WorkspaceDeps): WorkspaceModel {
  let root: string | null = null;
  let expanded = loadExpanded();
  let selected: string | null = null;
  let activeFile: string | null = null;
  const cache = new Map<string, DirEntry[]>();
  const handlers: Array<() => void> = [];

  const emit = () => handlers.forEach((h) => h());

  async function ensureLoaded(dir: string): Promise<void> {
    if (cache.has(dir)) return;
    try {
      const listing = await deps.listDir(dir);
      cache.set(dir, listing.entries);
    } catch (e) {
      console.error("list_dir failed:", e);
      cache.set(dir, []);
    }
  }

  return {
    root: () => root,
    expanded: () => expanded,
    selected: () => selected,
    activeFile: () => activeFile,
    entriesOf: (dir) => cache.get(dir),
    onChange: (cb) => { handlers.push(cb); },

    setRoot: async (path) => {
      root = path;
      expanded = prunedExpanded(expanded, path);
      persistExpanded(expanded);
      cache.delete(path);
      await ensureLoaded(path);
      emit();
    },

    navigateUp: async () => {
      if (!root) return false;
      const parent = parentOf(root);
      if (!parent) return false;
      root = parent;
      cache.delete(parent);
      await ensureLoaded(parent);
      emit();
      return true;
    },

    expand: async (path) => {
      expanded.add(path);
      persistExpanded(expanded);
      await ensureLoaded(path);
      emit();
    },
    collapse: (path) => {
      expanded.delete(path);
      persistExpanded(expanded);
      emit();
    },
    toggleDir: async (path) => {
      if (expanded.has(path)) {
        expanded.delete(path);
        persistExpanded(expanded);
        emit();
      } else {
        expanded.add(path);
        persistExpanded(expanded);
        await ensureLoaded(path);
        emit();
      }
    },

    select: (path) => { selected = path; emit(); },
    setActiveFile: (path) => { activeFile = path; emit(); },

    revealFile: async (path) => {
      // A file outside the current root can never be the workspace's active
      // file; clear any stale highlight rather than leaving the previous one.
      if (!root || !isUnder(root, path)) {
        if (activeFile !== null) {
          activeFile = null;
          emit();
        }
        return;
      }
      // Expand each ancestor between root and the file's directory.
      let cur = parentOf(path);
      const toOpen: string[] = [];
      while (cur && isUnder(root, cur)) {
        toOpen.push(cur);
        if (cur === root) break;
        cur = parentOf(cur);
      }
      for (const d of toOpen.reverse()) {
        expanded.add(d);
        await ensureLoaded(d);
      }
      persistExpanded(expanded);
      activeFile = path;
      emit();
    },

    refresh: async () => {
      cache.clear();
      if (root) await ensureLoaded(root);
      emit();
    },
  };
}
