// The file-browser tab body: a lazy folder tree rooted at a user-chosen base
// directory. There is NO implicit default (never auto-admit $HOME): on first
// use it shows a "Choose folder…" prompt that opens the OS folder picker (the
// only trusted admission path). Expanded directories are persisted; the base
// directory is persisted by the backend and re-admitted on startup.

const EXPANDED_KEY = 'pmd:browser:expanded';

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
  listDir: (dir: string) => Promise<DirListing>;
  pickBaseDir: () => Promise<string | null>;
  initialBaseDir: string | null;
  /** Open a file. `background` => open without switching, then highlight. */
  onOpenFile: (path: string, opts: { background: boolean }) => void;
  /** Notify when the trusted base dir changes (so the session can persist it). */
  onBaseDirChange: (dir: string) => void;
}

export interface FileBrowserInstance {
  el: HTMLElement;
  /** Re-fetch the currently-expanded tree from disk. */
  refresh: () => void;
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function createFileBrowser(deps: FileBrowserDeps): FileBrowserInstance {
  const el = document.createElement('div');
  el.className = 'pmd-browser';

  let baseDir: string | null = deps.initialBaseDir;
  const expanded = loadExpanded();
  const cache = new Map<string, DirEntry[]>();
  let selected: string | null = null;

  async function ensureLoaded(dir: string): Promise<void> {
    if (cache.has(dir)) return;
    try {
      const listing = await deps.listDir(dir);
      cache.set(dir, listing.entries);
    } catch (e) {
      console.error('list_dir failed:', e);
      cache.set(dir, []);
    }
  }

  function toggleDir(path: string): void {
    if (expanded.has(path)) {
      expanded.delete(path);
      saveExpanded(expanded);
      render();
    } else {
      expanded.add(path);
      saveExpanded(expanded);
      ensureLoaded(path).then(render);
    }
  }

  function renderEntries(dir: string, depth: number, into: HTMLElement): void {
    const entries = cache.get(dir);
    if (!entries) return;
    for (const entry of entries) {
      into.appendChild(renderRow(entry, depth));
      if (entry.is_dir && expanded.has(entry.path)) {
        renderEntries(entry.path, depth + 1, into);
      }
    }
  }

  function renderRow(entry: DirEntry, depth: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pmd-browser-row';
    row.style.paddingLeft = `${8 + depth * 16}px`;
    row.dataset.path = entry.path;
    if (entry.path === selected) row.classList.add('selected');
    if (!entry.is_dir && !entry.is_markdown) row.classList.add('pmd-browser-nonmd');

    const twisty = document.createElement('span');
    twisty.className = 'pmd-browser-twisty';
    twisty.setAttribute('aria-hidden', 'true');
    twisty.textContent = entry.is_dir ? (expanded.has(entry.path) ? '▾' : '▸') : '';
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'pmd-browser-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.is_dir ? '🗀' : '🗎';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'pmd-browser-name pmd-truncate';
    name.textContent = entry.name;
    row.appendChild(name);

    if (entry.is_dir) {
      row.addEventListener('click', () => toggleDir(entry.path));
    } else {
      row.addEventListener('click', () => {
        selected = entry.path;
        render();
      });
      row.addEventListener('dblclick', (e) => {
        if (!entry.is_markdown) return;
        deps.onOpenFile(entry.path, { background: e.shiftKey });
      });
    }
    return row;
  }

  function renderChooser(): void {
    const wrap = document.createElement('div');
    wrap.className = 'pmd-browser-empty';
    const msg = document.createElement('p');
    msg.textContent = 'No folder selected.';
    const btn = document.createElement('button');
    btn.className = 'pmd-btn pmd-btn-primary';
    btn.type = 'button';
    btn.textContent = 'Choose folder…';
    btn.addEventListener('click', () => chooseFolder());
    wrap.appendChild(msg);
    wrap.appendChild(btn);
    el.appendChild(wrap);
  }

  function renderHeader(dir: string): void {
    const header = document.createElement('div');
    header.className = 'pmd-browser-header';

    const path = document.createElement('span');
    path.className = 'pmd-browser-base pmd-truncate';
    path.textContent = dir;
    path.title = dir;
    header.appendChild(path);

    const change = document.createElement('button');
    change.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
    change.type = 'button';
    change.textContent = 'Change…';
    change.title = 'Choose a different folder';
    change.addEventListener('click', () => chooseFolder());
    header.appendChild(change);

    el.appendChild(header);
  }

  async function chooseFolder(): Promise<void> {
    try {
      const picked = await deps.pickBaseDir();
      if (!picked) return;
      baseDir = picked;
      cache.clear();
      deps.onBaseDirChange(picked);
      await ensureLoaded(picked);
      render();
    } catch (e) {
      console.error('pick_base_dir failed:', e);
    }
  }

  function render(): void {
    el.replaceChildren();
    if (!baseDir) {
      renderChooser();
      return;
    }
    renderHeader(baseDir);
    const tree = document.createElement('div');
    tree.className = 'pmd-browser-tree';
    tree.setAttribute('role', 'tree');
    renderEntries(baseDir, 0, tree);
    el.appendChild(tree);
  }

  // Initial load.
  if (baseDir) {
    ensureLoaded(baseDir).then(render);
  } else {
    render();
  }

  return {
    el,
    refresh: () => {
      cache.clear();
      if (baseDir) {
        ensureLoaded(baseDir).then(render);
      } else {
        render();
      }
    },
  };
}
