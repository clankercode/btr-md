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

/** Basename of a path (last segment), or empty for root. */
export function baseName(path: string): string {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trimmed === "/" || trimmed === "") return "";
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** True when a path segment is a "hidden" (dot) name — matches backend filter. */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/**
 * Ensure every ancestor of `path` (and the file itself) appears in the
 * corresponding parent listing. Used so opening a document under a hidden
 * folder still expands in the sidebar even when `list_dir` omits dot entries.
 *
 * Injected entries are merged with the real listing (if any) without removing
 * other entries. Directory-ness is inferred from whether the path is a strict
 * ancestor of the target file.
 */
export function ensurePathVisible(
  cache: Map<string, DirEntry[]>,
  root: string,
  path: string,
  isMarkdown: (name: string) => boolean = (n) => /\.(md|markdown|mdown|mkd|html?)$/i.test(n),
): void {
  if (!isUnder(root, path) || path === root) return;

  // Walk root → file, injecting each segment into its parent listing.
  const rootParts = root.replace(/\/+$/, "").split("/");
  const pathParts = path.replace(/\/+$/, "").split("/");
  if (pathParts.length <= rootParts.length) return;

  for (let i = rootParts.length; i < pathParts.length; i++) {
    const parent = pathParts.slice(0, i).join("/") || "/";
    const name = pathParts[i]!;
    const childPath = pathParts.slice(0, i + 1).join("/") || "/";
    const isDir = i < pathParts.length - 1;
    const existing = cache.get(parent) ?? [];
    if (existing.some((e) => e.path === childPath || e.name === name)) {
      // Keep going — deeper segments may still be missing.
      if (!cache.has(parent)) cache.set(parent, existing);
      continue;
    }
    const entry: DirEntry = {
      name,
      path: childPath,
      is_dir: isDir,
      is_markdown: !isDir && isMarkdown(name),
    };
    // Insert dirs first-ish, then sort like the backend (dirs, case-insensitive).
    const next = [...existing, entry].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    cache.set(parent, next);
  }
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
  /** Bumped on every `refresh()` so a slower in-flight refresh cannot emit after
   *  a newer one has already started (or finished). */
  let refreshGen = 0;

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
        let changed = false;
        if (activeFile !== null) {
          activeFile = null;
          changed = true;
        }
        // Drop selection only when it would point outside the tree.
        if (selected && (!root || !isUnder(root, selected))) {
          selected = null;
          changed = true;
        }
        if (changed) emit();
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
      // When list_dir hides dot entries, the open file (and any hidden
      // ancestor folders) will be missing from the cache. Inject them so the
      // tree can still expand and highlight the active document.
      ensurePathVisible(cache, root, path);
      persistExpanded(expanded);
      activeFile = path;
      selected = path;
      emit();
    },

    refresh: async () => {
      // Re-fetch the root and every expanded directory under it so the open
      // tree stays populated after an FS change or an explicit refresh.
      // (Previously only the root was reloaded, which left expanded subtrees
      // empty until the user collapsed/re-expanded.)
      //
      // Listings are staged into a local map and swapped in atomically so a
      // concurrent refresh cannot observe a half-cleared cache or keep a
      // stale listing written by an older in-flight call.
      const gen = ++refreshGen;
      if (!root) {
        if (gen !== refreshGen) return;
        cache.clear();
        emit();
        return;
      }
      const dirs: string[] = [root];
      for (const dir of expanded) {
        if (dir !== root && isUnder(root, dir)) dirs.push(dir);
      }
      const next = new Map<string, DirEntry[]>();
      for (const dir of dirs) {
        if (gen !== refreshGen) return;
        try {
          const listing = await deps.listDir(dir);
          next.set(dir, listing.entries);
        } catch (e) {
          console.error("list_dir failed:", e);
          next.set(dir, []);
        }
      }
      if (gen !== refreshGen) return;
      cache.clear();
      for (const [d, entries] of next) cache.set(d, entries);
      // Re-inject the active path chain after a refresh so a hidden open file
      // is not dropped when list_dir still omits dot entries.
      if (activeFile && root && isUnder(root, activeFile)) {
        ensurePathVisible(cache, root, activeFile);
      }
      emit();
    },
  };
}
