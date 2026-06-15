# Multi-Window Session Restore — Design

Status: DRAFT — awaiting user review of written spec.
Date: 2026-06-15
Repo: btr.md / preview-md (Tauri: Rust `crates/pmd-app`, TS+Vite `ui/src`)
Architecture review: Codex `@cx-reviewer` — verdict PARTIAL; findings folded in (see Appendix A).

## Goal

Track which windows and tabs are open and, on startup with **no other instance
running and no CLI file argument**, restore every window with its tabs —
**including unsaved documents** (VSCode-like).

## Current state (verified against source)

A **single-window** session restore already exists end-to-end:

- `crates/pmd-app/src/state/session.rs:24-40` — `~/.config/btr-md/session.json`
  (XDG), atomic temp+rename + `fs2` advisory lock. Flat `Session{version, docs,
  active, browser_tab}`, `SessionDoc{path, mode, unsaved{content,
  baseline_content}}`, `SESSION_VERSION = 1`. Unsaved buffers persisted.
- `crates/pmd-app/src/cmd/session.rs:80-96` — `save_session` enriches the
  frontend-supplied per-doc buffers and writes the whole session (full replace).
- `ui/src/session_manager.ts:55-70` — frontend assembles the **entire** global
  payload from its single tab store. `installCloseFlush` (`:158-170`):
  `onCloseRequested` → `flushSessionNow` → `destroy()`. Debounced 300ms save.
- `ui/src/session.ts` — `classifyRestore` → untitled / clean (reopen from disk) /
  dirty (`restore_dirty_doc`, falls back to untitled if file gone → unsaved work
  never lost).
- `crates/pmd-app/src/doc/registry.rs:50-53` — `active: Mutex<Option<DocId>>`
  (single, process-global). `set_active`/`is_active` `:260-275`; `save_doc`
  refuses non-active docs (`cmd/doc.rs:111-117`).
- Single window only: `main.rs:141` builds one webview `"main"`,
  `on_new_window → Deny` (`:146`). `tauri.conf.json` `windows: []`.
- Single-instance plugin (`main.rs:47-72`): 2nd launch forwards file args via
  **global** `app.emit("open-file", …)` (`:62`); every frontend listens
  (`ui/src/main.ts:2293`); then unminimize/show/focus `"main"` (`:67-70`).
- Capabilities: `capabilities/default.json:5` `windows: ["main"]`, grants
  `allow-close`/`allow-destroy`. `core:window:default` already includes the
  `allow-inner/outer-position`, `allow-inner/outer-size`, `allow-is-maximized`
  *readers* (desktop-schema `:1254-1257`) — but NOT the `set_*`/`create` writers.
- Asset grants are keyed by `window_label` + `doc_id`
  (`crates/pmd-app/src/preview/grants.rs:16-21,102-129`).

The core (tabs + unsaved restore) already works for **one** window. This feature
adds **multiple windows**, end to end.

## Decisions (from brainstorming + review)

- **Scope**: real multi-window support + per-window restore.
- **Window creation is Rust-side** via a `new_window` command (avoids granting the
  frontend create-window permission; keeps geometry/spawn logic backend-side).
- **New-window triggers (v1)**: Ctrl+Shift+N + command-overlay entry; bare
  taskbar relaunch (middle-click) → new window.
- **File routing (2nd instance)**: reuse-if-open (focus owner window + activate
  tab, via backend path→owner lookup) else forward to MRU-focused window as a new
  tab, using **targeted** `window.emit`.
- **Restore fidelity**: all windows + their tabs (incl. unsaved) + window geometry
  + active tab per window + focused window.
- **Save authority**: per-window doc **ownership** enforced across all
  doc-mutating commands.
- **Close All Windows** file-menu item (deliberate "save whole workspace").
- **Deferred to phase 2**: "Move to New Window" (shown **grayed-out** in the tab
  context menu as an affordance) and drag-tab-out.

## 1. Architecture overview

Single process remains source of truth. `DocRegistry` stays process-global; a doc
lives in exactly one window (consistent with reuse-if-open). Four structural shifts:

1. **Window identity** — Rust assigns each webview a unique stable label
   (`main`, `w-2`, `w-3`, … — monotonic, never reused within a run). Frontend
   reads its own via `getCurrentWindow().label`.
2. **Per-window doc ownership** — `DocEntry` gains `owner_window: String`. The
   single `active: Mutex<Option<DocId>>` becomes `active: Mutex<HashMap<WindowLabel,
   DocId>>`. **Every** doc-mutating command takes the calling `tauri::Window` and
   checks `owner_window == caller` (and, for save, that the doc is the caller's
   active doc): `save_doc`, `set_active_doc`, `doc_edited`, `pull_from_disk`,
   `resolve_disk_change`, `drop_doc`. (Codex finding R2.)
3. **Backend-owned session merge** — a new managed `SessionStore` keyed by label.
   Each window **pushes its own live slice** (the backend cannot infer live
   buffers — they aren't in the registry, `registry.rs:31-34`). The backend
   *merges* slices and is the **single writer** to `session.json`, eliminating the
   cross-window file race. Frontend no longer assembles a global payload.
4. **Backend window creation** — `new_window` command + a restore-spawner in
   `setup` create windows with geometry; `on_new_window` stays Deny (no native
   popups). Capability glob admits the new labels (§Capabilities).

## 2. Session schema v2 (+ migration)

Label-keyed, not index-keyed (indices are fragile after prune/reorder — Codex S2):

```
Session {
  version: 2,
  windows: Vec<SessionWindow>,
  focused_label: Option<String>,
}
SessionWindow {
  label: String,                 // stable identity
  geometry: { x, y, width, height, maximized },
  docs: Vec<SessionDoc>,         // unchanged shape
  active: Option<ActiveTab>,     // per window
  browser_tab: bool,
}
```

`SESSION_VERSION 1→2`. Migration: a v1 flat session → one `SessionWindow{label:
"main", geometry: default, …}`. Existing unsaved work survives upgrade.
Corrupt/unknown version → empty default (never delete file), as today.

## 3. Restore orchestration (clean startup only)

Trigger unchanged (no other instance + no CLI file). Mechanism:

1. Rust `setup` reads `session.json` via `SessionStore::restore_plan()`. For each
   `SessionWindow`, create a webview with that label + saved geometry; mark the
   `focused_label` window for focus.
2. Each window's frontend boot calls `get_window_session(myLabel)` → its docs/
   active/browser_tab → runs the **existing** `restoreSession` logic scoped to
   this window. (Reuses the working dirty/untitled-fallback path.)
3. CLI-file or fresh launch (empty/absent session) → one window (today's path).

### Close semantics — backend close transaction (Codex R4)

The last-window-keeps-snapshot policy lives in the **backend**, not the frontend
close handler (which races on concurrent/quit closes). On each window close:

1. Frontend `onCloseRequested` → `flushSessionNow()` pushes this window's final
   slice → `invoke('window_closing', { label })` → then `destroy()`.
2. `window_closing` (backend, serialized via the `SessionStore` mutex):
   - Mark the label `closing`; store its just-pushed slice.
   - Count remaining **live, non-closing** windows.
   - If **> 0**: prune this label from the persisted session (deliberate single
     close → not restored next launch).
   - If **0** (this is the last/only window, i.e. app quitting): **preserve the
     full snapshot** of all windows that were open at quit → next launch restores
     everything.
3. **Crash** (no clean close): the last debounced merged snapshot on disk holds
   all then-open windows → restored.

**Close All Windows** (file menu): closes every window. Because each close runs
the transaction and the final one hits the "0 remaining" branch, the whole set is
preserved for next launch — the deliberate "save my workspace" action.

## 4. Launch routing (second instance)

single-instance handler decides by argv:

- **With file(s)**: backend path→owner lookup. If a window already owns a doc for
  that path → focus it + targeted `window.emit('activate-doc', …)`. Else pick the
  MRU-focused live window → targeted `window.emit('open-file', …)` (NOT the
  current global `app.emit`, which would open in every window — Codex R3).
- **No file (bare relaunch)**: `new_window` (empty window).

**MRU focus tracking** must not rely on one signal (Codex R5): track
`WindowEvent::Focused` in `AppState`, augmented by a renderer focus ping, with a
fallback to the most-recently-created live, visible, non-destroyed window.

## 5. New-window UX

- `new_window` command (Rust-created); **Ctrl+Shift+N** + command-overlay entry →
  new empty window (welcome tab).
- **Tab context menu**: add a **"Move to New Window"** item rendered **disabled
  (grayed-out)** as a phase-2 affordance — visible but inert in v1.
- **Deferred to phase 2**: functional Move-to-New-Window (backend-orchestrated
  with ACK: source snapshots full doc state — buffer, baseline, `FileState`, mode,
  title, pinned, scroll, trustContext, **asset grants** — to backend → backend
  creates target with pending payload → target restores + ACKs → backend
  reassigns owner + migrates grants → source drops its tab; no source-side drop
  before ACK) and drag-tab-out (WebKitGTK feasibility spike first).

## 6. Capabilities & permissions (Codex R1 — the blocker)

`capabilities/default.json` currently scopes to `windows: ["main"]`; any other
label gets **no IPC at all**. Changes:

- Widen scope to glob: `"windows": ["main", "w-*"]` so restored/new windows have
  full IPC. (Security review: all our windows are equally trusted local app
  windows; acceptable.)
- Window **creation is Rust-side**, so we do **not** need
  `core:webview:allow-create-webview-window` for the frontend.
- Geometry is **applied Rust-side** at window build (from saved `SessionWindow`),
  so we avoid needing renderer `core:window:allow-set-*` writers. Reading current
  geometry for persistence uses the already-granted `core:window:default` readers
  (`allow-inner/outer-position|size`, `allow-is-maximized`).
- Keep `on_new_window → Deny`; add the `new_window` / `window_closing` /
  `get_window_session` / `save_window_session` commands to `invoke_handler` and
  any needed capability entries.

## 7. Known platform risk: Wayland window position (CONFIRMED acceptable)

On Wayland apps generally cannot set their own position (size/maximized only); X11
can. KDE/CachyOS. Position restore is **best-effort**: size + maximized restore
reliably everywhere; x/y is applied but may be ignored by the compositor. Degrade
gracefully; document the limitation. (User confirmed acceptable, not a blocker.)

## 8. Backend `SessionStore` API (Codex S3)

Managed Tauri state, single writer to `session.json`, internal mutex:

- `save_window_session(label, slice)` — debounced merge + persist (replaces the
  global `save_session` flow).
- `window_closing(label)` — the close transaction in §3.
- `get_window_session(label)` — returns a window's slice on boot.
- `restore_plan()` — returns the list of `SessionWindow`s to spawn at startup.

Commands `save_session`/`load_session` are reshaped/retired in favour of these;
`restore_dirty_doc` is unchanged and reused per window.

## 9. Testing & constraints

- **Rust unit tests**: v1→v2 migration; `SessionStore` slice merge + close
  transaction (prune-vs-preserve, last-window, concurrent close ordering);
  registry per-window ownership + active-map + save authority across all six
  mutating commands; launch-routing decision (reuse / forward / new); MRU focus
  selection + fallback.
- **UI unit tests** (`node:test`): per-window slice building; restore
  classification (extend existing `session.test.ts`); targeted-emit routing
  helpers; grayed-out menu-item state.
- **e2e cannot cover this** (per CLAUDE.md: Playwright drives a mocked
  single-window Chromium backend). Multi-window, native window mgmt, geometry,
  single-instance routing → **manual verification checklist on real `just run`**.
  No e2e coverage claimed.

### Manual `just run` checklist (Codex S7)

1. Open two windows; edit unsaved docs in both; quit all (or Close All) → relaunch
   → both windows + both unsaved docs restored, correct geometry + active tab +
   focus.
2. Three windows open; close one → relaunch → only the other two restored.
3. Second-instance `btr-md <file>` while two windows open, file NOT already open →
   opens in MRU-focused window only (not all).
4. Second-instance with a file ALREADY open → focuses the owning window + tab.
5. Bare relaunch (no file) → new empty window.
6. Geometry restore under both X11 and Wayland (position best-effort on Wayland).
7. Save authority: a doc owned by window A cannot be saved/dropped from window B.
8. Crash simulation (kill -9) → relaunch restores last snapshot.

## Appendix A — Codex review verdict (PARTIAL) — disposition

| Finding | Disposition |
|---|---|
| R1 capability scope `["main"]` insufficient | Adopted §6 (glob `w-*`, Rust-side create/geometry) |
| R2 ownership checks needed on all 6 mutating cmds | Adopted §1.2 |
| R3 global `app.emit("open-file")` opens in all windows | Adopted §4 (targeted `window.emit`) |
| R4 last-window snapshot race | Adopted §3 (backend close transaction) |
| R5 MRU on one signal unreliable | Adopted §4 (multi-signal + fallback) |
| S2 index-keyed schema fragile | Adopted §2 (label-keyed, `focused_label`) |
| S3 SessionStore API under-specified | Adopted §8 |
| S6/Move-to-New-Window richest/riskiest | Deferred to phase 2 (grayed-out affordance), per user |

## Open questions

None outstanding. (a) last-window policy and (b) Wayland best-effort positioning
both confirmed by user; Move-to-New-Window deferral confirmed.
