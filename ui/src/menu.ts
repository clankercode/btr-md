// Shared menu primitive for toolbar dropdowns and cursor-positioned context
// menus. Owns types, DOM builders, highlight helpers, and keyboard navigation
// so hover/focus/disabled behaviour stays consistent (DRY).

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

/** Canonical class names. Surfaces keep variant classes for layout; items share
 *  `.pmd-menu-item` so hover/focus CSS is defined once. */
export const MenuClass = {
  surface: "pmd-menu",
  dropdown: "pmd-dropdown-menu pmd-menu",
  context: "pmd-context-menu pmd-menu",
  item: "pmd-menu-item",
  dropdownItem: "pmd-dropdown-item pmd-menu-item",
  contextItem: "pmd-context-menu-item pmd-menu-item",
  icon: "pmd-menu-icon",
  label: "pmd-menu-label",
  shortcut: "pmd-menu-shortcut",
  separator: "pmd-menu-separator",
  dropdownSeparator: "pmd-dropdown-divider pmd-menu-separator",
  contextSeparator: "pmd-context-menu-separator pmd-menu-separator",
  sectionLabel: "pmd-dropdown-label",
} as const;

/** Matches any menu item element created by this module or legacy markup. */
export const MENU_ITEM_SELECTOR =
  ".pmd-menu-item, .pmd-dropdown-item, .pmd-context-menu-item";

/** Canonical keyboard/hover highlight attribute (style-guide: data-highlighted). */
export const MENU_HIGHLIGHT_ATTR = "data-highlighted";

/** Pure: next enabled-item index for ArrowUp/ArrowDown cycling. */
export function nextMenuIndex(current: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : length - 1;
  return (current + dir + length) % length;
}

export function isMenuItemDisabled(el: Element): boolean {
  if (el.hasAttribute("data-disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  return false;
}

export function clearMenuHighlight(root: ParentNode): void {
  root.querySelectorAll(`[${MENU_HIGHLIGHT_ATTR}]`).forEach((el) => {
    el.removeAttribute(MENU_HIGHLIGHT_ATTR);
  });
  // Legacy context-menu attribute (pre-unification).
  root.querySelectorAll("[data-active]").forEach((el) => {
    el.removeAttribute("data-active");
  });
}

export function setMenuHighlight(root: ParentNode, item: Element): void {
  clearMenuHighlight(root);
  item.setAttribute(MENU_HIGHLIGHT_ATTR, "");
}

export function getEnabledMenuItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
    (el) => !isMenuItemDisabled(el)
  );
}

export function highlightedMenuIndex(items: readonly Element[]): number {
  return items.findIndex(
    (el) => el.hasAttribute(MENU_HIGHLIGHT_ATTR) || el.hasAttribute("data-active")
  );
}

export type MenuVariant = "dropdown" | "context";

export interface CreateMenuItemOptions {
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Element tag. Prefer `button` for a11y; `li` for ul-based dropdown lists. */
  as?: "button" | "li";
  variant?: MenuVariant;
  onSelect?: () => void;
  /** Invoked before onSelect (e.g. close the open menu). */
  beforeSelect?: () => void;
}

/** Build a single menu item with shared structure (icon / label / shortcut). */
export function createMenuItem(opts: CreateMenuItemOptions): HTMLElement {
  const as = opts.as ?? "button";
  const variant = opts.variant ?? "dropdown";
  const el = document.createElement(as);
  if (as === "button") {
    (el as HTMLButtonElement).type = "button";
  }
  el.className = variant === "context" ? MenuClass.contextItem : MenuClass.dropdownItem;
  el.setAttribute("role", "menuitem");

  if (opts.icon) {
    const iconEl = document.createElement("span");
    iconEl.className = MenuClass.icon;
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = opts.icon;
    el.appendChild(iconEl);
  }

  const labelEl = document.createElement("span");
  labelEl.className = MenuClass.label;
  labelEl.textContent = opts.label;
  el.appendChild(labelEl);

  if (opts.shortcut) {
    const shortcutEl = document.createElement("span");
    shortcutEl.className = MenuClass.shortcut;
    shortcutEl.textContent = opts.shortcut;
    el.appendChild(shortcutEl);
  }

  if (opts.disabled) {
    if (as === "button") {
      (el as HTMLButtonElement).disabled = true;
    }
    el.setAttribute("aria-disabled", "true");
    el.setAttribute("data-disabled", "");
  } else if (opts.onSelect) {
    el.addEventListener("click", () => {
      if (isMenuItemDisabled(el)) return;
      opts.beforeSelect?.();
      opts.onSelect!();
    });
  }

  return el;
}

export interface CreateMenuSeparatorOptions {
  variant?: MenuVariant;
  as?: "div" | "li";
}

export function createMenuSeparator(opts: CreateMenuSeparatorOptions = {}): HTMLElement {
  const variant = opts.variant ?? "dropdown";
  const as = opts.as ?? (variant === "dropdown" ? "li" : "div");
  const el = document.createElement(as);
  el.className =
    variant === "context" ? MenuClass.contextSeparator : MenuClass.dropdownSeparator;
  el.setAttribute("role", "separator");
  return el;
}

export interface AppendMenuEntriesOptions {
  variant: MenuVariant;
  itemAs?: "button" | "li";
  separatorAs?: "div" | "li";
  beforeSelect?: () => void;
}

/** Append MenuEntry[] into a menu root; returns the interactive item elements. */
export function appendMenuEntries(
  menu: HTMLElement,
  entries: readonly MenuEntry[],
  opts: AppendMenuEntriesOptions
): HTMLElement[] {
  const items: HTMLElement[] = [];
  const itemAs = opts.itemAs ?? (opts.variant === "context" ? "button" : "li");
  for (const entry of entries) {
    if (isSeparator(entry)) {
      menu.appendChild(
        createMenuSeparator({
          variant: opts.variant,
          as: opts.separatorAs ?? (itemAs === "li" ? "li" : "div"),
        })
      );
      continue;
    }
    const el = createMenuItem({
      label: entry.label,
      icon: entry.icon,
      shortcut: entry.shortcut,
      disabled: entry.disabled,
      as: itemAs,
      variant: opts.variant,
      onSelect: entry.onSelect,
      beforeSelect: opts.beforeSelect,
    });
    menu.appendChild(el);
    items.push(el);
  }
  return items;
}

/** Hover moves the shared highlight; leaves clear it. */
export function attachMenuHoverHighlight(menu: HTMLElement): void {
  menu.addEventListener("mouseover", (ev) => {
    const target = (ev.target as Element | null)?.closest?.(MENU_ITEM_SELECTOR);
    if (!target || !menu.contains(target)) return;
    if (isMenuItemDisabled(target)) {
      clearMenuHighlight(menu);
      return;
    }
    setMenuHighlight(menu, target);
  });
  menu.addEventListener("mouseleave", () => {
    clearMenuHighlight(menu);
  });
}

/**
 * Handle ArrowUp/Down/Enter for a menu. Returns true when the event was
 * consumed (caller should preventDefault / stop dismiss for those keys).
 */
export function handleMenuKeydown(menu: HTMLElement, ev: KeyboardEvent): boolean {
  const items = getEnabledMenuItems(menu);
  if (items.length === 0) return false;
  const activeIdx = highlightedMenuIndex(items);

  if (ev.key === "ArrowDown") {
    const next = nextMenuIndex(activeIdx, items.length, 1);
    if (next >= 0) {
      setMenuHighlight(menu, items[next]);
      items[next].focus?.();
    }
    return true;
  }
  if (ev.key === "ArrowUp") {
    const next = nextMenuIndex(activeIdx, items.length, -1);
    if (next >= 0) {
      setMenuHighlight(menu, items[next]);
      items[next].focus?.();
    }
    return true;
  }
  if (ev.key === "Enter") {
    if (activeIdx >= 0) {
      items[activeIdx].click();
      return true;
    }
    return false;
  }
  return false;
}
