/**
 * Pure path display helpers for the top-bar label (and unit tests).
 * Kept free of DOM / menu imports so `node --test` can load this module alone.
 */

/**
 * Abbreviate a file path by shortening each directory component to its first
 * character, except for dot-prefixed dirs (like `.worktrees`) which get the
 * first two characters. The filename itself is always shown in full.
 *
 * Examples:
 *   ~/src/preview-md/.worktrees/feature/foo.md → ~/s/p/.w/f/foo.md
 *   /home/user/documents/report.md → /h/u/d/report.md
 */
export function abbreviatePath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash < 0) return path;
  const dir = path.slice(0, lastSlash);
  const file = path.slice(lastSlash + 1);
  const parts = dir.split('/');
  const abbreviated = parts.map((part) => {
    if (!part) return '';
    // Dot-prefixed dirs: keep first two chars (e.g. .w for .worktrees).
    if (part.startsWith('.')) return part.slice(0, 2);
    return part[0];
  });
  return abbreviated.join('/') + '/' + file;
}

/** Format a path for the top-bar label: full or compressed. */
export function formatPathDisplay(path: string, showFull: boolean): string {
  return showFull ? path : abbreviatePath(path);
}
