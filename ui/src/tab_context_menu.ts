// Pure builder for the per-tab right-click context menu. Kept in its own leaf
// module (type-only import of `MenuItem`, no DOM/runtime imports) so it stays
// unit-testable under `node --test`, which cannot resolve the `.js` runtime
// imports in `tabbar.ts`. `tabbar.ts` re-exports `buildTabContextItems`.

import type { MenuItem } from './context_menu.js';

/** Build the context-menu items for a tab. `onClose` closes the right-clicked tab. */
export function buildTabContextItems(handlers: { onClose: () => void }): MenuItem[] {
  return [
    { label: 'Close Tab', onSelect: handlers.onClose },
    // Phase-2 affordance: disabled until cross-window handoff lands.
    { label: 'Move to New Window', onSelect: () => {}, disabled: true },
  ];
}
