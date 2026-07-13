// Cursor-positioned popup context menu. Thin wrapper over the shared menu
// primitive (`menu.ts`): fixed positioning, viewport clamping, and dismiss on
// outside-click / Escape / scroll. Item structure, hover highlight, and
// keyboard navigation live in the shared module.

import {
  type MenuEntry,
  type MenuItem,
  type MenuSeparator,
  MenuClass,
  appendMenuEntries,
  attachMenuHoverHighlight,
  clampMenuPosition,
  handleMenuKeydown,
  isSeparator,
} from "./menu.js";

export type { MenuEntry, MenuItem, MenuSeparator };
export { clampMenuPosition, isSeparator };

let openMenuEl: HTMLElement | null = null;
let dismissCleanup: (() => void) | null = null;

/** Close any open context menu. Safe to call when none is open. */
export function closeContextMenu(): void {
  if (dismissCleanup) {
    dismissCleanup();
    dismissCleanup = null;
  }
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

/** Open a context menu at (x, y) with the given entries. */
export function openContextMenu(x: number, y: number, entries: MenuEntry[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = MenuClass.context;
  menu.setAttribute("role", "menu");

  appendMenuEntries(menu, entries, {
    variant: "context",
    itemAs: "button",
    separatorAs: "div",
    beforeSelect: () => closeContextMenu(),
  });
  attachMenuHoverHighlight(menu);

  // Measure off-screen first, then clamp into the viewport.
  menu.style.position = "fixed";
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const { left, top } = clampMenuPosition(
    { x, y },
    { w: rect.width, h: rect.height },
    { w: window.innerWidth, h: window.innerHeight }
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";
  openMenuEl = menu;

  const dismiss = (ev: Event): void => {
    if (ev.type === "mousedown" && menu.contains(ev.target as Node)) return;
    if (ev.type === "keydown") {
      const ke = ev as KeyboardEvent;
      if (ke.key === "Escape") {
        // fall through to close
      } else if (handleMenuKeydown(menu, ke)) {
        ke.preventDefault();
        return;
      } else {
        return;
      }
    }
    closeContextMenu();
  };

  window.addEventListener("mousedown", dismiss, true);
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("scroll", dismiss, true);
  dismissCleanup = () => {
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", dismiss, true);
    window.removeEventListener("scroll", dismiss, true);
  };
}
