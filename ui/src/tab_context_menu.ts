// Pure builder for the per-tab right-click context menu. Kept in its own leaf
// module (type-only import of `MenuEntry`, no DOM/runtime imports) so it stays
// unit-testable under `node --test`, which cannot resolve the `.js` runtime
// imports in `tabbar.ts`. `tabbar.ts` re-exports `buildTabContextItems`.

import type { MenuEntry } from './menu.js';

/** Build the context-menu entries for a tab. */
export function buildTabContextItems(handlers: {
  onClose: () => void;
  onRevealInFolder?: () => void;
  onCopyPath?: () => void;
  /** Switch the sidebar workspace root to the document's git/worktree root. */
  onReRootToGit?: () => void;
  filePath?: string | null;
  /** Resolved git/worktree root for the tab's file, when known. */
  gitRoot?: string | null;
}): MenuEntry[] {
  const entries: MenuEntry[] = [];

  // File operations (only for doc tabs with a file path).
  if (handlers.filePath && handlers.onRevealInFolder) {
    entries.push({
      label: 'Reveal in Folder',
      icon: '📂',
      onSelect: handlers.onRevealInFolder,
    });
  }
  if (handlers.filePath && handlers.onCopyPath) {
    entries.push({
      label: 'Copy Path',
      icon: '📋',
      onSelect: handlers.onCopyPath,
    });
  }
  if (handlers.filePath && handlers.gitRoot && handlers.onReRootToGit) {
    entries.push({
      label: 'Re-root to git',
      icon: '🌲',
      onSelect: handlers.onReRootToGit,
    });
  }

  if (entries.length > 0) {
    entries.push({ type: 'separator' });
  }

  // Tab management.
  entries.push({ label: 'Close Tab', icon: '✕', onSelect: handlers.onClose });
  // Phase-2 affordance: disabled until cross-window handoff lands.
  entries.push({
    label: 'Move to New Window',
    icon: '⧉',
    onSelect: () => {},
    disabled: true,
  });

  return entries;
}
