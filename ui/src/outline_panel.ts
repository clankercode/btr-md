import type { HeadingFact } from "./document_contracts.js";

export type OutlineMode = "collapsed" | "overlay" | "docked";

export interface OutlinePanel {
  element: HTMLElement;
  setHeadings(headings: HeadingFact[]): void;
  setMode(mode: OutlineMode): void;
  setFilter(query: string): void;
  setActiveBlock(blockId: string | null): void;
  focusSearch(): void;
  destroy(): void;
}

export function createOutlinePanel(options: {
  onJump(blockId: string): void;
  restoreFocus(): void;
}): OutlinePanel {
  const element = document.createElement("aside");
  element.className = "pmd-outline-panel";
  element.dataset.panel = "outline";
  let headings: HeadingFact[] = [];
  let filter = "";
  let mode: OutlineMode = "collapsed";
  let activeBlockId: string | null = null;
  let focusedIndex = 0;

  function visibleHeadings() {
    const needle = filter.trim().toLowerCase();
    return needle.length === 0
      ? headings
      : headings.filter((heading) => heading.text.toLowerCase().includes(needle));
  }

  function applyModeAttributes() {
    if (mode === "overlay") {
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-label", "Outline");
      element.setAttribute("aria-modal", "false");
    } else {
      element.setAttribute("role", "navigation");
      element.setAttribute("aria-label", "Document outline");
      element.removeAttribute("aria-modal");
    }
  }

  function focusTreeItem(index: number) {
    const items = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'));
    if (items.length === 0) return;
    focusedIndex = Math.max(0, Math.min(index, items.length - 1));
    items[focusedIndex].focus();
  }

  function activate(heading: HeadingFact) {
    activeBlockId = heading.block_id;
    options.onJump(heading.block_id);
    render();
    focusTreeItem(visibleHeadings().findIndex((item) => item.block_id === heading.block_id));
  }

  function closeOverlayIfNeeded() {
    if (mode !== "overlay") return;
    mode = "collapsed";
    render();
    options.restoreFocus();
  }

  function onTreeKeydown(event: KeyboardEvent, visible: HeadingFact[]) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusTreeItem(focusedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusTreeItem(focusedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTreeItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTreeItem(visible.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const heading = visible[focusedIndex];
      if (heading) activate(heading);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeOverlayIfNeeded();
    }
  }

  function render() {
    applyModeAttributes();
    element.hidden = mode === "collapsed";
    element.innerHTML = "";

    const label = document.createElement("label");
    label.className = "pmd-sr-only";
    label.htmlFor = "pmd-outline-filter";
    label.textContent = "Filter headings";

    const search = document.createElement("input");
    search.id = "pmd-outline-filter";
    search.className = "pmd-outline-search";
    search.type = "search";
    search.setAttribute("aria-label", "Filter headings");
    search.value = filter;
    search.addEventListener("input", () => {
      filter = search.value;
      focusedIndex = 0;
      render();
      element.querySelector<HTMLInputElement>("#pmd-outline-filter")?.focus();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlayIfNeeded();
      }
    });

    const tree = document.createElement("div");
    tree.className = "pmd-outline-tree";
    tree.setAttribute("role", "tree");
    tree.tabIndex = 0;
    const visible = visibleHeadings();
    tree.addEventListener("keydown", (event) => onTreeKeydown(event, visible));
    visible.forEach((heading, index) => {
      const item = document.createElement("button");
      item.className = "pmd-outline-item";
      item.type = "button";
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(heading.level));
      item.setAttribute("aria-selected", heading.block_id === activeBlockId ? "true" : "false");
      item.tabIndex = index === focusedIndex ? 0 : -1;
      item.dataset.blockId = heading.block_id;
      item.style.setProperty("--pmd-outline-level", String(Math.max(1, heading.level)));
      item.textContent = heading.text;
      item.addEventListener("focus", () => {
        focusedIndex = index;
      });
      item.addEventListener("click", () => activate(heading));
      tree.append(item);
    });
    element.append(label, search, tree);
  }

  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeOverlayIfNeeded();
  });

  render();

  return {
    element,
    setHeadings(next) {
      headings = next;
      focusedIndex = Math.min(focusedIndex, Math.max(0, headings.length - 1));
      render();
    },
    setMode(next) {
      mode = next;
      render();
    },
    setFilter(next) {
      filter = next;
      focusedIndex = 0;
      render();
    },
    setActiveBlock(blockId) {
      if (activeBlockId === blockId) return;
      activeBlockId = blockId;
      render();
    },
    focusSearch() {
      element.querySelector<HTMLInputElement>("#pmd-outline-filter")?.focus();
    },
    destroy() {
      element.remove();
    },
  };
}
