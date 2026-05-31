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
