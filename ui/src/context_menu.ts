// A small cursor-positioned popup menu. Reuses `.pmd-dropdown-menu` styling but
// is positioned at viewport coordinates (position: fixed) rather than relative
// to a trigger, and dismisses on outside-click / Escape / scroll. Mirrors the
// preventDefault pattern used by link_activation for contextmenu events.

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export function clampMenuPosition(
  at: { x: number; y: number },
  menu: { w: number; h: number },
  viewport: { w: number; h: number }
): { left: number; top: number } {
  const left = Math.max(0, Math.min(at.x, viewport.w - menu.w));
  const top = Math.max(0, Math.min(at.y, viewport.h - menu.h));
  return { left, top };
}

let openMenuEl: HTMLElement | null = null;

/** Close any open context menu. Safe to call when none is open. */
export function closeContextMenu(): void {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

/** Open a context menu at (x, y) with the given items. */
export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "pmd-dropdown-menu pmd-context-menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmd-dropdown-item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        closeContextMenu();
        item.onSelect();
      });
    }
    menu.appendChild(btn);
  }
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

  const dismiss = (ev: Event) => {
    if (ev.type === "mousedown" && menu.contains(ev.target as Node)) return;
    if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Escape") return;
    closeContextMenu();
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", dismiss, true);
    window.removeEventListener("scroll", dismiss, true);
  };
  window.addEventListener("mousedown", dismiss, true);
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("scroll", dismiss, true);
}
