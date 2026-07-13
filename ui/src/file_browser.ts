import type { WorkspaceModel } from "./workspace.js";
import { openContextMenu } from "./context_menu.js";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_markdown: boolean;
}

export interface DirListing {
  dir: string;
  entries: DirEntry[];
}

export interface FileBrowserDeps {
  model: WorkspaceModel;
  /** Single-click markdown files as a replaceable preview tab (sidebar only). */
  openOnSingleClick?: boolean;
  /** OS folder picker; resolves to the chosen canonical dir or null. */
  pickBaseDir: () => Promise<string | null>;
  /** Open a file. `background` => open without switching, then highlight. */
  onOpenFile: (
    path: string,
    opts: { background: boolean; pinned?: boolean; replacePreview?: boolean },
  ) => void;
  /** Set the workspace root to a folder already within a grant; resolves false
   *  if rejected (caller then falls back to the picker). */
  setRoot: (path: string) => Promise<boolean>;
  /** Reveal a folder in the OS file manager. */
  revealInFolder: (path: string) => void;
  /** Rename a file to `newName` (kept in the same directory); resolves the new
   *  canonical path. Rejects if the target exists or escapes the granted scope. */
  renameFile: (path: string, newName: string) => Promise<string>;
}

export interface FileBrowserInstance {
  el: HTMLElement;
  refresh: () => void;
}

export function createFileBrowser(deps: FileBrowserDeps): FileBrowserInstance {
  const { model } = deps;
  const el = document.createElement("div");
  el.className = "pmd-browser";

  // Row + entry lookups, rebuilt on every *structural* render. Selection and
  // active-file changes are applied in place (no rebuild) so the tree never
  // jumps to the top mid-interaction and a double-click is not eaten by the
  // clicked row being replaced between its two clicks (see `onModelChange`).
  let rows = new Map<string, HTMLElement>();
  let entryByPath = new Map<string, DirEntry>();
  let lastStructureKey = "";
  /** True while an inline rename input is open; suppresses re-renders that
   *  would otherwise discard the in-progress edit. */
  let renaming = false;

  /** A signature of everything that affects tree *structure* (root, expansion,
   *  loaded entry names) but NOT selection/active-file. When unchanged we only
   *  repaint highlights instead of rebuilding the DOM. */
  function structureKey(): string {
    const root = model.root();
    if (!root) return "<none>";
    const parts: string[] = [];
    const walk = (dir: string): void => {
      const entries = model.entriesOf(dir);
      if (!entries) {
        parts.push(`${dir}?`);
        return;
      }
      parts.push(`${dir}:${entries.map((e) => e.name + (e.is_dir ? "/" : "")).join(",")}`);
      for (const e of entries) {
        if (e.is_dir && model.expanded().has(e.path)) walk(e.path);
      }
    };
    walk(root);
    return parts.join("\n");
  }

  /** Repaint selected / active-file highlight classes on the existing rows. */
  function applyHighlight(): void {
    const sel = model.selected();
    const active = model.activeFile();
    for (const [path, row] of rows) {
      const isSel = path === sel;
      row.classList.toggle("selected", isSel);
      row.setAttribute("aria-selected", String(isSel));
      row.classList.toggle("pmd-browser-active", path === active);
    }
    scrollActiveIntoView();
  }

  /** Keep the active document row visible after tab switches / re-root. */
  function scrollActiveIntoView(): void {
    const active = model.activeFile();
    if (!active) return;
    const row = rows.get(active);
    if (!row) return;
    // nearest avoids yanking the tree when the row is already on-screen.
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function activateRow(entry: DirEntry, background: boolean): Promise<void> {
    if (entry.is_dir) {
      await model.toggleDir(entry.path);
      return;
    }
    model.select(entry.path);
    if (entry.is_markdown) deps.onOpenFile(entry.path, { background });
  }

  async function handleTreeKeydown(event: KeyboardEvent, entry: DirEntry): Promise<void> {
    if (event.key === "F2" && !entry.is_dir && !renaming) {
      event.preventDefault();
      event.stopPropagation();
      beginRename(entry);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      await activateRow(entry, event.shiftKey);
      return;
    }
    if (!entry.is_dir) return;
    if (event.key === "ArrowRight" && !model.expanded().has(entry.path)) {
      event.preventDefault();
      await model.expand(entry.path);
    } else if (event.key === "ArrowLeft" && model.expanded().has(entry.path)) {
      event.preventDefault();
      model.collapse(entry.path);
    }
  }

  function renderRow(entry: DirEntry, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "pmd-browser-row";
    row.style.paddingLeft = `${8 + depth * 16}px`;
    row.dataset.path = entry.path;
    row.title = entry.path;
    row.tabIndex = 0;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-label", entry.name);
    if (entry.is_dir) row.setAttribute("aria-expanded", String(model.expanded().has(entry.path)));
    if (entry.path === model.selected()) {
      row.classList.add("selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    if (entry.path === model.activeFile()) row.classList.add("pmd-browser-active");
    if (!entry.is_dir && !entry.is_markdown) row.classList.add("pmd-browser-nonmd");
    rows.set(entry.path, row);
    entryByPath.set(entry.path, entry);

    const twisty = document.createElement("span");
    twisty.className = "pmd-browser-twisty";
    twisty.setAttribute("aria-hidden", "true");
    twisty.textContent = entry.is_dir ? (model.expanded().has(entry.path) ? "▾" : "▸") : "";
    row.appendChild(twisty);

    const icon = document.createElement("span");
    icon.className = "pmd-browser-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = entry.is_dir ? "🗀" : "🗎";
    row.appendChild(icon);

    const name = document.createElement("span");
    name.className = "pmd-browser-name pmd-truncate";
    name.textContent = entry.name;
    name.title = entry.path;
    row.appendChild(name);

    if (entry.is_dir) {
      row.addEventListener("click", () => {
        // Select first (in-place highlight), then expand/collapse.
        model.select(entry.path);
        void model.toggleDir(entry.path);
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          {
            label: "Set as workspace root",
            onSelect: async () => {
              if (!(await deps.setRoot(entry.path))) {
                const picked = await deps.pickBaseDir();
                if (picked) await deps.setRoot(picked);
              }
            },
          },
          { label: "Reveal in file manager", onSelect: () => deps.revealInFolder(entry.path) },
        ]);
      });
    } else {
      row.addEventListener("click", () => {
        model.select(entry.path);
        if (deps.openOnSingleClick && entry.is_markdown) {
          deps.onOpenFile(entry.path, {
            background: false,
            pinned: false,
            replacePreview: true,
          });
        }
      });
      row.addEventListener("dblclick", (e) => {
        if (!entry.is_markdown) return;
        deps.onOpenFile(entry.path, { background: e.shiftKey, pinned: true });
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        model.select(entry.path);
        openContextMenu(e.clientX, e.clientY, [
          { label: "Rename… (F2)", onSelect: () => beginRename(entry) },
          { label: "Reveal in file manager", onSelect: () => deps.revealInFolder(entry.path) },
        ]);
      });
    }
    row.addEventListener("keydown", (event) => { void handleTreeKeydown(event, entry); });
    return row;
  }

  /** Replace a row's name label with an inline edit box; commit on Enter/blur,
   *  cancel on Escape. The path is unchanged — only the basename is edited. */
  function beginRename(entry: DirEntry): void {
    const row = rows.get(entry.path);
    const nameEl = row?.querySelector<HTMLElement>(".pmd-browser-name");
    if (!row || !nameEl || renaming) return;
    renaming = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pmd-browser-rename";
    input.value = entry.name;
    input.setAttribute("aria-label", "New file name");
    nameEl.replaceWith(input);
    input.focus();
    // Preselect the stem (before the final dot) so the extension is kept.
    const dot = entry.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);

    let settled = false;
    const commit = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const newName = input.value.trim();
      renaming = false;
      if (!newName || newName === entry.name) {
        render();
        return;
      }
      try {
        const newPath = await deps.renameFile(entry.path, newName);
        await model.refresh();
        model.select(newPath);
      } catch (e) {
        console.error("rename failed:", e);
        render();
      }
    };
    const cancel = (): void => {
      if (settled) return;
      settled = true;
      renaming = false;
      render();
    };

    input.addEventListener("keydown", (e) => {
      // Keep tree-nav keybindings on the parent row from firing while editing.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => void commit());
  }

  function renderEntries(dir: string, depth: number, into: HTMLElement): void {
    const entries = model.entriesOf(dir);
    if (!entries) return;
    for (const entry of entries) {
      into.appendChild(renderRow(entry, depth));
      if (entry.is_dir && model.expanded().has(entry.path)) {
        renderEntries(entry.path, depth + 1, into);
      }
    }
  }

  async function chooseFolder(): Promise<void> {
    try {
      const picked = await deps.pickBaseDir();
      if (!picked) return;
      await deps.setRoot(picked);
    } catch (e) {
      console.error("pick_base_dir failed:", e);
    }
  }

  function renderChooser(): void {
    const wrap = document.createElement("div");
    wrap.className = "pmd-browser-empty";
    const msg = document.createElement("p");
    msg.textContent = "No folder selected.";
    const btn = document.createElement("button");
    btn.className = "pmd-btn pmd-btn-primary";
    btn.type = "button";
    btn.textContent = "Choose folder…";
    btn.addEventListener("click", () => chooseFolder());
    wrap.appendChild(msg);
    wrap.appendChild(btn);
    el.appendChild(wrap);
  }

  function renderHeader(dir: string): void {
    const header = document.createElement("div");
    header.className = "pmd-browser-header";

    const up = document.createElement("button");
    up.className = "pmd-btn pmd-btn-ghost pmd-btn-sm";
    up.type = "button";
    up.textContent = "↑";
    up.title = "Go up to the parent folder (within the granted folder)";
    up.setAttribute("aria-label", "Go up to parent folder");
    up.addEventListener("click", async () => {
      const { parentOf } = await import("./workspace.js");
      const parent = parentOf(dir);
      // Navigate up only within an already-granted folder. Going above every
      // grant is rejected by the backend; we stay put rather than popping the
      // OS picker — granting a new folder is the "Change…" button's job.
      if (parent) await deps.setRoot(parent);
    });
    header.appendChild(up);

    const path = document.createElement("span");
    path.className = "pmd-browser-base pmd-truncate";
    path.textContent = dir;
    path.title = dir;
    header.appendChild(path);

    const change = document.createElement("button");
    change.className = "pmd-btn pmd-btn-ghost pmd-btn-sm";
    change.type = "button";
    change.textContent = "Change…";
    change.title = "Choose a different folder";
    change.addEventListener("click", () => chooseFolder());
    header.appendChild(change);

    el.appendChild(header);
  }

  function render(): void {
    rows = new Map();
    entryByPath = new Map();
    el.replaceChildren();
    const root = model.root();
    if (!root) {
      renderChooser();
      lastStructureKey = structureKey();
      return;
    }
    renderHeader(root);
    const tree = document.createElement("div");
    tree.className = "pmd-browser-tree";
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "File browser");
    renderEntries(root, 0, tree);
    el.appendChild(tree);
    lastStructureKey = structureKey();
    scrollActiveIntoView();
  }

  function onModelChange(): void {
    // An open rename owns the DOM; skip the repaint so the edit box (and the
    // select() that focusing it triggers) survives until commit/cancel.
    if (renaming) return;
    const key = structureKey();
    if (key === lastStructureKey && rows.size > 0) {
      applyHighlight();
      return;
    }
    render();
  }

  model.onChange(onModelChange);
  render();

  return { el, refresh: () => model.refresh() };
}
