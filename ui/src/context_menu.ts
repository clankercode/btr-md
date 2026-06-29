// A cursor-positioned popup context menu with theme support, icons, keyboard
// shortcut hints, and separator items. Positioned at viewport coordinates
// (position: fixed), dismisses on outside-click / Escape / scroll.

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Optional icon character (e.g. Unicode symbol or emoji). */
  icon?: string;
  /** Keyboard shortcut hint displayed on the right side. */
  shortcut?: string;
}

/** A visual separator between groups of menu items. */
export interface MenuSeparator {
  type: "separator";
}

export type MenuEntry = MenuItem | MenuSeparator;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return typeof entry === "object" && "type" in entry && entry.type === "separator";
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

/** Open a context menu at (x, y) with the given entries. */
export function openContextMenu(x: number, y: number, entries: MenuEntry[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "pmd-context-menu";
  menu.setAttribute("role", "menu");

  for (const entry of entries) {
    if (isSeparator(entry)) {
      const sep = document.createElement("div");
      sep.className = "pmd-context-menu-separator";
      sep.setAttribute("role", "separator");
      menu.appendChild(sep);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmd-context-menu-item";
    btn.setAttribute("role", "menuitem");

    if (entry.icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "pmd-context-menu-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.textContent = entry.icon;
      btn.appendChild(iconEl);
    }

    const labelEl = document.createElement("span");
    labelEl.className = "pmd-context-menu-label";
    labelEl.textContent = entry.label;
    btn.appendChild(labelEl);

    if (entry.shortcut) {
      const shortcutEl = document.createElement("span");
      shortcutEl.className = "pmd-context-menu-shortcut";
      shortcutEl.textContent = entry.shortcut;
      btn.appendChild(shortcutEl);
    }

    if (entry.disabled) {
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    } else {
      btn.addEventListener("click", () => {
        closeContextMenu();
        entry.onSelect();
      });
      // Hover highlight via mouse.
      btn.addEventListener("mouseenter", () => {
        menu.querySelectorAll(".pmd-context-menu-item[data-active]").forEach((el) => {
          el.removeAttribute("data-active");
        });
        btn.setAttribute("data-active", "");
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

  // Keyboard navigation: ArrowUp/Down cycles items, Enter activates.
  const getItems = () =>
    [...menu.querySelectorAll<HTMLButtonElement>(".pmd-context-menu-item:not([disabled])")];

  const keyHandler = (ev: KeyboardEvent): void => {
    const items = getItems();
    if (items.length === 0) return;
    const activeIdx = items.findIndex((el) => el.hasAttribute("data-active"));

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      const next = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
      items.forEach((el) => el.removeAttribute("data-active"));
      items[next].setAttribute("data-active", "");
      items[next].focus();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      const next = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
      items.forEach((el) => el.removeAttribute("data-active"));
      items[next].setAttribute("data-active", "");
      items[next].focus();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (activeIdx >= 0) items[activeIdx].click();
    }
  };

  const dismiss = (ev: Event): void => {
    if (ev.type === "mousedown" && menu.contains(ev.target as Node)) return;
    if (ev.type === "keydown") {
      const ke = ev as KeyboardEvent;
      if (ke.key === "Escape" || ke.key === "ArrowUp" || ke.key === "ArrowDown" || ke.key === "Enter") {
        if (ke.key !== "Escape") {
          keyHandler(ke);
          return;
        }
      } else {
        return;
      }
    }
    closeContextMenu();
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", dismiss, true);
    window.removeEventListener("scroll", dismiss, true);
  };
  window.addEventListener("mousedown", dismiss, true);
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("scroll", dismiss, true);
}
