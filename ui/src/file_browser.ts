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
  /** OS folder picker; resolves to the chosen canonical dir or null. */
  pickBaseDir: () => Promise<string | null>;
  /** Open a file. `background` => open without switching, then highlight. */
  onOpenFile: (path: string, opts: { background: boolean }) => void;
  /** Set the workspace root to a folder already within a grant; resolves false
   *  if rejected (caller then falls back to the picker). */
  setRoot: (path: string) => Promise<boolean>;
  /** Reveal a folder in the OS file manager. */
  revealInFolder: (path: string) => void;
}

export interface FileBrowserInstance {
  el: HTMLElement;
  refresh: () => void;
}

export function createFileBrowser(deps: FileBrowserDeps): FileBrowserInstance {
  const { model } = deps;
  const el = document.createElement("div");
  el.className = "pmd-browser";

  function renderRow(entry: DirEntry, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "pmd-browser-row";
    row.style.paddingLeft = `${8 + depth * 16}px`;
    row.dataset.path = entry.path;
    if (entry.path === model.selected()) row.classList.add("selected");
    if (entry.path === model.activeFile()) row.classList.add("pmd-browser-active");
    if (!entry.is_dir && !entry.is_markdown) row.classList.add("pmd-browser-nonmd");

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
    row.appendChild(name);

    if (entry.is_dir) {
      row.addEventListener("click", () => model.toggleDir(entry.path));
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
      row.addEventListener("click", () => model.select(entry.path));
      row.addEventListener("dblclick", (e) => {
        if (!entry.is_markdown) return;
        deps.onOpenFile(entry.path, { background: e.shiftKey });
      });
    }
    return row;
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
    up.title = "Go up to parent folder";
    up.addEventListener("click", async () => {
      const { parentOf } = await import("./workspace.js");
      const parent = parentOf(dir);
      if (parent && !(await deps.setRoot(parent))) {
        const picked = await deps.pickBaseDir();
        if (picked) await deps.setRoot(picked);
      }
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
    el.replaceChildren();
    const root = model.root();
    if (!root) {
      renderChooser();
      return;
    }
    renderHeader(root);
    const tree = document.createElement("div");
    tree.className = "pmd-browser-tree";
    tree.setAttribute("role", "tree");
    renderEntries(root, 0, tree);
    el.appendChild(tree);
  }

  model.onChange(render);
  render();

  return { el, refresh: () => model.refresh() };
}
