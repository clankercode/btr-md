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
- **State persistence precedent**: `state/recents.rs` and `state/settings.rs`
  persist **TOML** under the **btr-md XDG config dir** via
  `xdg::BaseDirectories::with_prefix("btr-md").place_config_file(...)` using
  `fs2` advisory file-locking, rewriting **in place** (`truncate(false)` +
  `set_len(0)` + `write_all`; `recents.rs:69-83`, `settings.rs:84-98`). The
  session store reuses the config-dir + `fs2`-locking part but persists JSON and
  **adds atomic temp+rename** instead of in-place rewrite (see Feature 2).
- **Doc registry internals** (`crates/pmd-app/src/doc/registry.rs:24-32`,
  `:75-90`): `DocEntry` holds `state: FileState`, `base_content: String` (the
  *merge ancestor* — last loaded/saved text), and `path`. It **deliberately does
  not store the live buffer text** — save/merge commands carry it in their
  payload. `register(path, contents)` yields `Clean{base}` (path) or `Untitled`
  (no path) **only** — there is no API to register a doc directly in a `Dirty` or
  `DiskChangedDirty` state.
- **Merge machinery** (`crates/pmd-app/src/cmd/doc.rs:205-230`): `three_way`
  merges `base_content_of(doc_id)` (text), the live buffer, and current disk.
  Reconstructing a dirty-with-conflict doc therefore requires the **baseline
  text**, not just a hash.
- **`FileState`** (`crates/pmd-app/src/doc/state.rs:90-127`): `Dirty{base,mem}`
  (local edits, disk unchanged), `DiskChangedDirty{base,disk,mem}` (conflict);
  `base`/`mem`/`disk` are `Digest`s. Untitled edits stay `Untitled`
  (`:189-199`); the UI renders untitled as *not modified*
  (`ui/src/doc_state.ts:61-65`).
- **Admission/security**: `request_open_file` admits a path via **three gates**
  (`cmd/file.rs:195-200`): already-scoped, present in recents, **or** under a
  folder the user admitted via the file-browser picker; `cmd::file` opens with
  `O_NOFOLLOW` on Unix. The session store must not become a path-admission
  bypass (see Security below).

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

## Feature 2 — Backend session store + restore command (Rust)

### Module: `crates/pmd-app/src/state/session.rs`

Persists the full session as **JSON** to `session.json` under the btr-md XDG
**config dir** (`BaseDirectories::with_prefix("btr-md").place_config_file(
"session.json")`, with the same graceful fallback `recents.rs`/`settings.rs` use
if XDG resolution fails — return an empty session, never panic). Reuses the
`recents.rs`/`settings.rs` config-dir + `fs2` advisory-locking pattern, but
serialises **JSON** via `serde_json` and **adds atomic temp+rename** (write
`session.json.tmp`, then `rename`) rather than the truncate-in-place rewrite
those files use (`recents.rs:69`, `settings.rs:84`) — the session payload is
larger, so atomic replace avoids a torn file on a crash mid-write.

### On-disk schema (serde)

```rust
struct Session {
    version: u32,                 // schema version, starts at 1
    docs: Vec<SessionDoc>,        // in tab order
    active: Option<ActiveTab>,    // which tab was focused
    browser_tab: bool,            // whether the file-browser tab was open
}

enum ActiveTab { Doc(usize), Browser }   // Doc -> index into `docs`

struct SessionDoc {
    path: Option<String>,             // absolute path for saved docs; None for untitled
    mode: String,                     // editor mode enum, serialized as today
    // Present iff there are edits to preserve:
    //   - untitled docs: always (the whole buffer)
    //   - saved docs with unsaved edits (Dirty / DiskChangedDirty)
    // Absent for clean saved docs (reopened from disk).
    unsaved: Option<UnsavedBuffer>,
}

struct UnsavedBuffer {
    content: String,                  // the live buffer text to restore
    // For saved docs: the merge-ancestor text (DocEntry.base_content at save
    // time), so restore can rebuild the exact merge baseline. None for untitled.
    baseline_content: Option<String>,
}
```

Notes:
- No `draft_id`: untitled docs are restored **positionally** in tab order; there
  is no cross-restart identity requirement (YAGNI — dropped per review).
- A clean saved doc stores only `path` + `mode`; it is reopened from disk, so no
  stale content copy is kept.
- The *merge ancestor* is text (`baseline_content`), not a hash — the merge
  machinery needs the actual baseline text (`cmd/doc.rs:205-230`). The
  disk-vs-baseline comparison at restore is done by hashing both with the same
  `Digest` the registry uses; no separate stored hash is needed.
- Sizes: markdown documents are small; inline strings in one JSON file are fine.
  No per-draft files (YAGNI).

### Building the payload — who owns what

The registry **does not hold live buffer text**, and the frontend **does not
hold the merge baseline**. So `save_session` is split by ownership:

- **Frontend supplies** (per open doc): the backend `doc_id`, `mode`, and the
  **live buffer** snapshot (`content`) for **every** doc (not only the ones it
  thinks are dirty); plus tab order, active tab, browser flag. See Feature 3 for
  how buffers are snapshotted.
- **Backend decides dirtiness by content comparison** (in `save_session`, by
  `doc_id` lookup): it reads `path`, `FileState`, and `base_content` from the
  registry, then compares the **supplied live `content`** against `base_content`:
  - untitled (no path) → always persist `content` (no `baseline_content`).
  - saved, `content == base_content` → **clean**: persist `path` + `mode` only,
    omit `unsaved` (reopened from disk on restore).
  - saved, `content != base_content` → **dirty**: persist `content` +
    `baseline_content = base_content`.

  `DiskChangedClean` (`mem == base`, `disk != base` — file changed externally
  but the user has no local edits) compares equal and is therefore persisted as
  clean and reopened from current disk content on restart. This is an
  **accepted, deliberate** behavior: there are no unsaved user edits to lose, and
  adopting the current on-disk content on a fresh launch is the sensible default —
  the only thing not carried across restart is the *unacknowledged-change* status
  itself, which is not worth persisting. (See "Restore" and Out of scope.)

  Comparing supplied content to `base_content` — rather than reading the registry
  `FileState` — is deliberate: `FileState` becomes `Dirty` only after the
  **debounced** `doc_edited` IPC lands (`main.ts:618-632`), so an edit made inside
  that window would otherwise be serialised as clean. Content comparison has no
  such race (`base_content` only changes on load/save, which are not debounced).

`save_session` payload (Tauri command input), one entry per open doc:
`{ doc_id: u64, mode: String, content: String }` + `active`, `browser_tab`. The
backend assembles `Session` and writes it.

### Tauri commands

- `save_session(docs: Vec<SaveDocInput>, active: ActiveTab, browser_tab: bool)
  -> Result<(), String>` where `SaveDocInput = { doc_id, mode, content }` — for
  each input, looks up the registry entry by `doc_id` for `path` + `base_content`,
  then decides clean/dirty by comparing the supplied `content` to `base_content`
  (see "Building the payload"); assembles `SessionDoc` (omitting `unsaved` for
  clean saved docs); writes atomically under lock. Unknown `doc_id` entries are
  skipped (tab closed mid-flush). Registered in `main.rs`.
- `load_session() -> Session` — reads + parses; missing/corrupt/unparseable →
  `Session::default()` (empty), warn-logs, never panics, does not delete the file.
- `restore_dirty_doc(app, state, path: PathBuf, content: String,
  baseline_content: String, background: bool) -> Result<OpenedDoc, String>` —
  the missing API for reconstructing a dirty/conflict doc authoritatively:
  1. Canonicalise + run the **same admission gates as `request_open_file`**
     (`cmd/file.rs:188-205`: already-scoped OR in recents OR under an allowed
     dir; markdown-extension check). Reuse a shared admission helper extracted
     from `request_open_file` (refactor, no behavior change).
  2. Read current disk content. If the file is missing/unreadable → return `Err`
     (frontend falls back to restoring as an untitled buffer with `content`).
  3. Compute `base = Digest::of(&baseline_content)`, `mem = Digest::of(&content)`,
     `disk = Digest::of(&disk_text)`.
  4. State = `Dirty{base,mem}` if `disk == base`, else
     `DiskChangedDirty{base, disk, mem}`.
  5. Register via a new `DocRegistry::register_restored(path, base_content =
     baseline_content, state) -> DocId` that inserts a `DocEntry` with an
     explicit state + base text (the only new registry method). Start the watcher
     (`watcher.set_target`) and honor `background` for save authority, exactly as
     `register_opened` does.
  6. Return `OpenedDoc` whose `contents` is the **live buffer** (`content`) so the
     frontend seeds the editor with the unsaved text, and whose `state` is the
     reconstructed `FileState`.

### Security / admission (corrected)

- `save_session` and `load_session` **never mutate scope or recents**. They only
  read/write `session.json`.
- Restore does **not** seed paths into scope/recents. Saved-clean docs are
  reopened with the unchanged `request_open_file`; saved-dirty docs go through
  `restore_dirty_doc`, which applies the **identical** admission gates. Because a
  previously-opened path is already in the persisted recents list
  (`recents.toml`), it is admissible on the next launch without any seeding.
- A path that is no longer admissible (not scoped, not in recents, not under an
  allowed dir) is **rejected** by the command and the frontend skips that doc —
  same outcome as today. Asserted by a test.
- Untitled docs carry only `content` (no path) and are registered via
  `register_doc`; no admission risk.

### Tests (`pmd-app`)

- Session roundtrip: serialize → write → read → equal (untitled, clean-saved,
  dirty-saved with `baseline_content`).
- Atomicity: write leaves no `.tmp`; an existing valid file is not corrupted.
- Corrupt/missing recovery: garbage `session.json` → `load_session` returns empty
  default; file not deleted.
- `restore_dirty_doc` state reconstruction: `disk == baseline` → `Dirty`;
  `disk != baseline` → `DiskChangedDirty` with the right `base`/`disk`/`mem`
  digests and `base_content == baseline_content` (so a subsequent merge uses the
  correct ancestor).
- Admission: `restore_dirty_doc` with a non-admissible path returns `Err` and
  does not register a doc (mirrors `recents.rs`/`request_open_file` admission
  test style).

## Feature 3 — Frontend session restore (replaces localStorage)

### Snapshotting buffers

The current text of an open doc lives in two places (`ui/src/tabs.ts:21-24`,
`ui/src/editor.ts`): the **active** tab's text is in the mounted CodeMirror
editor; **inactive** tabs hold their last `editorState`. A `tabBuffer(tab)`
helper returns the live text:

- active doc → `editor.getValue()`;
- inactive doc → `tab.editorState.doc.toString()`.

The live `content` is sent for **every** open doc (browser tab excluded). The
backend — not the frontend — decides clean vs dirty by comparing `content` to the
registry `base_content` (see Feature 2), which avoids the debounced-`doc_edited`
race. Document buffers are small, so sending clean content too is acceptable.

### Save

Replace `saveSession`/`SESSION_KEY`/`localStorage` (`main.ts:1025-1095`) with a
backend-backed version. Still debounced (~300ms) and called from the existing
sites (tab add/close/switch, mode change, base-dir change) **plus the edit
handler** (`main.ts:618-625`), which currently does *not* trigger a session save
— a `saveSession()` call is added there so dirty buffers are captured as they
change.

Payload per open doc: `{ doc_id, mode, content: tabBuffer(tab) }` (content for
every doc); plus `active` (`{Doc:index}` or `Browser`) and `browser_tab`. Persist
via `invoke('save_session', { docs, active, browserTab })`. The backend fills
`path`, decides dirtiness, and stores `baseline_content` (see Feature 2).

A **flush on window close** is added so edits inside the debounce window are not
lost:

- Add a `flush()` method to `ui/src/debounce.ts` (alongside the existing
  `cancel()`) that runs the pending call immediately and returns its promise.
- Use Tauri's window `onCloseRequested` (from `@tauri-apps/api/window`): prevent
  the default close, `await flushSessionNow()` (which builds the payload and
  awaits `save_session`), then programmatically close. This guarantees the final
  write completes before exit — `beforeunload` cannot await async IPC reliably,
  so `onCloseRequested` is the mechanism.

### Restore (`restoreSession`)

`invoke('load_session')` returns the `Session`; for each `SessionDoc` in order:

- **Untitled** (`path === null`, `unsaved` present): `register_doc` with
  `unsaved.content`, add an "Untitled" tab, restore `mode`, seed the editor with
  the content. (Untitled stays `FileState::Untitled`; the UI shows it unmodified,
  unchanged from today — see "Untitled semantics" below.)
- **Saved, clean** (`unsaved` absent): `openFile(path, {background:true})`
  (reopens from disk), restore `mode`. Non-admissible path → skip (as today).
  (A doc that was `DiskChangedClean` last session falls here — it reopens at the
  current disk content; the unacknowledged-change status is intentionally not
  restored, since no unsaved edits exist.)
- **Saved, dirty** (`unsaved` present, `path` set): call
  `restore_dirty_doc({ path, content: unsaved.content, baselineContent:
  unsaved.baseline_content, background:true })`. The backend reconstructs the
  authoritative `FileState` (`dirty` or `disk_changed_dirty`) with the correct
  merge baseline; the frontend seeds the editor with the returned live buffer and
  reflects the returned `fileState`. If the command errors (file gone /
  non-admissible), fall back to restoring the content as an **untitled** buffer
  so unsaved work is never silently dropped.

After opening all docs, restore the active tab / browser tab from `active` /
`browser_tab`. Per-doc failures are isolated (try/catch per doc) so one bad entry
never aborts the whole restore.

### Untitled semantics

"Unsaved" in the session schema means "**has buffer content that must be
persisted**" — it is **not** the `FileState` modified flag. Untitled docs are
always persisted-with-content and remain `FileState::Untitled` on restore (the UI
continues to render them as not-modified, matching `ui/src/doc_state.ts:61-65`).
No change to the untitled state machine or its modified-indicator is made.

### Tab model

`restore_dirty_doc` and `register_doc` both return a `doc_id` that the tab store
already tracks (`tab.docId`, used by `drop_doc`). No new tab field is required —
`doc_id` is the identity used by `save_session`. (No `draftId` is added.)

### Migration

None. The previous `localStorage['pmd:session']` only ever stored saved-file
paths; on first launch after upgrade the backend session is empty and the app
opens to the welcome screen (or a CLI/`open-file` path). The one-time cost is a
single lost session of *saved-only* paths, which is acceptable and avoids
carrying dead migration code. The stale `localStorage` key is removed on first
run.

## Architecture / data flow

```
 Drag over window ─▶ drag_overlay.ts ─(valid/reject)▶ overlay element
 Drop ─▶ main.ts open logic ─▶ openFile / register_doc ─▶ backend doc registry

 Edit / tab change ─▶ saveSession (debounced) ─▶ invoke save_session(docs,active,browser)
   (live buffers)                                       │ backend adds path + baseline_content
                                                        ▼  (from registry, by doc_id)
                                            state/session.rs  ──▶ session.json (XDG config, locked, atomic)
 Window close ─▶ onCloseRequested ─▶ flushSessionNow ─▶ save_session ─▶ (then close)

 Launch ─▶ bootstrap ─▶ load_session ─▶ restoreSession, per doc:
            untitled ─▶ register_doc(content)
            clean    ─▶ request_open_file (from disk)
            dirty    ─▶ restore_dirty_doc(path, content, baseline_content)
                            └─▶ Dirty | DiskChangedDirty (authoritative, correct merge ancestor)
```

## Components and responsibilities

| Unit | Responsibility | Depends on |
|---|---|---|
| `ui/src/drag_overlay.ts` (new) | overlay element, drag counter, validity calc, show/hide | injected open callbacks |
| `ui/src/main.ts` (edit) | wire overlay; replace session save/restore with backend calls; `tabBuffer`; close-flush | drag_overlay, tabs store, invoke, tauri window |
| `ui/src/debounce.ts` (edit) | add `flush()` | — |
| `crates/pmd-app/src/state/session.rs` (new) | load/save Session JSON to XDG config, locked+atomic | fs2, xdg, serde_json |
| `crates/pmd-app/src/doc/registry.rs` (edit) | `register_restored(path, base_content, state)` | FileState |
| `crates/pmd-app/src/cmd/*` + `main.rs` (edit) | `save_session` (enrich by doc_id), `load_session`, `restore_dirty_doc`; shared admission helper | session.rs, registry, path_scope |
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
- Not preserved across restart: the `DiskChangedClean` *unacknowledged-external-
  change* status. Such docs (no local edits) reopen from current disk content.
  Only unsaved **user edits** (dirty / untitled / `DiskChangedDirty`) are
  preserved exactly.

## Implementation plan / parallelism

- **Task A (backend session store + commands)** — `session.rs`, schema,
  `register_restored`, shared admission helper, `save_session` / `load_session` /
  `restore_dirty_doc`, command registration + tests. Independent.
- **Task B (drag overlay)** — `drag_overlay.ts` + CSS + main.ts wiring + unit
  tests. Independent.
- **Task C (frontend restore)** — `tabBuffer`, replace session save/restore with
  backend calls, `debounce.flush()`, `onCloseRequested` flush, restore dispatch.
  Depends on A (its commands).

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
  `session.json` (JSON via `serde_json`) to the btr-md XDG **config dir** using
  `fs2` locking + atomic temp+rename, reusing the `recents.rs` IO pattern. Schema
  stores per-doc path-or-null, mode, and an optional `unsaved` buffer (live
  `content` + the merge-ancestor `baseline_content` text) — present only for
  untitled/dirty docs. No `draft_id` (untitled restored positionally).
- **Ownership split**: the registry holds the merge baseline but not live text;
  the frontend holds live text but not the baseline. So `save_session` takes
  `{doc_id, mode, content}` (content for every doc) from the frontend; the backend
  looks up `path` + `base_content` by `doc_id` and decides clean/dirty by
  **comparing the supplied content to `base_content`** (not by reading the
  debounced `FileState`, which would race the edit pipeline).
- **Authoritative dirty restore**: a new `restore_dirty_doc` command rebuilds a
  saved-dirty doc in the registry with the correct `base_content` text and the
  right `FileState` (`Dirty` if disk == baseline, else `DiskChangedDirty`), via a
  new `register_restored` registry method — because `register` only yields
  `Clean`/`Untitled` and the merge machinery needs baseline *text*, not a hash.
  Reconstructing state in the frontend alone would desync save/merge.
- **Restore (frontend)**: replaces `localStorage`. `tabBuffer(tab)` snapshots
  live text (active = `editor.getValue()`, inactive = `editorState.doc`).
  Untitled → `register_doc`; clean saved → `request_open_file` (from disk);
  dirty saved → `restore_dirty_doc` (falls back to an untitled buffer if the file
  is gone/non-admissible, never dropping unsaved work). `debounce.flush()` +
  Tauri `onCloseRequested` guarantee a final save before exit.
- **Security**: `save_session`/`load_session` never touch scope/recents; restore
  seeds nothing. Restored paths are admissible only because they persist in
  `recents.toml`; `restore_dirty_doc` applies the **same** admission gates as
  `request_open_file`; non-admissible paths are rejected/skipped (asserted).
- **Decisions (confirmed)**: persist to backend disk; reuse `disk_changed_dirty`
  on restore conflict; full-window overlay; show reject state for non-markdown.
- **Parallelism**: Task A (backend store + commands) ‖ Task B (overlay), then
  Task C (frontend restore, depends on A). TDD per task; 2-thread build/test
  limit.
- **No migration**: the old localStorage session held only saved paths; dropping
  it costs at most one session of saved-only paths on upgrade. Stale key removed.
