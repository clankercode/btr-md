import type { ActionId, ActionRegistry, ActionSpec } from "./actions.ts";

export type ShortcutOverrides = Record<string, string[]>;

export interface ShortcutConflict {
  shortcut: string;
  actionIds: string[];
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_NAMES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
};

function normalizeKeyName(key: string): string {
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  if (key === "Plus" || key === "=") return "+";
  if (key === "Minus") return "-";
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isKeyboardEvent(value: KeyboardEvent | string): value is KeyboardEvent {
  return typeof value !== "string";
}

export function normalizeShortcut(eventOrString: KeyboardEvent | string): string {
  if (isKeyboardEvent(eventOrString)) {
    const event = eventOrString;
    if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "/" || event.key === "?")) {
      return "Ctrl+?";
    }
    const parts = [
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Meta" : "",
    ].filter(Boolean);
    const key = normalizeKeyName(event.key);
    if (!MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) {
      parts.push(event.ctrlKey && event.key === "/" ? "?" : key);
    }
    return parts.join("+");
  }

  const shortcutText = eventOrString.trim();
  const plusKey = shortcutText.endsWith("+");
  const rawParts = (plusKey ? shortcutText.slice(0, -1) : shortcutText)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (rawParts.length === 0 && !plusKey) return "";

  let key = plusKey ? "+" : "";
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  for (const part of rawParts) {
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
    else key = normalizeKeyName(part);
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].filter(Boolean).join("+");
}

function actionShortcutMap(actions: ActionSpec[], overrides: ShortcutOverrides): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const action of actions) {
    const shortcuts = overrides[action.id] ?? action.defaultShortcuts;
    for (const shortcut of shortcuts.map(normalizeShortcut).filter(Boolean)) {
      const actionIds = owners.get(shortcut) ?? [];
      actionIds.push(action.id);
      owners.set(shortcut, actionIds);
    }
  }
  return owners;
}

function conflictsFromOwners(owners: Map<string, string[]>): ShortcutConflict[] {
  return [...owners.entries()]
    .filter(([, actionIds]) => actionIds.length > 1)
    .map(([shortcut, actionIds]) => ({ shortcut, actionIds: [...actionIds].sort() }))
    .sort((a, b) => a.shortcut.localeCompare(b.shortcut));
}

export function findDefaultShortcutConflicts(actions: ActionSpec[]): ShortcutConflict[] {
  return conflictsFromOwners(actionShortcutMap(actions, {}));
}

export function mergeShortcutOverrides(
  actions: ActionSpec[],
  overrides: ShortcutOverrides
): ShortcutOverrides {
  const validIds = new Set(actions.map((action) => action.id));
  const merged: ShortcutOverrides = {};
  for (const action of actions) {
    merged[action.id] = [...action.defaultShortcuts];
  }
  for (const [actionId, shortcuts] of Object.entries(overrides)) {
    if (!validIds.has(actionId as ActionId)) continue;
    merged[actionId] = shortcuts.map(normalizeShortcut).filter(Boolean);
  }
  return merged;
}

export function findUserShortcutConflicts(
  actions: ActionSpec[],
  overrides: ShortcutOverrides,
  enabledActionIds: Set<ActionId>
): ShortcutConflict[] {
  const enabledActions = actions.filter((action) => enabledActionIds.has(action.id));
  return conflictsFromOwners(actionShortcutMap(enabledActions, overrides));
}

export function restoreAllShortcutDefaults(_overrides: ShortcutOverrides): ShortcutOverrides {
  return {};
}

export function installActionHotkeys(options: {
  actions: ActionSpec[];
  registry: ActionRegistry;
  getOverrides: () => ShortcutOverrides;
  isEnabled: (id: ActionId) => boolean;
}): () => void {
  const handler = (event: KeyboardEvent): void => {
    const shortcut = normalizeShortcut(event);
    const bindings = mergeShortcutOverrides(options.actions, options.getOverrides());
    const match = Object.entries(bindings).find(
      ([actionId, shortcuts]) =>
        options.isEnabled(actionId as ActionId) &&
        shortcuts.map(normalizeShortcut).includes(shortcut)
    );
    if (!match) return;
    event.preventDefault();
    void options.registry.runAction(match[0] as ActionId);
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
