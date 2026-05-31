# Folder Sidebar with Dynamic Workspace Root — Design

Date: 2026-05-31
Status: Approved design (revised after codex review #1)
Spec for: VSCode-style persistent folder sidebar alongside the markdown panes.

## Problem

The app can browse folders today, but only as a singleton **folder tab** that
fully replaces the editor/preview view. There is no way to keep a file tree
visible *alongside* the document being edited. Users navigating a docs project
want a persistent explorer (VSCode `Ctrl+B` style) showing adjacent files and
folders, with the ability to climb up the tree and re-root.

## Goals

- A persistent left **sidebar** showing a file/folder tree alongside the
  editor/preview panes (not mutually exclusive with the document view).
- Keep the existing **folder tab** working.
- A single window-global **workspace root** that is **dynamic**: navigable
  **up** to a parent, and re-rootable onto any folder via a right-click context
  menu.
- Sensible default: on cold start, root to the opened file's parent folder.
  Thereafter the root is **sticky** (opening other files does not move it).
- Selection follows the active document: switching to a doc whose path is under
  the root expands to and highlights it.
- Fit the existing architecture and the app's strict path-access security
  posture **without weakening it**.

## Non-goals

- Per-file sidebar state. (Earlier idea; dropped in favor of a global,
  VSCode-like workspace root.)
- Multi-root workspaces.
- File operations from the tree (create/rename/delete/move) — out of scope.
- Drag-and-drop reordering, search-in-tree, git decorations.

## Security model (decided: "picker-to-broaden")

This is the load-bearing part of the design; an earlier "auto-admit ancestors"
idea was rejected in review because it let the UI root expand the renderer's
**file-open authority** up to the whole filesystem. The corrected model keeps
the existing invariant intact:

> **Invariant (unchanged): file open/write authority is granted only by a
> trusted origin — the OS folder picker, the OS open dialog, the CLI argv, or
> drag-and-drop. The renderer can never admit a directory or file that a trusted
> origin did not.**

`PathScope` (`crates/pmd-app/src/path_scope.rs`) keeps its two existing sets:

- `allowed: HashSet<PathBuf>` — individual files admitted by trusted origin.
- `allowed_dirs: HashSet<PathBuf>` — directories admitted by the OS folder
  picker (and re-admitted on startup from `browser_base_dir`). Membership is
  **transitive**: any path under an allowed dir is in scope, which is what
  `request_open_file` relies on.

### The workspace root is a UI cursor, not a grant

The "workspace root" is **not** a new entry in `allowed_dirs`. It is a single
display/listing cursor that is **constrained to stay within the union of
already-granted `allowed_dirs`**. Moving it never grants new authority.

New `PathScope::workspace_root: Option<PathBuf>` (canonical) with:

- `set_workspace_root(path)`: canonicalize; **require** `is_within_allowed_dir`
  (already exists) to be true; on success store it and return canonical; on
  failure return a typed `OutsideGrantedDirs` error. The renderer cannot move
  the root outside what the user already granted.

Because the root can only ever sit inside granted dirs, `list_dir` and file
opens within it are already authorized by the existing model. No new listing or
open capability is created.

### Two explicit, modest policy additions

1. **Opening a file via a trusted origin grants its parent directory.** The only
   two **trusted, backend/OS-driven** admission points are the **CLI initial
   path** (`crates/pmd-app/src/cli.rs`) and the **OS open dialog**
   (`crates/pmd-app/src/cmd/file.rs`, the dialog path). At those two points only,
   when a file is admitted we also `allow_dir(parent_of_file)` via a shared
   helper. This is what makes the cold-start default work (open
   `~/proj/docs/readme.md` → its folder is granted → the sidebar can root there
   and the user can browse/open siblings).

   **Excluded — drag-and-drop.** In the real code, drop handling reads the path
   in the renderer and calls `request_open_file`, which is **renderer-driven and
   forgeable** (`crates/pmd-app/src/cmd/file.rs:168`). Drag-and-drop therefore
   does **not** carry a parent-dir grant; it keeps its current behavior of
   admitting only the dropped file. The parent-grant helper is deliberately
   **not** wired into `request_open_file` (nor any renderer path), so the
   renderer can never trigger a directory grant.

   **Root guard.** `allow_dir` of a filesystem **root** would grant the entire
   tree (membership is transitive). The parent-grant helper therefore **refuses
   to grant a filesystem-root parent**: if an opened file's canonical parent has
   no parent of its own (i.e. it is `/`), we grant only the file (existing
   behavior) and skip the dir grant. In that rare case the sidebar has no default
   root and shows a "Choose folder…" prompt.

   **Accepted risk.** Auto-granting a *non-root* parent of an explicitly,
   trusted-origin-opened file (e.g. opening `/etc/notes.md` grants `/etc`) is the
   intended, bounded tradeoff of the "picker-to-broaden" choice: the user
   deliberately opened a file there, and the grant only enables browsing/opening
   within that one folder — never an ancestor, never `/`.

2. **Climbing past the granted boundary uses the picker.** The **Up** action
   calls `set_workspace_root(parent)`. While the parent is still within a granted
   dir, it succeeds. When the parent would leave all granted dirs, the backend
   returns `OutsideGrantedDirs` and the frontend falls back to `pick_base_dir`
   (the OS folder picker), which grants the higher folder via the trusted origin
   and then roots there. Friction appears only at the boundary of what the user
   has granted.

### Why this is sound

- The renderer can never escalate: `set_workspace_root` is gated by
  `is_within_allowed_dir`; it cannot insert into `allowed_dirs`.
- `allowed_dirs` only grows from a trusted origin the renderer cannot forge: the
  OS folder picker, OS open dialog, or CLI argv. Drag-and-drop and
  `request_open_file` are renderer-driven and never grant a directory.
- `/` can enter `allowed_dirs` **only** by the user explicitly picking `/` in the
  OS folder picker. The parent-grant helper is root-guarded, so opening a
  root-level file can never produce a `/` grant.
- Symlink/canonicalization handling is unchanged (`list_dir` already
  canonicalizes entries and drops symlinks escaping the base).

## Core Model: one shared workspace browser

Today the **folder tab** owns its browser state inside `ui/src/file_browser.ts`
(base dir from `browser_base_dir`, an expanded `Set` persisted to `localStorage`
key `pmd:browser:expanded`, a selection, and a dir cache). Rather than create a
second parallel browser for the sidebar, lift that state into a **shared
workspace model** that both the sidebar and the folder tab render from.

Shared model (new `ui/src/workspace.ts`):

- `root: string | null` — current workspace root (canonical path).
- `expanded: Set<string>` — open directory paths (persisted, reuses
  `pmd:browser:expanded`).
- `selected: string | null` — **tree focus**: the row the user last clicked.
  Drives keyboard focus and the highlight for an explicit click; does not open.
- `activeFile: string | null` — **active-document highlight**: mirrors the
  active doc tab's path. Distinct from `selected` so the folder tab's
  click-to-select behavior and the sidebar's follow-active behavior do not fight
  (review NB2). Rendered as a separate, subtler highlight.
- `cache: Map<string, DirEntry[]>` — per-dir listing cache, keyed by canonical
  dir path.
- `onChange(cb)` — subscribers (sidebar view + folder-tab view) re-render.
- Actions: `setRoot(path)`, `navigateUp()`, `toggleDir(path)`, `select(path)`,
  `setActiveFile(path)`, `refresh(dir?)`, `revealFile(path)` (expand ancestors +
  set `activeFile`, only if under root).

The folder-tab body and the sidebar become **thin views** over this one model,
sharing the existing `renderRow` / `renderEntries` rendering.

### State-sync contract (review NB3)

- The model is the single source of truth; both views subscribe to `onChange`
  and fully re-derive their DOM from `root` + `expanded` + `selected` +
  `activeFile`. There is no cross-view mutation except through model actions.
- `cache` is keyed by canonical dir path and stays valid across root changes
  (the contents of a dir do not depend on which dir is the root); it is only
  invalidated by `refresh(dir)`.
- On `setRoot`, `expanded` is retained but only entries that are descendants of
  the new root are rendered; entries outside the new root are pruned lazily from
  `expanded` on next render so the persisted set does not grow unbounded.
- Concurrent renders are coalesced via the existing per-view render scheduling
  (re-render is idempotent given model state).

### Root lifecycle

- **Default**: on startup, after the initial file opens (which now also grants
  its parent dir), set the workspace root to that parent.
- **Sticky**: once a root exists, opening other files does not change it; the
  active file is merely revealed/highlighted (`revealFile`) if under the root.
- **Dynamic**:
  - **Up button** → `navigateUp()` → `set_workspace_root(parent)`; on
    `OutsideGrantedDirs` → `pick_base_dir`.
  - **Context menu → "Set as workspace root"** on any folder row → `setRoot`
    (always within a granted dir for a visible descendant).
  - **Change folder…** (sidebar header + existing folder-tab control) →
    `pick_base_dir` for jumping anywhere.
- **Persistence**: the root is persisted via the existing `browser_base_dir`
  field in `state.toml`.

## UI / Layout

### Sidebar panel and resizer geometry (review NB1)

The existing split resizer computes the editor/preview ratio against the whole
`#app-container` rect. Inserting a sidebar as a leading child would corrupt that
math. So we introduce a wrapper:

- `#app-container` (flex row) children become: `#pmd-sidebar`,
  `#sidebar-resizer`, `#main-region`.
- `#main-region` (flex row, `flex: 1`) holds the existing
  `#editor-pane`, `#split-resizer`, `#preview-pane`, `#pmd-tab-body`.
- The split-resizer ratio math is repointed to measure `#main-region`'s rect
  instead of `#app-container`'s, so editor/preview splitting is unaffected by the
  sidebar width.

Sidebar:

- Header row: workspace root folder name (truncating), an **Up** button, and a
  **Change folder…** button.
- Body: the shared tree (reuses `.pmd-browser-tree` row rendering).
- A `#sidebar-resizer` drag handle (mirrors `#split-resizer` behavior) adjusts
  sidebar width; width persisted globally in `localStorage`.
- Visibility is gated on a **global** flag, independent of
  `body.dataset.tabkind`, so the sidebar shows alongside doc, empty, and folder
  tabs alike. Collapsed via `display:none` (and the resizer hidden with it).

### Toggle + keybinding (review NB5)

- Add a real action `view.toggleSidebar` to the action registry
  (`ui/src/actions.ts`) with default keybinding **Ctrl+B** (currently unused),
  wired through `installActionHotkeys` so it participates in keybinding overrides
  and the command overlay — not an ad hoc key handler.
- A toolbar button invokes the same action and reflects current state.

### Context menu (review NB4)

- Right-click a **folder** row → a small menu reusing `.pmd-dropdown-menu`
  *styling* but with **explicit cursor positioning**: a reusable helper
  (`ui/src/context_menu.ts`) opens at viewport coordinates (`clientX`/`clientY`,
  `position: fixed`), calls `preventDefault()` on the `contextmenu` event (same
  pattern as `link_activation.ts`), and dismisses on outside-click / Escape /
  scroll. Items:
  - **Set as workspace root** → `model.setRoot(path)`.
  - **Reveal in file manager** → existing `reveal_in_folder` command.
- File rows keep their existing single/double-click open behavior; a right-click
  on a file may reuse the helper later but is out of scope here.

## State granularity (all window-global)

- Persisted in `state.toml`: workspace root (`browser_base_dir`).
- Persisted in `localStorage`: sidebar visible (`pmd:sidebar:visible`), sidebar
  width (`pmd:sidebar:width`), expanded set (existing `pmd:browser:expanded`).
- Transient only: `selected` (tree focus) and `activeFile` (active-doc
  highlight).
- No per-file sidebar state.

## Data flow

1. Startup: initial file opens via CLI/dialog → its parent dir is granted
   (unless root-guarded) → set workspace root to that parent. If root-guarded
   (file at `/`), no default root → "Choose folder…" prompt. Apply persisted
   visibility + width. If visible, render the tree (`list_dir`).
2. `Ctrl+B` / toolbar → `view.toggleSidebar` → update global flag + localStorage
   → show/hide panel.
3. **Up** → `navigateUp()` → `set_workspace_root(parent)`; success → re-list +
   both views re-render; `OutsideGrantedDirs` → `pick_base_dir` → on grant, root
   there.
4. Right-click folder → context menu → **Set as workspace root** → `setRoot`
   (within-grant) → re-list → both views re-render.
5. Activate a doc tab → if its path is under the root, `revealFile(path)`
   expands ancestors and sets `activeFile`.
6. Open a file from the tree (single/double-click) → existing `onOpenFile` path
   (file is under a granted dir, so authorized).

## Error handling

- `set_workspace_root` → `OutsideGrantedDirs` → sidebar falls back to
  `pick_base_dir`; if the user cancels, the root is unchanged and a brief inline
  notice explains why.
- Root path missing / unreadable at list time → inline notice; offer to pick.
- `list_dir` failures degrade gracefully (empty tree + message), as today.
- Escaping symlinks are already dropped by `list_dir`.

## Testing

- **Rust**
  - `set_workspace_root`: within a granted dir → OK + persists `browser_base_dir`;
    outside all granted dirs → `OutsideGrantedDirs`, and `allowed_dirs` is
    **unchanged** (no escalation).
  - Parent-grant: admitting a file via the CLI or OS-dialog path also adds its
    canonical parent to `allowed_dirs`; the renderer-driven `request_open_file`
    and drag-drop paths do **not** add new dirs.
  - Root guard: opening a file whose canonical parent is `/` admits the file but
    does **not** add `/` to `allowed_dirs`.
  - Regression: `set_workspace_root("/")` (or any non-granted ancestor) is
    rejected; the whole-filesystem-open escalation from reviews #1/#2 is
    impossible.
- **Frontend** (if a JS test harness exists — confirm during planning)
  - workspace model: `setRoot`, `navigateUp` (within-grant vs boundary),
    `toggleDir`, `revealFile` under/outside root, `select` vs `setActiveFile`
    independence, `expanded` pruning on `setRoot`.
  - context-menu helper positioning + action dispatch.

## Affected files

- New: `ui/src/workspace.ts`, `ui/src/context_menu.ts`; sidebar wiring + layout
  (`#main-region` wrapper, resizer repoint) in `ui/src/main.ts`; sidebar CSS in
  `ui/styles/components.css`; `view.toggleSidebar` in `ui/src/actions.ts`.
- Refactor: `ui/src/file_browser.ts` (folder-tab body becomes a view over the
  shared model).
- Rust: `crates/pmd-app/src/path_scope.rs` (`workspace_root` +
  `set_workspace_root` gated by `is_within_allowed_dir`; root-guarded
  parent-grant helper, e.g. `allow_file_and_parent`), wired into the CLI path
  (`crates/pmd-app/src/cli.rs`) and the OS-dialog path
  (`crates/pmd-app/src/cmd/file.rs`) — **not** `request_open_file` or drag-drop;
  `crates/pmd-app/src/main.rs` (register `set_workspace_root` command).
- Settings: `browser_base_dir` reused; no schema change expected.

---

--- SUMMARY ---

- **What**: A persistent VSCode-style left **folder sidebar** alongside the
  editor/preview, driven by a single window-global **dynamic workspace root**.
  The existing folder tab stays and becomes a second view over the same shared
  browser model (`ui/src/workspace.ts`).
- **Security (decided: picker-to-broaden)**: the workspace root is a **UI cursor
  constrained to stay within already-granted `allowed_dirs`** — it never expands
  authority. `set_workspace_root` is gated by the existing
  `is_within_allowed_dir`. Two explicit, modest additions: (1) opening a file via
  a **trusted origin — CLI or OS open dialog only** (drag-drop is excluded
  because it routes through the renderer-forgeable `request_open_file`) also
  grants its parent folder, **root-guarded** so a root-level file can never grant
  `/`; (2) climbing **Up** past the granted boundary falls back to the OS picker.
  This closes the review-#1/#2 escalations: the renderer can never climb into `/`
  or grant itself whole-filesystem open authority, and `/` enters `allowed_dirs`
  only by the user explicitly picking it.
- **Shared model**: `root`, `expanded` (reuses `pmd:browser:expanded`), `cache`,
  plus **two distinct** highlights — `selected` (tree click focus) and
  `activeFile` (follows the active doc) — so the two views don't fight (review
  NB2). Explicit state-sync + cache-invalidation contract (NB3).
- **Layout**: a new `#main-region` wrapper holds editor/split-resizer/preview so
  the split-ratio math is measured against it, not the whole container after the
  sidebar is inserted (NB1). `#pmd-sidebar` + `#sidebar-resizer` sit before it.
- **UI plumbing**: `Ctrl+B` via a real `view.toggleSidebar` action in the
  registry (NB5); context menu via a cursor-positioned helper reusing
  `.pmd-dropdown-menu` styling + the `link_activation` preventDefault pattern
  (NB4); "Set as workspace root" + "Reveal in file manager" items.
- **State**: window-global — root in `state.toml`; visibility, width, expanded
  set in `localStorage`. No per-file state.
- **Open question**: presence of a JS test harness (confirm during planning;
  Rust tests are definite).
