# Folder Sidebar with Dynamic Workspace Root — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent VSCode-style left folder sidebar alongside the editor/preview, driven by a single window-global dynamic "workspace root", while keeping the existing folder tab working.

**Architecture:** A pure, DOM-free `workspace` model (TS) is the single source of truth for root/expanded/selection/active-file; the sidebar and the existing folder tab are thin views over it. The "workspace root" is a non-granting UI cursor constrained by the existing `PathScope` allowlist; a new root-guarded `allow_file_and_parent` grants the parent dir of files opened via trusted origins (CLI / OS dialog) so the cold-start default and sibling browsing work. A new `#main-region` wrapper isolates the editor/preview split-ratio math from the inserted sidebar.

**Tech Stack:** Rust (Tauri commands, `PathScope`), TypeScript (no framework; `node --test` unit tests, esbuild bundle), CSS.

**Spec:** `docs/superpowers/specs/2026-05-31-folder-sidebar-design.md` (passed 3 rounds of codex review).

**Commands:**
- Rust app tests: `cargo test -p pmd-app -j 2`
- Rust path_scope unit: `cargo test -p pmd-app path_scope -j 2`
- TS unit: `cd ui && npm run test:unit`
- TS typecheck: `cd ui && npm run typecheck`
- UI bundle (smoke): `cd ui && npm run build`

---

## File Structure

**Rust (`crates/pmd-app/`)**
- `src/path_scope.rs` — add `workspace_root` field + `set_workspace_root`, `workspace_root`, `allow_file_and_parent` (root-guarded). MODIFY.
- `src/cmd/browse.rs` — add `set_workspace_root` Tauri command. MODIFY.
- `src/cmd/file.rs` — `open_dialog` uses `allow_file_and_parent`. MODIFY.
- `src/cli.rs` — initial path uses `allow_file_and_parent`. MODIFY.
- `src/main.rs` — register `set_workspace_root` command. MODIFY.

**TypeScript (`ui/src/`)**
- `workspace.ts` — NEW. Pure model + pure helpers (`parentOf`, `isUnder`, `prunedExpanded`).
- `workspace.test.ts` — NEW. Unit tests for the model + helpers.
- `context_menu.ts` — NEW. Cursor-positioned menu helper + pure `clampMenuPosition`.
- `context_menu.test.ts` — NEW. Unit test for `clampMenuPosition`.
- `file_browser.ts` — REFACTOR to render from the shared model.
- `actions.ts` — add `view.toggleSidebar` action + default `Ctrl+B`.
- `actions.test.ts` — update the inventory-count assertion (21 → 22).
- `main.ts` — `#main-region` wrapper, sidebar + `#sidebar-resizer`, repoint split math, toggle wiring, cold-start root, reveal-on-activate, context menu. MODIFY.
- `styles/components.css` — sidebar + resizer + context-menu-position CSS. MODIFY.

---

## Phase A — Backend: non-granting workspace root + root-guarded parent grant

### Task A1: `PathScope::set_workspace_root` + getter (UI cursor, never grants)

**Files:**
- Modify: `crates/pmd-app/src/path_scope.rs`
- Test: same file `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `crates/pmd-app/src/path_scope.rs`:

```rust
    #[test]
    fn set_workspace_root_accepts_within_allowed_dir_and_rejects_outside() {
        let base = tempfile::tempdir().expect("base");
        let sub = base.path().join("docs");
        std::fs::create_dir(&sub).expect("sub");
        let outside = tempfile::tempdir().expect("outside");

        let scope = PathScope::new();
        scope.allow_dir(base.path()).expect("admit base");

        // Within an admitted dir → accepted, stored, returns canonical.
        let canon = scope.set_workspace_root(&sub).expect("within base");
        assert_eq!(canon, sub.canonicalize().unwrap());
        assert_eq!(scope.workspace_root(), Some(sub.canonicalize().unwrap()));

        // Outside all admitted dirs → rejected, and allowed_dirs is unchanged.
        let before = scope.allowed_dirs().len();
        assert!(scope.set_workspace_root(outside.path()).is_err());
        assert_eq!(scope.allowed_dirs().len(), before, "must not escalate");
        // Root unchanged after a rejected set.
        assert_eq!(scope.workspace_root(), Some(sub.canonicalize().unwrap()));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p pmd-app path_scope::tests::set_workspace_root -j 2`
Expected: FAIL — `no method named set_workspace_root`.

- [ ] **Step 3: Implement**

Add the field to the struct (after `allowed_dirs`):

```rust
    allowed_dirs: Mutex<HashSet<PathBuf>>,
    /// The current UI listing root. This is a *display cursor only* — it never
    /// grants authority and is always constrained to sit within an admitted
    /// dir. Mutating it cannot widen `allowed` / `allowed_dirs`.
    workspace_root: Mutex<Option<PathBuf>>,
```

Initialise it in `new()`:

```rust
        Self {
            allowed: Mutex::new(HashSet::new()),
            allowed_dirs: Mutex::new(HashSet::new()),
            workspace_root: Mutex::new(None),
        }
```

Add methods inside `impl PathScope` (after `allowed_dirs()`):

```rust
    /// Set the UI workspace root. Canonicalises `p` and **requires** it to be
    /// within an already-admitted directory; otherwise returns an error and the
    /// current root is left unchanged. This never inserts into `allowed_dirs`,
    /// so the renderer cannot use it to widen authority.
    pub fn set_workspace_root(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = std::fs::canonicalize(p)?;
        if !self.is_within_allowed_dir(&canon) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "workspace root is outside all granted directories",
            ));
        }
        let mut root = self
            .workspace_root
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        *root = Some(canon.clone());
        Ok(canon)
    }

    /// The current workspace root, if any.
    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.workspace_root
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p pmd-app path_scope::tests::set_workspace_root -j 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/path_scope.rs
git commit -m "feat(scope): non-granting workspace_root cursor gated by allowed_dirs"
```

### Task A2: `PathScope::allow_file_and_parent` (root-guarded)

**Files:**
- Modify: `crates/pmd-app/src/path_scope.rs`
- Test: same file `tests` module

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn allow_file_and_parent_grants_parent_dir() {
        let dir = tempfile::tempdir().expect("dir");
        let file = dir.path().join("readme.md");
        std::fs::write(&file, "x").expect("write");
        let scope = PathScope::new();

        let canon = scope.allow_file_and_parent(&file).expect("admit");
        assert_eq!(canon, file.canonicalize().unwrap());
        // The file is in scope...
        assert!(scope.check_canonical(&canon));
        // ...and its parent dir is now an admitted dir (siblings browsable).
        let sibling = dir.path().join("other.md");
        std::fs::write(&sibling, "y").expect("write sibling");
        assert!(scope.is_within_allowed_dir(&sibling.canonicalize().unwrap()));
    }

    #[test]
    fn allow_file_and_parent_root_guard_skips_filesystem_root() {
        // We can't write to "/", so simulate a path whose parent is the root by
        // checking the guard directly: a file directly under root must NOT add a
        // dir grant. Use the canonical root of the temp dir's filesystem via "/".
        let scope = PathScope::new();
        // Construct a path "/<name>" that may or may not exist; the guard is
        // about the parent being a filesystem root (parent.parent() == None).
        // We assert no allowed_dir is added even when the file itself is admitted
        // via a real file placed at a mount we control is not possible portably,
        // so we test the helper's guard predicate instead.
        assert!(
            !PathScope::grants_parent_dir(std::path::Path::new("/")),
            "root has no parent to grant"
        );
        assert!(
            PathScope::grants_parent_dir(std::path::Path::new("/home/user")),
            "a normal dir is grantable"
        );
        let _ = scope; // silence unused in case
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p pmd-app path_scope::tests::allow_file_and_parent -j 2`
Expected: FAIL — `no method named allow_file_and_parent` / `no function grants_parent_dir`.

- [ ] **Step 3: Implement**

Add a free function near `is_within` (module level):

```rust
/// True if `dir` (a candidate directory to grant) is grantable — i.e. it is not
/// a filesystem root. Granting a filesystem root would, via transitive
/// membership, admit the entire tree, so it is refused.
fn dir_is_grantable(dir: &Path) -> bool {
    dir.parent().is_some()
}
```

Add methods inside `impl PathScope`:

```rust
    /// Test-visible wrapper over the root guard predicate.
    #[cfg(test)]
    pub fn grants_parent_dir(dir: &Path) -> bool {
        dir_is_grantable(dir)
    }

    /// Admit a file via a TRUSTED origin (CLI argv or OS open dialog) and, when
    /// its canonical parent is not a filesystem root, also admit that parent
    /// directory so the user can browse/open siblings. The renderer must never
    /// call this (it would forge a directory grant); renderer opens go through
    /// `cmd::file::request_open_file`, which only admits the single file.
    pub fn allow_file_and_parent(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = self.allow(p)?;
        if let Some(parent) = canon.parent() {
            if dir_is_grantable(parent) {
                // Best-effort: parent of a real file is a dir; ignore errors so
                // a transient stat failure never blocks opening the file.
                let _ = self.allow_dir(parent);
            }
        }
        Ok(canon)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p pmd-app path_scope::tests::allow_file_and_parent -j 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/path_scope.rs
git commit -m "feat(scope): root-guarded allow_file_and_parent for trusted opens"
```

### Task A3: Wire parent-grant into CLI + open_dialog (trusted origins only)

**Files:**
- Modify: `crates/pmd-app/src/cli.rs:69`
- Modify: `crates/pmd-app/src/cmd/file.rs:247`

- [ ] **Step 1: Edit `cli.rs`** — change the admission call so the initial path also grants its parent dir.

In `parse_args`, replace `match scope.allow(&p) {` with:

```rust
    match scope.allow_file_and_parent(&p) {
```

(The surrounding `Ok(canon) => ... / Err(e) => ...` arms are unchanged.)

- [ ] **Step 2: Edit `open_dialog` in `cmd/file.rs`** — the OS dialog is a trusted origin.

Replace the line `let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;` **inside `open_dialog`** (the one after `let canon = path.into_path()...`, around line 247) with:

```rust
        let canon = state
            .scope
            .allow_file_and_parent(&canon)
            .map_err(|e| e.to_string())?;
```

Leave `request_open_file` (line ~207) and `save_dialog` (line ~274) using `allow` / `allow_canonical` unchanged — they are NOT parent-granting.

- [ ] **Step 3: Verify the workspace builds and existing tests pass**

Run: `cargo test -p pmd-app -j 2`
Expected: PASS (no regressions; existing open/CLI tests still green).

- [ ] **Step 4: Commit**

```bash
git add crates/pmd-app/src/cli.rs crates/pmd-app/src/cmd/file.rs
git commit -m "feat(scope): grant parent dir on CLI + dialog opens only"
```

### Task A4: `set_workspace_root` Tauri command + registration

**Files:**
- Modify: `crates/pmd-app/src/cmd/browse.rs`
- Modify: `crates/pmd-app/src/main.rs`

- [ ] **Step 1: Add the command to `browse.rs`** (after `pick_base_dir`):

```rust
/// Set the UI workspace root. Accepts only a directory already within a granted
/// base (the renderer cannot widen authority here); persists it as the browser
/// base so it is restored next launch. Returns the canonical root. On rejection
/// the frontend falls back to `pick_base_dir` (the OS picker) to grant a new
/// base.
#[tauri::command]
pub fn set_workspace_root(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<PathBuf, String> {
    let canon = state
        .scope
        .set_workspace_root(&path)
        .map_err(|e| e.to_string())?;
    if let Err(e) = settings::rmw(|s| settings::Settings {
        browser_base_dir: Some(canon.clone()),
        ..s
    }) {
        eprintln!("[btr-md] could not persist workspace root: {e}");
    }
    Ok(canon)
}
```

- [ ] **Step 2: Register it in `main.rs`** — add `cmd::browse::set_workspace_root,` to the `tauri::generate_handler![...]` list, next to `cmd::browse::list_dir` and `cmd::browse::pick_base_dir`.

- [ ] **Step 3: Verify build**

Run: `cargo build -p pmd-app -j 2`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add crates/pmd-app/src/cmd/browse.rs crates/pmd-app/src/main.rs
git commit -m "feat(cmd): set_workspace_root command (within-grant only, persists base)"
```

---

## Phase B — Frontend: the shared, pure workspace model

The model is **DOM-free** so it is unit-testable under `node --test`. Views call it and re-render on `onChange`. `localStorage` access is guarded (`typeof localStorage !== 'undefined'`) so tests run headless.

### Task B1: Pure helpers — `parentOf`, `isUnder`, `prunedExpanded`

**Files:**
- Create: `ui/src/workspace.ts`
- Create: `ui/src/workspace.test.ts`

- [ ] **Step 1: Write the failing test** (`ui/src/workspace.test.ts`):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parentOf, isUnder, prunedExpanded } from "./workspace.ts";

test("parentOf returns the parent path or null at root", () => {
  assert.equal(parentOf("/a/b/c"), "/a/b");
  assert.equal(parentOf("/a"), "/");
  assert.equal(parentOf("/"), null);
  assert.equal(parentOf("/a/b/"), "/a"); // trailing slash tolerated
});

test("isUnder is a component-wise descendant test", () => {
  assert.equal(isUnder("/base", "/base/x"), true);
  assert.equal(isUnder("/base", "/base"), true);
  assert.equal(isUnder("/base", "/base_evil"), false); // not a string prefix
  assert.equal(isUnder("/base/x", "/base"), false); // ancestor, not descendant
});

test("prunedExpanded keeps only paths under the root", () => {
  const got = prunedExpanded(new Set(["/r/a", "/r/a/b", "/other/x"]), "/r");
  assert.deepEqual([...got].sort(), ["/r/a", "/r/a/b"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && node --test src/workspace.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement the helpers** (top of `ui/src/workspace.ts`):

```ts
// Pure, DOM-free workspace model shared by the sidebar and the folder tab.
// Paths are canonical POSIX-style absolute paths as returned by the backend.

import type { DirEntry, DirListing } from "./file_browser.js";

/** Parent of an absolute path, or null if it is the filesystem root. */
export function parentOf(path: string): string | null {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trimmed === "/") return null;
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return null;
  return idx === 0 ? "/" : trimmed.slice(0, idx);
}

/** Component-wise descendant test: is `child` equal to or under `dir`? */
export function isUnder(dir: string, child: string): boolean {
  const d = dir.replace(/\/+$/, "").split("/");
  const c = child.replace(/\/+$/, "").split("/");
  if (c.length < d.length) return false;
  return d.every((seg, i) => seg === c[i]);
}

/** Subset of `expanded` whose entries are under `root` (lazy prune on re-root). */
export function prunedExpanded(expanded: Set<string>, root: string): Set<string> {
  return new Set([...expanded].filter((p) => isUnder(root, p)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && node --test src/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/workspace.ts ui/src/workspace.test.ts
git commit -m "feat(ui): pure path helpers for the workspace model"
```

### Task B2: The `WorkspaceModel` store

**Files:**
- Modify: `ui/src/workspace.ts`
- Modify: `ui/src/workspace.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `workspace.test.ts`):

```ts
import { createWorkspaceModel } from "./workspace.ts";

function fakeListing(dir: string, names: string[]): DirListing {
  return {
    dir,
    entries: names.map((n) => ({
      name: n.replace(/\/$/, ""),
      path: `${dir}/${n.replace(/\/$/, "")}`,
      is_dir: n.endsWith("/"),
      is_markdown: n.endsWith(".md"),
    })),
  };
}

test("setRoot stores canonical root, loads it, prunes stale expanded", async () => {
  const calls: string[] = [];
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      calls.push(dir);
      return fakeListing(dir, ["a/", "x.md"]);
    },
  });
  model.expand("/old/keep"); // not under new root → pruned
  await model.setRoot("/r");
  assert.equal(model.root(), "/r");
  assert.deepEqual(calls, ["/r"]);
  assert.equal(model.expanded().has("/old/keep"), false);
  assert.deepEqual(model.entriesOf("/r")?.map((e) => e.name), ["a", "x.md"]);
});

test("navigateUp moves root to the parent and lists it", async () => {
  const model = createWorkspaceModel({
    listDir: async (dir) => fakeListing(dir, ["child.md"]),
  });
  await model.setRoot("/r/sub");
  const up = await model.navigateUp();
  assert.equal(up, true);
  assert.equal(model.root(), "/r");
});

test("navigateUp at filesystem root is a no-op returning false", async () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, []) });
  await model.setRoot("/");
  assert.equal(await model.navigateUp(), false);
  assert.equal(model.root(), "/");
});

test("select and setActiveFile are independent highlights", () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, []) });
  model.select("/r/a.md");
  model.setActiveFile("/r/b.md");
  assert.equal(model.selected(), "/r/a.md");
  assert.equal(model.activeFile(), "/r/b.md");
});

test("onChange fires on mutations", async () => {
  let n = 0;
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, ["a/"]) });
  model.onChange(() => { n += 1; });
  await model.setRoot("/r");
  model.select("/r/a");
  assert.ok(n >= 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && node --test src/workspace.test.ts`
Expected: FAIL — `createWorkspaceModel` undefined.

- [ ] **Step 3: Implement the store** (append to `ui/src/workspace.ts`):

```ts
const EXPANDED_KEY = "pmd:browser:expanded";

function loadExpanded(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistExpanded(expanded: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export interface WorkspaceDeps {
  listDir: (dir: string) => Promise<DirListing>;
}

export interface WorkspaceModel {
  root(): string | null;
  expanded(): Set<string>;
  selected(): string | null;
  activeFile(): string | null;
  entriesOf(dir: string): DirEntry[] | undefined;
  onChange(cb: () => void): void;
  setRoot(path: string): Promise<void>;
  navigateUp(): Promise<boolean>;
  expand(path: string): Promise<void>;
  collapse(path: string): void;
  toggleDir(path: string): Promise<void>;
  select(path: string | null): void;
  setActiveFile(path: string | null): void;
  revealFile(path: string): Promise<void>;
  refresh(): Promise<void>;
}

export function createWorkspaceModel(deps: WorkspaceDeps): WorkspaceModel {
  let root: string | null = null;
  let expanded = loadExpanded();
  let selected: string | null = null;
  let activeFile: string | null = null;
  const cache = new Map<string, DirEntry[]>();
  const handlers: Array<() => void> = [];

  const emit = () => handlers.forEach((h) => h());

  async function ensureLoaded(dir: string): Promise<void> {
    if (cache.has(dir)) return;
    try {
      const listing = await deps.listDir(dir);
      cache.set(dir, listing.entries);
    } catch (e) {
      console.error("list_dir failed:", e);
      cache.set(dir, []);
    }
  }

  return {
    root: () => root,
    expanded: () => expanded,
    selected: () => selected,
    activeFile: () => activeFile,
    entriesOf: (dir) => cache.get(dir),
    onChange: (cb) => { handlers.push(cb); },

    setRoot: async (path) => {
      root = path;
      expanded = prunedExpanded(expanded, path);
      persistExpanded(expanded);
      cache.delete(path);
      await ensureLoaded(path);
      emit();
    },

    navigateUp: async () => {
      if (!root) return false;
      const parent = parentOf(root);
      if (!parent) return false;
      root = parent;
      cache.delete(parent);
      await ensureLoaded(parent);
      emit();
      return true;
    },

    expand: async (path) => {
      expanded.add(path);
      persistExpanded(expanded);
      await ensureLoaded(path);
      emit();
    },
    collapse: (path) => {
      expanded.delete(path);
      persistExpanded(expanded);
      emit();
    },
    toggleDir: async (path) => {
      if (expanded.has(path)) {
        expanded.delete(path);
        persistExpanded(expanded);
        emit();
      } else {
        expanded.add(path);
        persistExpanded(expanded);
        await ensureLoaded(path);
        emit();
      }
    },

    select: (path) => { selected = path; emit(); },
    setActiveFile: (path) => { activeFile = path; emit(); },

    revealFile: async (path) => {
      if (!root || !isUnder(root, path)) return;
      // Expand each ancestor between root and the file's directory.
      let cur = parentOf(path);
      const toOpen: string[] = [];
      while (cur && isUnder(root, cur)) {
        toOpen.push(cur);
        if (cur === root) break;
        cur = parentOf(cur);
      }
      for (const d of toOpen.reverse()) {
        expanded.add(d);
        await ensureLoaded(d);
      }
      persistExpanded(expanded);
      activeFile = path;
      emit();
    },

    refresh: async () => {
      cache.clear();
      if (root) await ensureLoaded(root);
      emit();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && node --test src/workspace.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd ui && npm run typecheck`
Expected: no errors.

```bash
git add ui/src/workspace.ts ui/src/workspace.test.ts
git commit -m "feat(ui): shared workspace model (root/expanded/selected/activeFile)"
```

---

## Phase C — Context menu helper

### Task C1: `clampMenuPosition` (pure) + `openContextMenu` (DOM)

**Files:**
- Create: `ui/src/context_menu.ts`
- Create: `ui/src/context_menu.test.ts`

- [ ] **Step 1: Write the failing test** (`ui/src/context_menu.test.ts`):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { clampMenuPosition } from "./context_menu.ts";

test("clampMenuPosition keeps the menu inside the viewport", () => {
  // Fits as-is.
  assert.deepEqual(
    clampMenuPosition({ x: 10, y: 10 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 10, top: 10 }
  );
  // Overflows right/bottom → shifted back so it stays visible.
  assert.deepEqual(
    clampMenuPosition({ x: 780, y: 580 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 700, top: 550 }
  );
  // Never goes negative.
  assert.deepEqual(
    clampMenuPosition({ x: 5, y: 5 }, { w: 100, h: 50 }, { w: 40, h: 30 }),
    { left: 0, top: 0 }
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && node --test src/context_menu.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`ui/src/context_menu.ts`):

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && node --test src/context_menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd ui && npm run typecheck`

```bash
git add ui/src/context_menu.ts ui/src/context_menu.test.ts
git commit -m "feat(ui): cursor-positioned context menu helper"
```

---

## Phase D — Refactor the folder tab onto the shared model

The existing `createFileBrowser` keeps its own state today. Refactor it to take a `WorkspaceModel` (and the picker/open deps) so the folder tab and sidebar share one model. Rendering (`renderRow`, twisty, icons, CSS classes) is preserved.

### Task D1: `createFileBrowser` renders from a `WorkspaceModel`

**Files:**
- Modify: `ui/src/file_browser.ts`

- [ ] **Step 1: Change the deps + body to use the model.** Replace the `FileBrowserDeps` interface and the internal state with the model. New `file_browser.ts` body (keep `DirEntry`/`DirListing` exports — `workspace.ts` imports them):

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd ui && npm run typecheck`
Expected: errors ONLY in `main.ts` (its `createFileBrowser(...)` call site still uses the old deps) — these are fixed in Phase G. `file_browser.ts` itself must be clean.

- [ ] **Step 3: Commit**

```bash
git add ui/src/file_browser.ts
git commit -m "refactor(ui): file browser renders from shared workspace model"
```

> NOTE: `main.ts` will not typecheck/bundle until Task G1 updates the call site. Phases E/F edit CSS and the action registry (independent) and can be committed before G; the full `npm run build` + `npm run typecheck` green gate is at the end of Phase G.

---

## Phase E — Sidebar panel, `#main-region` wrapper, resizer, CSS

### Task E1: `#main-region` wrapper + repoint split-ratio math

**Files:**
- Modify: `ui/src/main.ts:148-153` (container assembly) and `:184` (resize rect)

- [ ] **Step 1: Wrap editor/preview/tab-body in `#main-region`.** Replace the block that builds `appContainer` (currently appending editorPane, splitResizer, previewPane, tabBodyEl directly) with:

```ts
const mainRegion = document.createElement('div');
mainRegion.id = 'main-region';
mainRegion.appendChild(editorPane);
mainRegion.appendChild(splitResizer);
mainRegion.appendChild(previewPane);
mainRegion.appendChild(tabBodyEl);

const appContainer = document.createElement('div');
appContainer.id = 'app-container';
// Sidebar + its resizer are inserted before main-region in Task E2.
appContainer.appendChild(mainRegion);
document.body.appendChild(appContainer);
```

- [ ] **Step 2: Repoint the split-ratio measurement** from the whole container to `#main-region`. In the `splitResizer` `pointermove` handler, change:

```ts
  const rect = appContainer.getBoundingClientRect();
```
to:
```ts
  const rect = mainRegion.getBoundingClientRect();
```

Also move the `--pmd-split-ratio` CSS var from `appContainer` to `mainRegion`: change `appContainer.style.setProperty('--pmd-split-ratio', ...)` to `mainRegion.style.setProperty(...)`, and the two `appContainer.style.getPropertyValue('--pmd-split-ratio')` reads to `mainRegion.style.getPropertyValue(...)`.

- [ ] **Step 3: Update CSS so `#main-region` carries the split layout.** In `ui/styles/components.css`, the existing `#app-container { display:flex; ... }` rules that lay out editor/preview/tab-body via `--pmd-split-ratio` should now target `#main-region`. Add:

```css
#main-region {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
}
```

Re-point any selector that referenced `#app-container > #editor-pane` / `#preview-pane` / `#split-resizer` / `#pmd-tab-body` to `#main-region > ...` (the children moved one level down). Keep `#app-container { display:flex; height:100vh; padding-top: var(--pmd-chrome-h,44px); }`.

- [ ] **Step 4: Bundle smoke (build only, no run)**

Run: `cd ui && npm run build`
Expected: bundles (build does not typecheck; `main.ts` call-site type errors do not block esbuild). If it fails, it is a syntax error to fix now.

- [ ] **Step 5: Commit**

```bash
git add ui/src/main.ts ui/styles/components.css
git commit -m "refactor(ui): #main-region wrapper isolates split-ratio from sidebar"
```

### Task E2: Sidebar element + `#sidebar-resizer` + CSS

**Files:**
- Modify: `ui/src/main.ts` (after `mainRegion` is created, before/at `appContainer` assembly)
- Modify: `ui/styles/components.css`

- [ ] **Step 1: Create the sidebar + resizer and insert them before `#main-region`.** Add just before `appContainer.appendChild(mainRegion);`:

```ts
const SIDEBAR_VISIBLE_KEY = 'pmd:sidebar:visible';
const SIDEBAR_WIDTH_KEY = 'pmd:sidebar:width';

const sidebarEl = document.createElement('div');
sidebarEl.id = 'pmd-sidebar';

const sidebarResizer = document.createElement('div');
sidebarResizer.id = 'sidebar-resizer';
sidebarResizer.className = 'pmd-split-resizer';
sidebarResizer.setAttribute('role', 'separator');
sidebarResizer.setAttribute('aria-orientation', 'vertical');
sidebarResizer.setAttribute('aria-label', 'Resize folder sidebar');
sidebarResizer.tabIndex = 0;

function applySidebarWidth(px: number): void {
  const clamped = Math.max(140, Math.min(px, 600));
  appContainer.style.setProperty('--pmd-sidebar-w', `${clamped}px`);
}
function applySidebarVisible(visible: boolean): void {
  document.body.dataset.sidebar = visible ? 'on' : 'off';
}

const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '260');
applySidebarWidth(Number.isFinite(savedWidth) ? savedWidth : 260);
applySidebarVisible(localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== '0');

appContainer.appendChild(sidebarEl);
appContainer.appendChild(sidebarResizer);
```

(Then the existing `appContainer.appendChild(mainRegion); document.body.appendChild(appContainer);` follow.)

- [ ] **Step 2: Wire the sidebar resizer drag** (add after the element creation):

```ts
let sidebarResizing = false;
sidebarResizer.addEventListener('pointerdown', (e) => {
  sidebarResizing = true;
  sidebarResizer.setPointerCapture(e.pointerId);
});
sidebarResizer.addEventListener('pointermove', (e) => {
  if (!sidebarResizing) return;
  const rect = appContainer.getBoundingClientRect();
  applySidebarWidth(e.clientX - rect.left);
});
const endSidebarResize = (e: PointerEvent) => {
  if (!sidebarResizing) return;
  sidebarResizing = false;
  try { sidebarResizer.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  const w = appContainer.style.getPropertyValue('--pmd-sidebar-w').replace('px', '');
  localStorage.setItem(SIDEBAR_WIDTH_KEY, w || '260');
};
sidebarResizer.addEventListener('pointerup', endSidebarResize);
sidebarResizer.addEventListener('pointercancel', endSidebarResize);
```

- [ ] **Step 3: Add CSS** to `ui/styles/components.css`:

```css
#app-container { --pmd-sidebar-w: 260px; }
#pmd-sidebar {
  width: var(--pmd-sidebar-w);
  flex: 0 0 var(--pmd-sidebar-w);
  min-width: 0;
  height: 100%;
  overflow: auto;
  border-right: 1px solid var(--pmd-border, #2a2a2a);
  background: var(--pmd-surface, #1b1b1b);
}
#sidebar-resizer { flex: 0 0 auto; }
body[data-sidebar="off"] #pmd-sidebar,
body[data-sidebar="off"] #sidebar-resizer { display: none !important; }
.pmd-browser-active { background: color-mix(in srgb, var(--pmd-accent, #5b9) 18%, transparent); }
.pmd-context-menu { z-index: 120; }
```

- [ ] **Step 4: Build smoke**

Run: `cd ui && npm run build`
Expected: bundles.

- [ ] **Step 5: Commit**

```bash
git add ui/src/main.ts ui/styles/components.css
git commit -m "feat(ui): persistent folder sidebar element + resizer + CSS"
```

---

## Phase F — `view.toggleSidebar` action + Ctrl+B + toolbar button

### Task F1: Register the `view.toggleSidebar` action

**Files:**
- Modify: `ui/src/actions.ts`
- Modify: `ui/src/actions.test.ts`

- [ ] **Step 1: Update the failing test.** In `ui/src/actions.test.ts`, the assertion `assert.equal(Object.keys(DEFAULT_ACTION_SHORTCUTS).length, 21);` must become `22`. Change it, and add:

```ts
test("toggle sidebar action exists with Ctrl+B", () => {
  const byId = new Map(defaultActionSpecs.map((a) => [a.id, a]));
  assert.deepEqual(byId.get("view.toggleSidebar")?.defaultShortcuts, ["Ctrl+B"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && node --test src/actions.test.ts`
Expected: FAIL (count is 21; `view.toggleSidebar` missing).

- [ ] **Step 3: Implement.** In `ui/src/actions.ts`:
  - Add `| "view.toggleSidebar"` to the `ActionId` union (in the View group, near `view.toggleWordWrap`).
  - Add to `DEFAULT_ACTION_SHORTCUTS`: `"view.toggleSidebar": ["Ctrl+B"],`.
  - Add to `defaultActionSpecs`: `spec("view.toggleSidebar", "Toggle sidebar", "View", "Show or hide the folder sidebar"),`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && node --test src/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/actions.ts ui/src/actions.test.ts
git commit -m "feat(ui): view.toggleSidebar action bound to Ctrl+B"
```

---

## Phase G — Wiring it all together in main.ts

### Task G1: Build the model, mount both views, update the folder-tab call site

**Files:**
- Modify: `ui/src/main.ts` (model creation; `renderBrowserBody`; sidebar mount)

- [ ] **Step 1: Create the shared model once, near the other top-level singletons** (after `browserBaseDir` is known to be read from settings — keep `let browserBaseDir` as-is; the model is the new source of truth). Add an import at the top:

```ts
import { createWorkspaceModel, parentOf } from './workspace.js';
```

After `appContainer` is in the DOM, create the model and the shared deps:

```ts
const workspace = createWorkspaceModel({
  listDir: (dir) => invoke<DirListing>('list_dir', { dir }),
});

async function setWorkspaceRoot(path: string): Promise<boolean> {
  try {
    const canon = await invoke<string>('set_workspace_root', { path });
    await workspace.setRoot(canon);
    return true;
  } catch (e) {
    console.warn('set_workspace_root rejected:', e);
    return false;
  }
}

const browserDeps = {
  model: workspace,
  pickBaseDir: () => invoke<string | null>('pick_base_dir'),
  onOpenFile: (path: string, opts: { background: boolean }) =>
    openFile(path, { background: opts.background }),
  setRoot: setWorkspaceRoot,
  revealInFolder: (path: string) => { void invoke('reveal_in_folder', { path }); },
};
```

(Use the existing `openFile` helper — confirm its signature near line 1117; if it is `openFile(path, { background })` adapt accordingly.)

- [ ] **Step 2: Mount the sidebar view** into `#pmd-sidebar`:

```ts
import { createFileBrowser } from './file_browser.js'; // already imported — keep one import
const sidebarBrowser = createFileBrowser(browserDeps);
sidebarEl.appendChild(sidebarBrowser.el);
```

- [ ] **Step 3: Update `renderBrowserBody`** (around line 1042) to use the shared deps instead of the old `initialBaseDir`/`onBaseDirChange` shape:

```ts
function renderBrowserBody(): void {
  if (!fileBrowser) {
    fileBrowser = createFileBrowser(browserDeps);
  }
  tabBodyEl.replaceChildren(fileBrowser.el);
}
```

Remove the now-unused `browserBaseDir`/`onBaseDirChange` plumbing in this function (the model + `set_workspace_root` persistence replace it).

- [ ] **Step 4: Typecheck**

Run: `cd ui && npm run typecheck`
Expected: clean (all call sites now match the refactored `FileBrowserDeps`). Fix any residual references to the removed deps.

- [ ] **Step 5: Commit**

```bash
git add ui/src/main.ts
git commit -m "feat(ui): mount sidebar + folder tab over one shared workspace model"
```

### Task G2: Cold-start default root + reveal-on-activate

**Files:**
- Modify: `ui/src/main.ts` (settings load ~1440; `store.onActivate` ~973; startup open flow)

- [ ] **Step 1: Seed the root.** Where settings are loaded (`if (settings.browser_base_dir) browserBaseDir = settings.browser_base_dir;` ~1440), additionally seed the model when a persisted base exists:

```ts
  if (settings.browser_base_dir) {
    browserBaseDir = settings.browser_base_dir;
    void setWorkspaceRoot(settings.browser_base_dir);
  }
```

- [ ] **Step 2: Default to the opened file's folder when no root is set.** In the doc-open path (where a `DocTab` becomes active with a real `filePath`), add a helper and call it on activate. In the `store.onActivate((prev, next) => { ... })` handler (~973), after setting `data-tabkind`, add:

```ts
  if (next.kind === 'doc' && next.filePath) {
    if (!workspace.root()) {
      const parent = parentOf(next.filePath);
      if (parent) void setWorkspaceRoot(parent);
    } else {
      void workspace.revealFile(next.filePath);
    }
  }
```

> Why this is safe: the doc's parent dir was granted by `allow_file_and_parent` at the trusted-origin open (CLI/dialog), so `set_workspace_root` accepts it. For renderer/drag opens where the parent was not granted, `set_workspace_root` returns false and the sidebar simply shows "Choose folder…".

- [ ] **Step 3: Build + typecheck**

Run: `cd ui && npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add ui/src/main.ts
git commit -m "feat(ui): default sidebar root to opened file folder; reveal active file"
```

### Task G3: Toggle wiring (Ctrl+B + toolbar button)

**Files:**
- Modify: `ui/src/main.ts` (action context `run` switch; `installActionHotkeys` is already installed)

- [ ] **Step 1: Implement the toggle in the action context.** Find the action `run(id)` dispatcher (the object passed to `createActionRegistry` / used by `installActionHotkeys`, near line 494) and add a case:

```ts
    case 'view.toggleSidebar': {
      const next = document.body.dataset.sidebar !== 'on';
      applySidebarVisible(next);
      localStorage.setItem(SIDEBAR_VISIBLE_KEY, next ? '1' : '0');
      break;
    }
```

(Match the existing switch/dispatch style — if actions dispatch via a map rather than a switch, register `view.toggleSidebar` the same way the neighbouring `view.*` actions are.)

- [ ] **Step 2: Add a toolbar button.** In `chrome.ts`/toolbar construction where the `view.*` buttons live, add a button that runs `view.toggleSidebar`. Minimal: a ghost button labelled with a sidebar glyph (e.g. `▌`), `title="Toggle sidebar (Ctrl+B)"`, calling the same action id through the registry. (Follow the existing pattern used by the mode buttons; if the toolbar is data-driven, add the entry there.)

- [ ] **Step 3: Build + typecheck**

Run: `cd ui && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Manual smoke (developer machine).**

Run: `just dev` (builds UI + runs the app, 2 threads). Verify:
  - Sidebar shows on the left next to the editor/preview.
  - `Ctrl+B` hides/shows it; state survives restart.
  - Dragging `#sidebar-resizer` resizes it; width survives restart.
  - The editor/preview split resizer still works and is unaffected by sidebar width.
  - Right-click a folder → "Set as workspace root" re-roots; "Reveal in file manager" opens the OS file manager.
  - The Up button climbs; climbing past the granted base opens the OS picker.
  - Opening a file from CLI roots the sidebar at its folder; siblings open on double-click.
  - The folder tab (via `navigate.fileBrowser`) shows the same tree/root.

- [ ] **Step 5: Commit**

```bash
git add ui/src/main.ts ui/src/chrome.ts
git commit -m "feat(ui): Ctrl+B + toolbar button toggle the folder sidebar"
```

---

## Phase H — Full verification gate

### Task H1: Run the full test + build matrix

- [ ] **Step 1: Rust**

Run: `cargo test -p pmd-app -j 2`
Expected: PASS.

- [ ] **Step 2: TS unit + typecheck + bundle**

Run: `cd ui && npm run test:unit && npm run typecheck && npm run build`
Expected: all PASS / clean.

- [ ] **Step 3: Format**

Run: `cargo fmt --all` then `git diff --stat` to confirm only intended files changed.

- [ ] **Step 4: Final commit if fmt changed anything**

```bash
git add -A
git commit -m "style: rustfmt after folder sidebar"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Sidebar alongside panes → Phase E (E2). Keep folder tab → Phase D + G1 (`renderBrowserBody`). Global dynamic workspace root → A1/A4 + B2. Cold-start default + sticky → G2. Up navigation + picker fallback → D1 header + B2 `navigateUp` + G1 `setWorkspaceRoot`. Context menu "Set as workspace root" + reveal → C1 + D1. Reveal active file → B2 `revealFile` + G2. Security (non-granting root, root-guarded parent grant, trusted-origin-only) → A1/A2/A3. `#main-region` split fix (NB1) → E1. selected vs activeFile (NB2) → B2 + D1. State-sync/cache contract (NB3) → B2 (single model, cache keyed by dir, prune on re-root). Cursor-positioned context menu (NB4) → C1. Ctrl+B via registry (NB5) → F1 + G3. Persistence: root in state.toml (A4), visibility/width/expanded in localStorage (E2/B).

**Placeholder scan:** No TBD/TODO; every code step has concrete code. Manual smoke (G3-4) is explicit and additional to automated gates.

**Type consistency:** `WorkspaceModel` method names (`setRoot`, `navigateUp`, `toggleDir`, `select`, `setActiveFile`, `revealFile`, `entriesOf`, `expanded`, `root`, `refresh`, `onChange`) are used identically in B2, D1, G1, G2. `FileBrowserDeps` (model/pickBaseDir/onOpenFile/setRoot/revealInFolder) matches the G1 `browserDeps`. Rust `allow_file_and_parent` / `set_workspace_root` / `workspace_root` used consistently across A and the command in A4.

**Open item:** `openFile` signature in main.ts (~1117) — confirm at G1 Step 1 and adapt the `onOpenFile` adapter if it differs.
