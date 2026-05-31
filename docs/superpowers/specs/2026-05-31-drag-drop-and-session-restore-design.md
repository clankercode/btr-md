# Drag-to-open + full session restore — design spec

Date: 2026-05-31
Branch: `feat/drag-drop-open`
Status: design (pending review)

## Summary

Two related UX features for the btr-md (preview-md) Tauri app:

1. **Drag-to-open with visual indicator** — when a markdown file is dragged over
   the window, show a full-window overlay indicating it will be opened; open it
   (them) on drop. The drop-to-open path already works functionally; this adds
   the missing *visual affordance* and a reject state for non-markdown payloads.

2. **Full session restore** — persist the complete editing session (open files,
   untitled documents, and unsaved/dirty buffer contents) to disk so the exact
   state is restored on the next launch. Today only saved-file *paths* are
   persisted (in `localStorage`); untitled docs and in-memory edits are lost.

The backend (Rust) becomes the source of truth for the session, replacing the
frontend `localStorage` session store.

## Current state (what exists today)

- **Drag/drop** (`ui/src/main.ts:305-338`): bare `dragover` (preventDefault) and
  `drop` handlers. On drop, opens the **first** dragged file if its name is
  markdown (via `openFile(path)` → `request_open_file`), else shows an error
  toast. No visual indicator during the drag.
- **Session persistence** (`ui/src/main.ts:1025-1095`): a debounced `saveSession`
  writes `{ docs: [{path, mode}], browser, activePath, activeKind }` to
  `localStorage['pmd:session']`. `restoreSession` reopens each path from disk
  via `openFile(..., {background:true})`. **Untitled docs are skipped** (no
  path); **dirty edits are lost** (content re-read from disk).
- **Doc model**: backend `doc::registry` holds doc entries keyed by `DocId`;
  frontend `tabs.ts` `store` tracks tabs with `filePath` (empty for untitled),
  `mode`, and `fileState` (a `FileState` discriminated union including `dirty`
  and `disk_changed_dirty`). `register_doc` registers an untitled/in-memory doc;
  `request_open_file` admits a path (scope-checked) and opens it.
- **State persistence precedent**: `state/recents.rs` persists a JSON list under
  the **btr-md XDG dir** (`xdg::BaseDirectories::with_prefix("btr-md")`) using
  `fs2` advisory file-locking. This is the pattern the session store follows.
- **Admission/security**: `request_open_file` only admits paths already in scope
  or present in recents; `cmd::file` opens with `O_NOFOLLOW` on Unix. The
  session store must not become a path-admission bypass (see Security below).

## Feature 1 — Drag-to-open visual indicator

### Behavior

A drag state machine on `document` events:

- `dragenter` / `dragover`: show a **full-window overlay** (a single fixed
  element, hidden by default). Determine validity from `DataTransfer`:
  - If any item looks like markdown → **valid** state: dimmed backdrop +
    centered drop zone reading "Drop to open".
  - If the payload is determinable and contains **no** markdown → **reject**
    state: red-tinted backdrop, "Not a markdown file" message, `dropEffect =
    'none'` (no-drop cursor).
  - **Detection caveat**: during dragover, browsers expose `DataTransfer.items`
    with `kind`/`type` (MIME) but **not** file names (names are only available
    on `drop`). Markdown often has an empty or `text/markdown` MIME. Detection
    rule: treat as **valid** when at least one item is `kind === 'file'` and its
    `type` is empty or matches `text/markdown` / `text/x-markdown` / `text/plain`;
    treat as **reject** only when items are present and **all** file items have a
    non-markdown MIME (e.g. `image/*`, `application/pdf`). When undeterminable,
    default to **valid** and let the drop handler reject by extension.
- `dragleave`: hide the overlay only when the drag actually leaves the window
  (guard against child-element `dragleave` noise using a drag counter, or check
  `relatedTarget === null` / coordinates outside the viewport).
- `drop`: hide overlay; iterate **all** dragged files. For each file whose name
  is markdown (`isMarkdownFileName`), open it; the first opens focused, the rest
  background. Non-markdown files produce one error toast (existing behavior).
  Preserve the existing fallback for files without a `.path` (webview-provided
  blob → `register_doc` with `file.text()`).
- `dragend` (and `drop`): always reset the drag counter and hide the overlay.

### Implementation

- New module `ui/src/drag_overlay.ts`: owns the overlay element, the drag
  counter, validity computation, and show/hide. Exposes
  `installDragOverlay(onOpenFiles, onOpenBlob, showError)` (callbacks injected so
  the module has no import cycle with `main.ts`).
- `main.ts` wires it: replaces the inline `dragover`/`drop` handlers (305-338).
  The actual open logic stays in `main.ts` (reuses `openFile` / `addDocTab`).
- CSS in `ui/styles/` (new rules, themed via existing CSS custom properties for
  background/accent/danger). Overlay uses `pointer-events: none` on its content
  so it never interferes with drag events; the backdrop sits above app content
  with a high `z-index`.
- `isMarkdownFileName` already exists and is reused; no MIME allow-list is
  trusted for the actual open decision — extension is the gate on drop.

### Tests

- Unit (vitest, alongside existing `*.test.ts`): validity computation given
  synthetic `DataTransferItem`-like inputs (markdown → valid, image-only →
  reject, empty/unknown → valid). Drag-counter enter/leave bookkeeping.
- Manual / e2e (best-effort): overlay appears on dragenter and clears on drop —
  Playwright drag simulation of real file drops over a webview is unreliable, so
  this is validated manually; the unit tests cover the decision logic.

## Feature 2 — Backend session store (Rust)

### Module: `crates/pmd-app/src/state/session.rs`

Persists the full session to `session.json` under the btr-md XDG **state** dir
(`BaseDirectories::with_prefix("btr-md").place_state_file("session.json")`, with
the same graceful fallback `recents.rs` uses if XDG resolution fails). Uses
`fs2` advisory locking and atomic write (write to `session.json.tmp`, then
`rename`), mirroring `recents.rs`.

### On-disk schema (serde)

```rust
struct Session {
    version: u32,                 // schema version, starts at 1
    docs: Vec<SessionDoc>,        // in tab order
    active: Option<usize>,        // index into docs of the active tab, or None
    browser_tab: bool,            // whether the file-browser tab was open
    active_is_browser: bool,      // browser tab was the active one
}

struct SessionDoc {
    draft_id: String,             // stable id, also identifies untitled docs across restarts
    path: Option<String>,         // absolute path for saved-file docs; None for untitled
    mode: String,                 // editor mode enum, serialized as today
    dirty: bool,                  // buffer differs from last-saved/disk baseline
    content: Option<String>,      // present iff dirty || path.is_none(); the buffer to restore
    baseline_hash: Option<String>,// blake3 of the content that was last in sync with disk
                                  // (for saved docs); used to detect on-disk change at restore
}
```

Notes:
- `content` is only stored when needed (untitled, or dirty saved file). A clean
  saved-file doc stores just `path` + `mode` and is reopened from disk — keeping
  the file small and avoiding stale copies.
- `baseline_hash` records what the on-disk content was when the buffer was last
  in sync, so restore can detect whether the file changed underneath us. `blake3`
  is already a workspace dependency.
- Sizes: markdown documents are small; inline `content` strings in one JSON file
  are acceptable. No separate per-draft files (YAGNI).

### Tauri commands

- `load_session() -> Session` — reads and parses; on missing/corrupt/unparseable
  file returns `Session::default()` (empty) and logs a warning. Never panics.
- `save_session(session: Session) -> Result<(), String>` — validates and writes
  atomically under lock. Registered in `main.rs` command list.

### Security / admission

- The session store is **not** a trusted path-admission source by itself. On
  restore, saved-file paths are opened through the **existing** admission flow:
  the backend seeds restored paths into the recents/scope set the same way the
  current localStorage restore relies on `request_open_file` admitting recents.
  Concretely: a restored path is admitted only if it is already admissible
  (in recents or scope). Paths that are no longer admissible are skipped, exactly
  as today. This is asserted by a test.
- Untitled docs carry only `content` (no path), so they pose no admission risk;
  they are registered via `register_doc`.

### Tests (`pmd-app`)

- Roundtrip: serialize → write → read → equal (incl. untitled + dirty docs).
- Atomicity: a write does not corrupt an existing file if interrupted before
  rename (tmp+rename invariant; test the rename path leaves no `.tmp`).
- Corrupt/missing recovery: garbage `session.json` → `load_session` returns empty
  default, file is not deleted unexpectedly.
- Admission: a restored path that is not in recents/scope is not silently
  admitted (mirrors `recents.rs` admission test style).

## Feature 3 — Frontend session restore (replaces localStorage)

### Save

Replace `saveSession`/`SESSION_KEY` (`main.ts:1025-1095`) with a backend-backed
version (still debounced ~300ms, called from the same sites: tab add/close/
switch, mode change, edit). It builds the `Session` payload:

- For each tab in order: emit a `SessionDoc`.
  - Saved-file doc, clean → `{path, mode, dirty:false}`.
  - Saved-file doc, dirty → `{path, mode, dirty:true, content:<buffer>,
    baseline_hash:<hash of last-synced disk content>}`.
  - Untitled doc → `{path:null, draft_id, mode, dirty:true, content:<buffer>}`.
- `active`, `browser_tab`, `active_is_browser` as today.
- Persist via `invoke('save_session', { session })`.

A **flush on window close** is added: a `beforeunload` / Tauri close handler
invokes a final synchronous-ish `save_session` (cancel the debounce and write
immediately) so the last edits are not lost if the user quits within the debounce
window.

### Restore (`restoreSession`)

For each `SessionDoc` in order:

- **Untitled** (`path === null`): recreate via `register_doc` with stored
  `content`, add a tab titled "Untitled", mark dirty, restore `mode` and
  `draft_id`.
- **Saved, clean**: `openFile(path, {background:true})` (reopens from disk),
  restore `mode`. If the path is no longer admissible, skip (as today).
- **Saved, dirty**: open the doc, then restore the dirty buffer (`content`) into
  the editor and mark dirty. Determine on-disk change by comparing current disk
  content hash to `baseline_hash`:
  - **Unchanged on disk** → plain `dirty` state with the restored buffer.
  - **Changed on disk** → set `disk_changed_dirty` and route through the
    **existing** merge/race machinery (the same path used when a file changes on
    disk while the app runs). No new conflict UI is introduced.

Restore the active tab / browser tab afterward, as today.

### Migration

- One-time read of the old `localStorage['pmd:session']` on first launch after
  upgrade: if present and the backend session is empty, import paths+modes, then
  remove the localStorage key. After that, the backend store is authoritative.
  (Low-risk convenience; can be dropped if it complicates review — the worst case
  without it is one lost session of saved-only paths on upgrade.)

## Architecture / data flow

```
 Drag over window ─▶ drag_overlay.ts ─(valid/reject)▶ overlay element
 Drop ─▶ main.ts open logic ─▶ openFile / register_doc ─▶ backend doc registry

 Edit / tab change ─▶ saveSession (debounced) ─▶ invoke save_session
                                                       │
                                                       ▼
                                            state/session.rs  ──▶ session.json (XDG, locked, atomic)
 Launch ─▶ bootstrap ─▶ invoke load_session ─▶ restoreSession ─▶ tabs + editor
                                   │ saved+dirty & disk changed
                                   ▼
                          existing disk_changed_dirty / merge machinery
```

## Components and responsibilities

| Unit | Responsibility | Depends on |
|---|---|---|
| `ui/src/drag_overlay.ts` (new) | overlay element, drag counter, validity calc, show/hide | injected open callbacks |
| `ui/src/main.ts` (edit) | wire overlay; replace session save/restore with backend calls | drag_overlay, tabs store, invoke |
| `crates/pmd-app/src/state/session.rs` (new) | load/save Session to XDG json, locked+atomic | fs2, xdg, serde, blake3 |
| `crates/pmd-app/src/cmd/*` + `main.rs` (edit) | register `load_session`/`save_session` commands | session.rs |
| `ui/styles/*` (edit) | overlay styling, themed | CSS vars |

## Error handling

- Overlay: any exception in validity computation defaults to **valid**; drop
  rejection falls back to the extension check + error toast.
- `load_session`: missing/corrupt → empty session, warn-log, never panic.
- `save_session`: lock/IO failure → return `Err(String)`; frontend ignores
  (same fault-tolerance as the current localStorage `catch {}`).
- Restore: per-doc failures are isolated (try/catch per doc); a bad entry skips
  that doc and continues, never aborting the whole restore.

## Out of scope (YAGNI)

- No multi-window session support (app is single-window).
- No separate per-draft content files / content-addressed store — one json file.
- No new merge/conflict UI — reuse `disk_changed_dirty`.
- No drag-to-reorder or drag-into-specific-pane; only drag-to-open.

## Implementation plan / parallelism

- **Task A (backend session store)** — `session.rs` + commands + tests.
  Independent.
- **Task B (drag overlay)** — `drag_overlay.ts` + CSS + main.ts wiring + unit
  tests. Independent.
- **Task C (frontend restore)** — replace session save/restore; depends on A.

Order: A ‖ B in parallel, then C. Each task is TDD (tests first where the harness
allows). Per repo norms, builds/tests limited to 2 threads.

--- SUMMARY ---

- **Goal**: (1) show a full-window overlay when a markdown file is dragged over
  the window and open it/them on drop, with a reject state for non-markdown; (2)
  persist and restore the *complete* session — open files, untitled docs, and
  unsaved/dirty buffer contents — across restarts.
- **Drag (frontend only)**: a `drag_overlay.ts` state machine over
  dragenter/over/leave/drop/dragend driving one fixed overlay element. Validity
  is inferred from `DataTransfer` MIME/`kind` during dragover (names unavailable
  then), defaulting to valid when unknown; the real gate is the extension check
  on drop. Opens all dragged markdown files (first focused, rest background).
- **Session store (backend, new source of truth)**: `state/session.rs` writes
  `session.json` to the btr-md XDG dir using `fs2` locking + atomic temp+rename,
  mirroring `recents.rs`. Schema stores per-doc path-or-null, stable `draft_id`,
  mode, dirty flag, buffer `content` (only when untitled/dirty), and a `blake3`
  `baseline_hash`. New `load_session`/`save_session` Tauri commands; corrupt/
  missing → empty default, never panics.
- **Restore (frontend)**: replaces the `localStorage` session. Recreates untitled
  docs from stored buffers; reopens clean saved docs from disk; for dirty saved
  docs restores the buffer and, when the file changed on disk (hash ≠ baseline),
  routes through the **existing** `disk_changed_dirty`/merge machinery — no new
  conflict UX. Adds a flush-on-close. One-time localStorage→backend migration.
- **Security**: the session store is not a path-admission bypass — restored paths
  are admitted only through the existing recents/scope flow; non-admissible paths
  are skipped (asserted by test). Untitled docs carry only content.
- **Decisions (confirmed)**: persist to backend disk; reuse `disk_changed_dirty`
  on restore conflict; full-window overlay; show reject state for non-markdown.
- **Parallelism**: Task A (backend store) ‖ Task B (overlay), then Task C
  (frontend restore, depends on A). TDD per task; 2-thread build/test limit.
- **Open question**: keep or drop the one-time localStorage→backend migration
  (low risk; worst case is one lost session of saved-only paths on upgrade).
