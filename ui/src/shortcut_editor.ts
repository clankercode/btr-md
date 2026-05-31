import type { ActionId, ActionSpec } from "./actions.ts";
import {
  findUserShortcutConflicts,
  normalizeShortcut,
  restoreAllShortcutDefaults,
} from "./keybindings.ts";

export type ShortcutOverrides = Record<string, string[]>;

export interface ShortcutEditorController {
  open(): void;
  close(): void;
  element: HTMLElement;
}

export function createShortcutEditor(options: {
  actions: ActionSpec[];
  loadOverrides: () => ShortcutOverrides;
  saveOverrides: (overrides: ShortcutOverrides) => Promise<void>;
  enabledActionIds: () => Set<ActionId>;
}): ShortcutEditorController {
  let previouslyFocused: HTMLElement | null = null;
  let draft: ShortcutOverrides = {};
  const dialog = document.createElement("div");
  dialog.className = "pmd-shortcut-editor";
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Keyboard shortcuts");
  dialog.setAttribute("aria-hidden", "true");
  dialog.hidden = true;
  const list = document.createElement("div");
  list.className = "pmd-shortcut-editor-list";
  const error = document.createElement("p");
  error.className = "pmd-shortcut-editor-error";
  error.setAttribute("role", "alert");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  const restoreAll = document.createElement("button");
  restoreAll.type = "button";
  restoreAll.textContent = "Restore All";
  restoreAll.setAttribute("aria-label", "Restore all default shortcuts");
  dialog.append(list, error, restoreAll, save);

  function rowFor(action: ActionSpec): HTMLElement {
    const row = document.createElement("section");
    row.className = "pmd-shortcut-row";
    row.dataset.actionId = action.id;
    const label = document.createElement("h3");
    label.textContent = action.label;
    const input = document.createElement("input");
    input.value = (draft[action.id] ?? action.defaultShortcuts).join(", ");
    input.setAttribute("aria-label", `${action.label} shortcuts`);
    input.addEventListener("change", () => {
      draft[action.id] = input.value
        .split(",")
        .map((part) => normalizeShortcut(part.trim()))
        .filter(Boolean);
      render();
    });
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => {
      delete draft[action.id];
      render();
    });
    row.append(label, input, restore);
    return row;
  }

  function render(): void {
    list.replaceChildren(...options.actions.map((action) => rowFor(action)));
    const conflicts = findUserShortcutConflicts(options.actions, draft, options.enabledActionIds());
    error.textContent = conflicts.length ? `Shortcut conflict: ${conflicts[0].shortcut}` : "";
    save.disabled = conflicts.length > 0;
  }

  save.addEventListener("click", async () => {
    await options.saveOverrides(draft);
    controller.close();
  });

  restoreAll.addEventListener("click", () => {
    draft = restoreAllShortcutDefaults(draft);
    render();
  });

  const controller: ShortcutEditorController = {
    element: dialog,
    open: () => {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      draft = structuredClone(options.loadOverrides());
      dialog.hidden = false;
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-hidden", "false");
      render();
      dialog.querySelector<HTMLInputElement>("input")?.focus();
    },
    close: () => {
      dialog.hidden = true;
      dialog.setAttribute("aria-hidden", "true");
      dialog.removeAttribute("role");
      previouslyFocused?.focus();
    },
  };
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
    }
  });
  return controller;
}
