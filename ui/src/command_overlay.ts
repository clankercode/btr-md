import type { ActionId, ActionRegistry, ActionSpec } from "./actions.ts";
import { searchActions } from "./actions.ts";

export interface CommandOverlayController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  element: HTMLElement;
}

export function createCommandOverlay(
  actions: ActionSpec[],
  registry: ActionRegistry,
  options: { isVisible: (id: ActionId) => boolean }
): CommandOverlayController {
  let previouslyFocused: HTMLElement | null = null;
  const dialog = document.createElement("div");
  dialog.className = "pmd-command-overlay";
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Command overlay");
  dialog.setAttribute("aria-hidden", "true");
  dialog.hidden = true;

  const input = document.createElement("input");
  input.className = "pmd-command-overlay-search";
  input.type = "search";
  input.setAttribute("aria-label", "Search commands");
  const list = document.createElement("div");
  list.className = "pmd-command-overlay-list";
  list.setAttribute("role", "listbox");
  dialog.append(input, list);

  function render(): void {
    const visible = searchActions(actions, input.value).filter((action) => options.isVisible(action.id));
    list.replaceChildren(
      ...visible.map((action) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "pmd-command-row";
        row.setAttribute("role", "option");
        row.dataset.actionId = action.id;
        row.textContent = `${action.label} ${action.category}`;
        row.addEventListener("click", async () => {
          controller.close();
          await registry.runAction(action.id);
        });
        return row;
      })
    );
  }

  input.addEventListener("input", render);
  dialog.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
    }
    if (event.key === "Enter") {
      const first = list.querySelector<HTMLButtonElement>(".pmd-command-row");
      if (first?.dataset.actionId) {
        event.preventDefault();
        controller.close();
        await registry.runAction(first.dataset.actionId as ActionId);
      }
    }
  });

  const controller: CommandOverlayController = {
    element: dialog,
    isOpen: () => !dialog.hidden,
    open: () => {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.hidden = false;
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-hidden", "false");
      input.value = "";
      render();
      input.focus();
    },
    close: () => {
      dialog.hidden = true;
      dialog.setAttribute("aria-hidden", "true");
      dialog.removeAttribute("role");
      previouslyFocused?.focus();
    },
  };
  return controller;
}
