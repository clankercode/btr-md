# Multi-Window Session Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give btr.md multiple windows, each with its own tabs, and restore every window + its tabs (including unsaved documents) + geometry on a clean startup (no other instance, no CLI file).

**Architecture:** Single process, single shared `DocRegistry` (a doc is owned by exactly one window). The Rust backend owns window creation, a per-window `SessionStore` (single writer to `session.json`), and restore orchestration. The frontend pushes its own per-window slice and restores its own slice on boot. Save authority and all doc mutations are gated by per-window ownership.

**Tech Stack:** Rust (Tauri v2, serde, serde_json, fs2), TypeScript (Vite, `@tauri-apps/api`), `node:test` for UI unit tests, `cargo test -j 2` for Rust.

**Spec:** `docs/superpowers/specs/2026-06-15-multiwindow-session-restore-design.md` (read it first; Appendix A lists the Codex review findings this plan implements).

**Worktree:** `.worktrees/multiwindow-session` (branch `feat/multiwindow-session`). Run all commands from there. Rebase on `master` before merge — a window **Close** button is landing concurrently on `master`; reconcile §Phase 6 with it.

---

## Conventions for every task

- **Build/test threads capped at 2** (system rule): `cargo test -j 2`, `cargo build -j 2`.
- Rust tests: `cargo test -p pmd-app-lib -j 2 <filter>`. UI unit tests: `cd ui && npm run test:unit`.
- Commit after each green task. Message style matches the repo (`feat(multiwindow): …`, `refactor(doc): …`).
- After any task that changes a public Rust signature, `cargo build -j 2` is the "find all call sites" tool — the compiler enumerates breakage.

---

## File Structure

**Rust — modify:**
- `crates/pmd-app/src/state/session.rs` — schema v2 (`SessionWindow`, `WindowGeometry`, `focused_label`), v1→v2 migration.
- `crates/pmd-app/src/doc/registry.rs` — `DocEntry.owner_window`, per-label `active` map, ownership accessors, `find_by_path`.
- `crates/pmd-app/src/cmd/doc.rs` — thread `window` + ownership checks into the six mutating commands.
- `crates/pmd-app/src/cmd/file.rs` — pass owner label to `register`/`set_active` at open sites.
- `crates/pmd-app/src/cmd/session.rs` — pass owner label in `restore_dirty_doc`; retire global `save_session` in favour of per-window commands.
- `crates/pmd-app/src/main.rs` — single-instance routing, window-build helper, restore spawner, focus tracking, register new commands.
- `crates/pmd-app/src/lib.rs` — add `SessionStore` to `AppState`; expose new `state::window_session` module.
- `crates/pmd-app/capabilities/default.json` — window-label glob + window-mgmt permissions.

**Rust — create:**
- `crates/pmd-app/src/state/window_session.rs` — `SessionStore` (in-memory per-label map + close transaction + persistence), unit-tested in isolation.
- `crates/pmd-app/src/cmd/window.rs` — extend with `new_window`, `save_window_session`, `get_window_session`, `window_closing` commands (file exists for `set_window_title`).

**TS — modify:**
- `ui/src/session.ts` — v2 load shape (`LoadedWindowSession`), per-window payload type; keep `buildSavePayload`/`classifyRestore`.
- `ui/src/session_manager.ts` — push per-window slice via `save_window_session(label, …)`; `window_closing` on close; restore from `get_window_session(label)`.
- `ui/src/main.ts` — bootstrap reads window label + per-window session; targeted `open-file`/`activate-doc` listeners.
- `ui/src/actions.ts` — `window.new` + `window.closeAll` actions (hotkey + command overlay in one place).
- `ui/src/tabbar.ts` — tab context menu with a disabled "Move to New Window" item.

**TS — create:**
- `ui/src/window_session.test.ts` — per-window slice + v2 classification unit tests.
- `ui/src/tab_context_menu.test.ts` — tab context-menu item construction (disabled affordance).

---

## Phase 0 — Capabilities & window-label foundation

Runtime windows get **no IPC** unless the capability scope matches their label (Codex R1). This phase is config + a build check; it has no unit test (capabilities are not unit-testable — verified by build and, later, manual `just run`).

### Task 0.1: Widen capability scope to runtime window labels

**Files:**
- Modify: `crates/pmd-app/capabilities/default.json`

- [ ] **Step 1: Edit the capability manifest**

Replace the file contents with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for all btr-md windows. `main` is the first window; restored/new windows use labels like `w-2`, `w-3`. The glob keeps full IPC parity across every app window (all are equally-trusted local windows).",
  "windows": ["main", "w-*"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-set-focus",
    "core:window:allow-unminimize",
    "core:window:allow-show",
    "dialog:default"
  ]
}
```

Rationale: `core:window:default` already grants the geometry **readers** (`allow-inner/outer-position|size`, `allow-is-maximized`). Window **creation and geometry application are Rust-side** (Phase 4), so we do NOT add `core:window:allow-create` or `allow-set-*` writers. We add `allow-set-focus`/`allow-unminimize`/`allow-show` because focus routing (Phase 5) may be triggered renderer-side; if Phase 5 ends up fully Rust-side these can be dropped in cleanup.

- [ ] **Step 2: Verify the manifest is accepted by the schema/build**

Run: `cargo build -p pmd-app -j 2`
Expected: builds without a capability-schema error. (Tauri validates capability JSON against the generated schema at build time.)

- [ ] **Step 3: Commit**

```bash
git add crates/pmd-app/capabilities/default.json
git commit -m "feat(multiwindow): widen capability scope to w-* window labels"
```

---

## Phase 1 — Session schema v2 + migration (pure backend, fully TDD)

### Task 1.1: Add v2 types and bump `SESSION_VERSION`

**Files:**
- Modify: `crates/pmd-app/src/state/session.rs`
- Test: same file (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `session.rs`:

```rust
fn sample_window() -> SessionWindow {
    SessionWindow {
        label: "main".into(),
        geometry: WindowGeometry { x: 100, y: 80, width: 1100, height: 720, maximized: false },
        docs: vec![SessionDoc {
            path: Some("/tmp/a.md".into()),
            mode: "split".into(),
            unsaved: Some(UnsavedBuffer { content: "edited".into(), baseline_content: Some("base".into()) }),
        }],
        active: Some(ActiveTab::Doc(0)),
        browser_tab: false,
    }
}

#[test]
fn v2_session_roundtrips_windows_and_focused_label() {
    let _lock = config_env_lock();
    let _config_home = ConfigHomeGuard::new();
    let original = Session {
        version: SESSION_VERSION,
        windows: vec![sample_window(), SessionWindow { label: "w-2".into(), ..sample_window() }],
        focused_label: Some("w-2".into()),
    };
    save_session(&original).expect("save");
    assert_eq!(load_session(), original);
}
```

- [ ] **Step 2: Run it — expect a COMPILE failure**

Run: `cargo test -p pmd-app-lib -j 2 v2_session_roundtrips`
Expected: FAIL to compile — `Session` has no `windows`/`focused_label`; `SessionWindow`/`WindowGeometry` undefined.

- [ ] **Step 3: Replace the `Session` struct + add the new types**

In `session.rs`, set `pub const SESSION_VERSION: u32 = 2;` and replace the `Session` struct and its `Default` impl with:

```rust
/// The full persisted session: one entry per open window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub version: u32,
    /// Open windows, in creation order.
    #[serde(default)]
    pub windows: Vec<SessionWindow>,
    /// Label of the window that had focus at save time.
    #[serde(default)]
    pub focused_label: Option<String>,
}

impl Default for Session {
    fn default() -> Self {
        Self { version: SESSION_VERSION, windows: Vec::new(), focused_label: None }
    }
}

/// One window's persisted state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionWindow {
    /// Stable window label (`main`, `w-2`, …).
    pub label: String,
    #[serde(default)]
    pub geometry: WindowGeometry,
    /// Open documents in tab order.
    #[serde(default)]
    pub docs: Vec<SessionDoc>,
    /// Which tab was focused in this window.
    #[serde(default)]
    pub active: Option<ActiveTab>,
    /// Whether the file-browser tab was open in this window.
    #[serde(default)]
    pub browser_tab: bool,
}

/// Persisted window geometry. Position is best-effort on Wayland (size +
/// maximized restore reliably; x/y may be ignored by the compositor).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

impl Default for WindowGeometry {
    fn default() -> Self {
        // Mirrors main.rs's historical inner_size(1100, 720); position 0,0 means
        // "let the WM place it" in practice on the first window.
        Self { x: 0, y: 0, width: 1100, height: 720, maximized: false }
    }
}
```

Keep `SessionDoc`, `UnsavedBuffer`, `ActiveTab` exactly as they are. The existing tests that build a flat `Session { docs, active, browser_tab }` will now fail to compile — they are rewritten in Task 1.2 / deleted if superseded. To stay green incrementally, **update the existing `sample_session()` and the three tests that use the flat shape** to wrap their docs in a single `SessionWindow` (mechanical; the `roundtrips_*`, `clean_doc_omits_unsaved`, `save_leaves_no_tmp`, `missing_file`, `corrupt_file` tests). `clean_doc_omits_unsaved_in_serialized_json` should serialize a `SessionWindow` directly.

- [ ] **Step 4: Run the suite green**

Run: `cargo test -p pmd-app-lib -j 2 session`
Expected: PASS (new v2 roundtrip + migrated existing tests).

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/state/session.rs
git commit -m "feat(session): v2 schema — per-window list + geometry + focused_label"
```

### Task 1.2: v1→v2 migration on load

**Files:**
- Modify: `crates/pmd-app/src/state/session.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn loads_and_migrates_a_v1_flat_session_into_one_window() {
    let _lock = config_env_lock();
    let _config_home = ConfigHomeGuard::new();
    // A literal v1 payload (flat docs/active/browser_tab, version 1).
    let v1 = r#"{
      "version": 1,
      "docs": [
        {"path": null, "mode": "source", "unsaved": {"content": "draft"}},
        {"path": "/tmp/clean.md", "mode": "preview"}
      ],
      "active": {"doc": 1},
      "browser_tab": true
    }"#;
    if let Some(parent) = session_path().parent() { std::fs::create_dir_all(parent).unwrap(); }
    std::fs::write(session_path(), v1).unwrap();

    let s = load_session();
    assert_eq!(s.version, SESSION_VERSION);
    assert_eq!(s.windows.len(), 1);
    let w = &s.windows[0];
    assert_eq!(w.label, "main");
    assert_eq!(w.docs.len(), 2);
    assert_eq!(w.active, Some(ActiveTab::Doc(1)));
    assert!(w.browser_tab);
    assert_eq!(s.focused_label.as_deref(), Some("main"));
}
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cargo test -p pmd-app-lib -j 2 migrates_a_v1`
Expected: FAIL — `load_session` deserializes straight into v2 and the v1 `docs` field is dropped (window list empty).

- [ ] **Step 3: Implement migration in `load_session`**

Add a private v1 mirror struct and migrate before returning. Replace the final `serde_json::from_str::<Session>` block in `load_session` with:

```rust
    // Try v2 first; fall back to migrating a v1 flat session.
    match serde_json::from_str::<Session>(&body) {
        Ok(s) if s.version >= 2 => s,
        _ => match serde_json::from_str::<V1Session>(&body) {
            Ok(v1) => migrate_v1(v1),
            Err(e) => {
                eprintln!("[btr-md] session.json is malformed ({e}); starting empty");
                Session::default()
            }
        },
    }
}

/// v1 on-disk shape, kept only to migrate old sessions forward.
#[derive(Deserialize)]
struct V1Session {
    #[serde(default)]
    docs: Vec<SessionDoc>,
    #[serde(default)]
    active: Option<ActiveTab>,
    #[serde(default)]
    browser_tab: bool,
}

fn migrate_v1(v1: V1Session) -> Session {
    Session {
        version: SESSION_VERSION,
        windows: vec![SessionWindow {
            label: "main".into(),
            geometry: WindowGeometry::default(),
            docs: v1.docs,
            active: v1.active,
            browser_tab: v1.browser_tab,
        }],
        focused_label: Some("main".into()),
    }
}
```

Note: the `Ok(s) if s.version >= 2` guard means a v2 file parses normally; anything else is attempted as v1. (A v2 file always has `version: 2`, so it never falls through.)

- [ ] **Step 4: Run green**

Run: `cargo test -p pmd-app-lib -j 2 session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/state/session.rs
git commit -m "feat(session): migrate v1 flat sessions into a single v2 window"
```

---

## Phase 2 — Per-window doc ownership (backend)

### Task 2.1: `DocEntry.owner_window` + per-label active map

**Files:**
- Modify: `crates/pmd-app/src/doc/registry.rs`
- Test: same file

- [ ] **Step 1: Write the failing tests**

Add a `#[cfg(test)] mod tests` to `registry.rs` (or extend if present):

```rust
#[cfg(test)]
mod ownership_tests {
    use super::*;

    #[test]
    fn registered_doc_records_owner_and_per_window_active() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        let (b, _) = reg.register("w-2", None, "b".into());
        assert_eq!(reg.owner_of(a).as_deref(), Some("main"));
        assert_eq!(reg.owner_of(b).as_deref(), Some("w-2"));

        reg.set_active("main", a);
        reg.set_active("w-2", b);
        assert!(reg.is_active("main", a));
        assert!(reg.is_active("w-2", b));
        // A window is not active for a doc it does not own / did not activate.
        assert!(!reg.is_active("main", b));
        assert!(!reg.is_active("w-2", a));
    }

    #[test]
    fn owns_gates_cross_window_mutation() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        assert!(reg.owns("main", a));
        assert!(!reg.owns("w-2", a));
    }

    #[test]
    fn drop_clears_active_for_owning_window_only() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        reg.set_active("main", a);
        reg.drop_doc(a);
        assert!(!reg.is_active("main", a));
        assert!(reg.active_for("main").is_none());
    }

    #[test]
    fn find_by_path_returns_doc_and_owner() {
        let reg = DocRegistry::new();
        let p = std::path::PathBuf::from("/tmp/x.md");
        let id = reg.register_restored("w-2", p.clone(), "base".into(),
            FileState::Clean { base: Digest::of("base") });
        assert_eq!(reg.find_by_path(&p), Some((id, "w-2".to_string())));
        assert_eq!(reg.find_by_path(std::path::Path::new("/tmp/none.md")), None);
    }
}
```

- [ ] **Step 2: Run — expect COMPILE failure**

Run: `cargo test -p pmd-app-lib -j 2 ownership_tests`
Expected: FAIL — `register` takes no owner arg; `owner_of`/`owns`/`is_active(label,_)`/`active_for`/`find_by_path` don't exist.

- [ ] **Step 3: Implement the registry changes**

In `registry.rs`:

(a) Add the field to `DocEntry`:
```rust
pub struct DocEntry {
    pub state: FileState,
    pub base_content: String,
    pub path: Option<PathBuf>,
    pub owner_window: String,
}
```

(b) Change the active slot type:
```rust
pub struct DocRegistry {
    docs: Mutex<HashMap<DocId, DocEntry>>,
    next_id: AtomicU64,
    active: Mutex<HashMap<String, DocId>>, // window label -> its active doc
}
```
and in `new()`/`Default`: `active: Mutex::new(HashMap::new())`.

(c) `register` / `register_restored` take `owner: &str`:
```rust
pub fn register(&self, owner: &str, path: Option<PathBuf>, contents: String) -> (DocId, FileState) {
    let id = self.mint_id();
    let state = match &path {
        Some(_) => FileState::Clean { base: Digest::of(&contents) },
        None => FileState::Untitled,
    };
    self.lock().insert(id, DocEntry { state: state.clone(), base_content: contents, path, owner_window: owner.to_string() });
    (id, state)
}

pub fn register_restored(&self, owner: &str, path: PathBuf, base_content: String, state: FileState) -> DocId {
    let id = self.mint_id();
    self.lock().insert(id, DocEntry { state, base_content, path: Some(path), owner_window: owner.to_string() });
    id
}
```

(d) Replace the active-doc section with per-label methods:
```rust
pub fn set_active(&self, window: &str, doc: DocId) {
    self.active.lock().unwrap_or_else(|p| p.into_inner()).insert(window.to_string(), doc);
}
pub fn clear_active(&self, window: &str) {
    self.active.lock().unwrap_or_else(|p| p.into_inner()).remove(window);
}
pub fn active_for(&self, window: &str) -> Option<DocId> {
    self.active.lock().unwrap_or_else(|p| p.into_inner()).get(window).copied()
}
pub fn is_active(&self, window: &str, doc: DocId) -> bool {
    self.active_for(window) == Some(doc)
}
pub fn owner_of(&self, doc: DocId) -> Option<String> {
    self.lock().get(&doc).map(|e| e.owner_window.clone())
}
pub fn owns(&self, window: &str, doc: DocId) -> bool {
    self.owner_of(doc).as_deref() == Some(window)
}
pub fn find_by_path(&self, path: &std::path::Path) -> Option<(DocId, String)> {
    self.lock().iter()
        .find(|(_, e)| e.path.as_deref() == Some(path))
        .map(|(id, e)| (*id, e.owner_window.clone()))
}
```

(e) Update `drop_doc` to clear the doc from every label's active slot:
```rust
pub fn drop_doc(&self, doc: DocId) -> Option<DocEntry> {
    let removed = self.lock().remove(&doc);
    let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
    active.retain(|_, &mut d| d != doc);
    removed
}
```

- [ ] **Step 4: Run green (registry tests only)**

Run: `cargo test -p pmd-app-lib -j 2 ownership_tests`
Expected: PASS. (The crate as a whole won't build yet — call sites break; fixed in Task 2.2.)

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/doc/registry.rs
git commit -m "refactor(doc): per-window doc ownership + per-label active map"
```

### Task 2.2: Thread owner label + ownership checks through commands

**Files:**
- Modify: `crates/pmd-app/src/cmd/doc.rs`, `crates/pmd-app/src/cmd/file.rs`, `crates/pmd-app/src/cmd/session.rs`

This task is **compiler-driven**: `cargo build -j 2` lists every broken call site. Apply these exact transforms.

- [ ] **Step 1: `cmd/doc.rs` — add `window` + ownership to the six mutating commands**

For each command, add `window: tauri::Window` as a parameter (after `app`/before `state` where present) and gate on ownership. Concretely:

- `register_doc`: already has `window`. Change `state.docs.register(canon.clone(), contents)` → `state.docs.register(window.label(), canon.clone(), contents)` and `state.docs.set_active(doc_id)` → `state.docs.set_active(window.label(), doc_id)`.
- `set_active_doc`: add `window: tauri::Window`. Before activating, `if !state.docs.owns(window.label(), doc_id) { return Err(format!("set_active_doc: doc {} not owned by {}", doc_id.0, window.label())); }` then `state.docs.set_active(window.label(), doc_id)`.
- `doc_edited`: add `window: tauri::Window`; guard `if !state.docs.owns(window.label(), doc_id) { return Err(...) }` before `state.docs.edited(...)`.
- `save_doc`: add `window: tauri::Window`; change the authority check to `if !state.docs.is_active(window.label(), doc_id) { return Err(format!("save_doc refuses doc {}: not the active document for {}", doc_id.0, window.label())); }`.
- `pull_from_disk`, `resolve_disk_change`, `drop_doc`: add `window: tauri::Window`; guard `if !state.docs.owns(window.label(), doc_id) { return Err(...) }` first.

Each error message uses the existing `format!(...)` style. Tauri injects `window` automatically; the TS call sites do **not** change (they already invoke without passing window).

- [ ] **Step 2: `cmd/file.rs` — pass owner label at open/register sites**

`cargo build -j 2` will flag every `register(`, `register_restored(`, `set_active(` call in `file.rs` (the `open_file`/`request_open_file`/`register_opened` flow). Each such command already receives a `window: tauri::Window` (they emit/trust by `window.label()`); pass `window.label()` as the new first arg to `register`/`register_restored` and `state.docs.set_active(window.label(), doc_id)`. If a helper function lacks `window`, thread a `owner: &str` parameter down from its command caller.

- [ ] **Step 3: `cmd/session.rs` — `restore_dirty_doc` owner**

`restore_dirty_doc` already has `window: tauri::Window`. Change `register_restored(canon.clone(), baseline_content, fstate.clone())` → `register_restored(window.label(), canon.clone(), baseline_content, fstate.clone())` and `state.docs.set_active(doc_id)` → `state.docs.set_active(window.label(), doc_id)`.

- [ ] **Step 4: Build + run the whole Rust suite**

Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2`
Expected: builds; all tests pass. Fix any remaining call sites the compiler names (e.g. tests inside `cmd/*` that call `register` directly — pass a label like `"main"`).

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/cmd/doc.rs crates/pmd-app/src/cmd/file.rs crates/pmd-app/src/cmd/session.rs
git commit -m "feat(doc): gate all doc-mutating commands on per-window ownership"
```

### Task 2.3: Route `doc_state_changed` to the owning window only

**Files:**
- Modify: `crates/pmd-app/src/watcher.rs` (read it first — it emits `doc_state_changed`)
- Modify: `crates/pmd-app/src/cmd/doc.rs` if it also emits

- [ ] **Step 1: Find the emit**

Run: `grep -rn "doc_state_changed" crates/pmd-app/src`
Expected: locate the `app.emit("doc_state_changed", …)` (global) call(s).

- [ ] **Step 2: Write a guard test (registry-level helper)**

The emit needs the owner label to target. Confirm the lookup exists by asserting `owner_of` works for a watched doc (already covered by Task 2.1's `find_by_path`/`owner_of`). No new pure test is practical for the emit itself (needs an AppHandle); rely on the manual checklist (Phase 8 item 7). Add a short `// targeted: only the owner window` comment at the emit.

- [ ] **Step 3: Change global emit → targeted**

Replace `app.emit("doc_state_changed", payload)` with:
```rust
if let Some(label) = state.docs.owner_of(doc_id) {
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.emit("doc_state_changed", payload);
    }
}
```
(`use tauri::{Emitter, Manager};` as needed.)

- [ ] **Step 4: Build + test**

Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/watcher.rs crates/pmd-app/src/cmd/doc.rs
git commit -m "fix(doc): emit doc_state_changed only to the owning window"
```

---

## Phase 3 — Backend `SessionStore` (single writer)

### Task 3.1: `SessionStore` with the close transaction

**Files:**
- Create: `crates/pmd-app/src/state/window_session.rs`
- Modify: `crates/pmd-app/src/state/mod.rs` (add `pub mod window_session;`)
- Test: in `window_session.rs`

`SessionStore` holds the live per-label map plus the focused label; it merges pushed slices and decides prune-vs-preserve on close. Persistence delegates to the existing `session::save_session`. The close-transaction logic is unit-tested over the in-memory map (no disk needed for the decision).

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::session::{SessionWindow, WindowGeometry};

    fn win(label: &str) -> SessionWindow {
        SessionWindow { label: label.into(), geometry: WindowGeometry::default(),
            docs: vec![], active: None, browser_tab: false }
    }

    #[test]
    fn upsert_merges_by_label_and_keeps_order() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.upsert(SessionWindow { browser_tab: true, ..win("main") }); // update
        let snap = store.snapshot();
        assert_eq!(snap.windows.iter().map(|w| w.label.clone()).collect::<Vec<_>>(), ["main", "w-2"]);
        assert!(snap.windows[0].browser_tab); // merged update, original position
    }

    #[test]
    fn closing_a_non_last_window_prunes_it() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        let outcome = store.window_closing("w-2");
        assert_eq!(outcome, CloseOutcome::Pruned);
        let labels: Vec<_> = store.snapshot().windows.iter().map(|w| w.label.clone()).collect();
        assert_eq!(labels, ["main"]);
    }

    #[test]
    fn closing_the_last_window_preserves_full_snapshot() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        assert_eq!(store.window_closing("w-2"), CloseOutcome::Pruned);
        // Now "main" is the last live window; closing it preserves everything
        // that was live at that moment (just "main").
        assert_eq!(store.window_closing("main"), CloseOutcome::PreservedForQuit);
        // The preserved snapshot still contains the last window for restore.
        assert_eq!(store.snapshot().windows.len(), 1);
    }

    #[test]
    fn set_focused_is_reflected_in_snapshot() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.set_focused("main");
        assert_eq!(store.snapshot().focused_label.as_deref(), Some("main"));
    }
}
```

- [ ] **Step 2: Run — expect COMPILE failure**

Run: `cargo test -p pmd-app-lib -j 2 window_session`
Expected: FAIL — module/types don't exist.

- [ ] **Step 3: Implement `window_session.rs`**

```rust
//! In-memory, single-writer store of the live per-window session. Each renderer
//! pushes its own window slice (`upsert`); the backend merges by label and is the
//! sole writer to `session.json`. The close transaction implements the
//! "last-window-keeps-snapshot" policy race-free (see the design spec §3).

use std::sync::Mutex;

use crate::state::session::{self, Session, SessionWindow, SESSION_VERSION};

#[derive(Debug, PartialEq, Eq)]
pub enum CloseOutcome {
    /// Other windows remain — this one is forgotten (not restored next launch).
    Pruned,
    /// This was the last live window (app quitting) — full snapshot preserved.
    PreservedForQuit,
}

pub struct SessionStore {
    inner: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// Live windows in creation order.
    windows: Vec<SessionWindow>,
    focused: Option<String>,
}

impl Default for SessionStore {
    fn default() -> Self { Self::new() }
}

impl SessionStore {
    pub fn new() -> Self { Self { inner: Mutex::new(State::default()) } }

    /// Seed the store from a loaded session (used at startup so restored windows
    /// are already "live" and a later prune behaves correctly).
    pub fn seed(&self, session: Session) {
        let mut s = self.lock();
        s.windows = session.windows;
        s.focused = session.focused_label;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Insert or replace one window's slice, preserving first-seen order.
    pub fn upsert(&self, window: SessionWindow) {
        let mut s = self.lock();
        match s.windows.iter_mut().find(|w| w.label == window.label) {
            Some(existing) => *existing = window,
            None => s.windows.push(window),
        }
    }

    pub fn set_focused(&self, label: &str) {
        self.lock().focused = Some(label.to_string());
    }

    /// The close transaction. If other live windows remain, prune this one
    /// (deliberate single close). If it is the last, keep the full snapshot so
    /// the whole workspace restores next launch.
    pub fn window_closing(&self, label: &str) -> CloseOutcome {
        let mut s = self.lock();
        let live = s.windows.len();
        if live <= 1 {
            // Last window: preserve everything currently live (incl. this one).
            CloseOutcome::PreservedForQuit
        } else {
            s.windows.retain(|w| w.label != label);
            if s.focused.as_deref() == Some(label) { s.focused = None; }
            CloseOutcome::Pruned
        }
    }

    /// A consistent copy of the current persisted shape.
    pub fn snapshot(&self) -> Session {
        let s = self.lock();
        Session {
            version: SESSION_VERSION,
            windows: s.windows.clone(),
            focused_label: s.focused.clone(),
        }
    }

    /// Persist the current snapshot atomically (single writer).
    pub fn persist(&self) -> anyhow::Result<()> {
        session::save_session(&self.snapshot())
    }
}
```

- [ ] **Step 4: Run green**

Run: `cargo test -p pmd-app-lib -j 2 window_session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/state/window_session.rs crates/pmd-app/src/state/mod.rs
git commit -m "feat(session): SessionStore — per-window merge + close transaction"
```

### Task 3.2: Add `SessionStore` to `AppState`; wire commands

**Files:**
- Modify: `crates/pmd-app/src/lib.rs` (add `pub sessions: state::window_session::SessionStore` to `AppState` + `new`)
- Modify: `crates/pmd-app/src/main.rs` (construct it in the `AppState { … }` literal)
- Modify: `crates/pmd-app/src/cmd/window.rs` (new commands)
- Modify: `crates/pmd-app/src/cmd/session.rs` (retire global `save_session`; keep `load_session`, `restore_dirty_doc`)

- [ ] **Step 1: Add the field**

`lib.rs`:
```rust
pub sessions: state::window_session::SessionStore,
```
in both the struct and `AppState::new` (`sessions: state::window_session::SessionStore::new()`), and in the `main.rs` `AppState { … }` literal (`sessions: pmd_app_lib::state::window_session::SessionStore::new(),`).

- [ ] **Step 2: Write the command + a deserialize test**

In `cmd/window.rs` add the per-window session commands. Reuse `SaveDocInput` and `build_session_doc` from `cmd/session.rs` (make `build_session_doc` `pub(crate)` and `SaveDocInput` `pub`). Add this test to `cmd/window.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_slice_input_deserializes_camelcase() {
        let json = r#"{"label":"w-2","geometry":{"x":1,"y":2,"width":800,"height":600,"maximized":false},
                       "docs":[{"docId":3,"mode":"split","content":"hi"}],"active":{"doc":0},"browserTab":true}"#;
        let v: SaveWindowInput = serde_json::from_str(json).expect("camelCase");
        assert_eq!(v.label, "w-2");
        assert_eq!(v.docs[0].doc_id, 3);
        assert!(v.browser_tab);
    }
}
```

- [ ] **Step 3: Run — expect FAIL (type missing)**

Run: `cargo test -p pmd-app-lib -j 2 window_slice_input`
Expected: FAIL — `SaveWindowInput` undefined.

- [ ] **Step 4: Implement the commands**

```rust
use serde::Deserialize;
use crate::cmd::session::{build_session_doc, SaveDocInput};
use crate::state::session::{ActiveTab, SessionWindow, WindowGeometry};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWindowInput {
    pub label: String,
    pub geometry: WindowGeometry,
    pub docs: Vec<SaveDocInput>,
    pub active: Option<ActiveTab>,
    pub browser_tab: bool,
}

/// Push one window's live slice into the SessionStore + persist (debounced on
/// the frontend; the backend persists every push — cheap and single-writer).
#[tauri::command]
pub async fn save_window_session(
    state: tauri::State<'_, crate::AppState>,
    input: SaveWindowInput,
) -> Result<(), String> {
    let docs = input.docs.into_iter()
        .filter_map(|d| build_session_doc(&state, d))
        .collect();
    state.sessions.upsert(SessionWindow {
        label: input.label, geometry: input.geometry, docs,
        active: input.active, browser_tab: input.browser_tab,
    });
    state.sessions.persist().map_err(|e| e.to_string())
}

/// Return one window's slice for restore-on-boot (None if not in the session).
#[tauri::command]
pub fn get_window_session(
    state: tauri::State<'_, crate::AppState>,
    label: String,
) -> Option<SessionWindow> {
    state.sessions.snapshot().windows.into_iter().find(|w| w.label == label)
}

/// Backend close transaction: prune-or-preserve, then persist.
#[tauri::command]
pub fn window_closing(
    state: tauri::State<'_, crate::AppState>,
    label: String,
) -> Result<(), String> {
    let _ = state.sessions.window_closing(&label);
    state.sessions.persist().map_err(|e| e.to_string())
}
```

Make `build_session_doc` `pub(crate)` and `SaveDocInput` `pub` in `cmd/session.rs`, and **delete** the old global `save_session` command there (plus its `Session`-building body). Keep `load_session` and `restore_dirty_doc`.

- [ ] **Step 5: Register commands; drop the old one**

In `main.rs` `invoke_handler!`: remove `cmd::session::save_session`; add `cmd::window::save_window_session`, `cmd::window::get_window_session`, `cmd::window::window_closing` (and `cmd::window::new_window` — created in Phase 4). Keep `cmd::session::load_session`, `cmd::session::restore_dirty_doc`.

- [ ] **Step 6: Build + test**

Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/pmd-app/src/lib.rs crates/pmd-app/src/main.rs crates/pmd-app/src/cmd/window.rs crates/pmd-app/src/cmd/session.rs
git commit -m "feat(session): per-window save/get/closing commands; retire global save_session"
```

---

## Phase 4 — Window creation & restore orchestration (backend)

### Task 4.1: Window-build helper + `new_window` + restore spawner

**Files:**
- Modify: `crates/pmd-app/src/main.rs`
- Modify: `crates/pmd-app/src/cmd/window.rs` (the `new_window` command)

- [ ] **Step 1: Extract a window builder**

In `main.rs`, factor the `WebviewWindowBuilder` block (currently inline for `"main"`) into a helper so both startup and `new_window` use it:

```rust
fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    geometry: Option<&pmd_app_lib::state::session::WindowGeometry>,
    navigation_gate: std::sync::Arc<NavigationGate>,
) -> tauri::Result<tauri::WebviewWindow> {
    let gate = std::sync::Arc::clone(&navigation_gate);
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("btr-md — better markdown")
        .decorations(true)
        .on_navigation(move |url| gate.should_allow_navigation(url))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|webview, event| {
            if let DownloadEvent::Requested { url, .. } = event {
                let _ = webview.emit("pmd://download-denied", url.to_string());
            }
            false
        });
    match geometry {
        Some(g) => { b = b.inner_size(g.width as f64, g.height as f64).position(g.x as f64, g.y as f64); }
        None => { b = b.inner_size(1100.0, 720.0); }
    }
    let win = b.build()?;
    if matches!(geometry, Some(g) if g.maximized) { let _ = win.maximize(); }
    Ok(win)
}
```

Keep the `NavigationGate` `Arc` available to `new_window` by storing it in `AppState` (add `pub navigation_gate: std::sync::Arc<NavigationGate>`), or `app.manage(navigation_gate.clone())` and pull it in the command. Prefer `manage` to avoid widening `AppState::new` test churn: `app.manage(navigation_gate.clone());` in setup, then `app.state::<Arc<NavigationGate>>()` in the command.

- [ ] **Step 2: `new_window` command**

In `cmd/window.rs`:
```rust
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(2); // "main" is 1

/// Create a fresh empty window (Rust-side). Returns its label.
#[tauri::command]
pub fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    let n = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    let label = format!("w-{n}");
    let gate = app.state::<std::sync::Arc<crate::navigation_policy::NavigationGate>>().inner().clone();
    crate::build_window(&app, &label, None, gate).map_err(|e| e.to_string())?;
    Ok(label)
}
```
Move `build_window` to `lib.rs` (or a `crate::window` module) so the command can call it as `crate::build_window`. (If kept in `main.rs` it isn't reachable from the lib crate — put it in `lib.rs` or a new `pub mod window_build`.)

- [ ] **Step 3: Startup restore spawner**

In `main.rs` `.setup`, after the stores init, replace the single hard-coded `WebviewWindowBuilder` with:

```rust
let session = pmd_app_lib::state::session::load_session();
let app_state = app.state::<AppState>();
app_state.sessions.seed(session.clone());

// Decide: CLI file or empty session -> one "main" window (today's behaviour).
// Else -> spawn every persisted window.
let restoring = args.initial_path.is_none() && !session.windows.is_empty();
if restoring {
    for w in &session.windows {
        build_window(&app.handle(), &w.label, Some(&w.geometry), navigation_gate.clone())?;
    }
    if let Some(focus) = &session.focused_label {
        if let Some(win) = app.get_webview_window(focus) { let _ = win.set_focus(); }
    }
} else {
    build_window(&app.handle(), "main", None, navigation_gate.clone())?;
}
```

The `open-file` initial-path emit stays (targeted to `"main"` — see Phase 5). Each spawned window's frontend pulls its own slice via `get_window_session` (Phase 6).

- [ ] **Step 4: Register `new_window`; build + smoke**

Add `cmd::window::new_window` to `invoke_handler!`. Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2`. Expected: PASS. (Window spawning itself is verified manually — Phase 8.)

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/main.rs crates/pmd-app/src/lib.rs crates/pmd-app/src/cmd/window.rs
git commit -m "feat(multiwindow): Rust window builder, new_window command, restore spawner"
```

### Task 4.2: MRU focus tracking

**Files:**
- Modify: `crates/pmd-app/src/lib.rs` (`AppState` gains MRU), `crates/pmd-app/src/main.rs` (`on_window_event`)
- Create: focus-order helper unit-tested in `lib.rs` or a small module

- [ ] **Step 1: Write the failing test for the MRU helper**

Put a pure helper in a small module `crates/pmd-app/src/state/focus_order.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn touch_moves_label_to_front_and_dedups() {
        let mut m = MruOrder::default();
        m.touch("main"); m.touch("w-2"); m.touch("main");
        assert_eq!(m.most_recent(&["main","w-2"]), Some("main".to_string()));
        m.remove("main");
        assert_eq!(m.most_recent(&["w-2"]), Some("w-2".to_string()));
    }
    #[test]
    fn most_recent_skips_dead_labels_and_falls_back() {
        let mut m = MruOrder::default();
        m.touch("w-9"); // since closed
        assert_eq!(m.most_recent(&["main"]), Some("main".to_string())); // fallback to a live one
    }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `cargo test -p pmd-app-lib -j 2 focus_order`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `MruOrder`**

```rust
//! Most-recently-focused window ordering for launch routing. Not a single
//! signal of truth — `most_recent` is filtered against the set of currently
//! live window labels and falls back to the first live label.
#[derive(Default)]
pub struct MruOrder { order: Vec<String> } // front = most recent

impl MruOrder {
    pub fn touch(&mut self, label: &str) {
        self.order.retain(|l| l != label);
        self.order.insert(0, label.to_string());
    }
    pub fn remove(&mut self, label: &str) { self.order.retain(|l| l != label); }
    /// First MRU label that is still live; else the first live label.
    pub fn most_recent(&self, live: &[&str]) -> Option<String> {
        self.order.iter().find(|l| live.contains(&l.as_str())).cloned()
            .or_else(|| live.first().map(|s| s.to_string()))
    }
}
```

Add `pub mru: std::sync::Mutex<state::focus_order::MruOrder>` to `AppState` (+ `new`/`main.rs` literal: `mru: std::sync::Mutex::new(Default::default())`).

- [ ] **Step 4: Wire window events in `main.rs`**

After building each window (in `build_window` callers or via `app.on_window_event`), track focus + close:
```rust
app.on_window_event(|window, event| {
    let label = window.label().to_string();
    let state = window.state::<AppState>();
    match event {
        tauri::WindowEvent::Focused(true) => {
            state.mru.lock().unwrap_or_else(|p| p.into_inner()).touch(&label);
        }
        tauri::WindowEvent::Destroyed => {
            state.mru.lock().unwrap_or_else(|p| p.into_inner()).remove(&label);
        }
        _ => {}
    }
});
```
(Register once in `.setup` after windows are built. `on_window_event` on the `App`/`AppHandle` covers all windows.)

- [ ] **Step 5: Build + test + commit**

Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2` → PASS.
```bash
git add crates/pmd-app/src/state/focus_order.rs crates/pmd-app/src/lib.rs crates/pmd-app/src/main.rs
git commit -m "feat(multiwindow): MRU window focus tracking for launch routing"
```

---

## Phase 5 — Launch routing (single-instance)

### Task 5.1: reuse-if-open / forward-to-MRU / new-window-on-bare

**Files:**
- Modify: `crates/pmd-app/src/main.rs` (the `tauri_plugin_single_instance::init` callback)

- [ ] **Step 1: Write a routing-decision unit test**

Extract the decision as a pure function so it is testable without Tauri. Add to `cmd/window.rs` (or a `routing` module):

```rust
#[derive(Debug, PartialEq, Eq)]
pub enum LaunchRoute {
    NewWindow,
    ReuseWindow(String),          // file already open here -> focus + activate
    ForwardTo(String),            // open file as a new tab in this window
}

/// Decide where a forwarded launch goes.
/// `paths` empty -> bare relaunch -> new window.
/// else if a path is already open -> reuse that owner window.
/// else -> forward to the MRU-focused live window (None live -> new window).
pub fn route_launch(
    paths: &[std::path::PathBuf],
    owner_of_path: impl Fn(&std::path::Path) -> Option<String>,
    mru_live: Option<String>,
) -> LaunchRoute {
    if paths.is_empty() { return LaunchRoute::NewWindow; }
    for p in paths {
        if let Some(owner) = owner_of_path(p) { return LaunchRoute::ReuseWindow(owner); }
    }
    match mru_live { Some(label) => LaunchRoute::ForwardTo(label), None => LaunchRoute::NewWindow }
}

#[cfg(test)]
mod routing_tests {
    use super::*;
    use std::path::{Path, PathBuf};
    #[test]
    fn bare_relaunch_opens_new_window() {
        assert_eq!(route_launch(&[], |_| None, Some("main".into())), LaunchRoute::NewWindow);
    }
    #[test]
    fn already_open_file_reuses_owner() {
        let open = PathBuf::from("/tmp/a.md");
        let r = route_launch(&[open.clone()], |p| (p == Path::new("/tmp/a.md")).then(|| "w-2".to_string()), Some("main".into()));
        assert_eq!(r, LaunchRoute::ReuseWindow("w-2".into()));
    }
    #[test]
    fn new_file_forwards_to_mru() {
        let r = route_launch(&[PathBuf::from("/tmp/new.md")], |_| None, Some("main".into()));
        assert_eq!(r, LaunchRoute::ForwardTo("main".into()));
    }
    #[test]
    fn new_file_with_no_live_window_opens_new() {
        let r = route_launch(&[PathBuf::from("/tmp/new.md")], |_| None, None);
        assert_eq!(r, LaunchRoute::NewWindow);
    }
}
```

- [ ] **Step 2: Run — FAIL**

Run: `cargo test -p pmd-app-lib -j 2 routing_tests`
Expected: FAIL — `route_launch` missing.

- [ ] **Step 3: Implement `route_launch` (above) and rewrite the single-instance callback**

In `main.rs`, replace the callback body. After admitting each forwarded `path` to scope (existing code), collect the admitted canonical paths into `admitted: Vec<PathBuf>`, then:

```rust
let live: Vec<String> = app.webview_windows().keys().cloned().collect();
let live_refs: Vec<&str> = live.iter().map(|s| s.as_str()).collect();
let mru_live = app.state::<AppState>().mru.lock().unwrap_or_else(|p| p.into_inner())
    .most_recent(&live_refs);
let docs = &app.state::<AppState>().docs;
let route = cmd::window::route_launch(&admitted, |p| docs.find_by_path(p).map(|(_, owner)| owner), mru_live);

match route {
    cmd::window::LaunchRoute::NewWindow => { let _ = cmd::window::new_window(app.clone()); }
    cmd::window::LaunchRoute::ReuseWindow(label) => {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.unminimize(); let _ = win.show(); let _ = win.set_focus();
            for p in &admitted { let _ = win.emit("activate-doc", p.to_string_lossy().to_string()); }
        }
    }
    cmd::window::LaunchRoute::ForwardTo(label) => {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.unminimize(); let _ = win.show(); let _ = win.set_focus();
            for p in &admitted { let _ = win.emit("open-file", p.to_string_lossy().to_string()); }
        }
    }
}
```

This replaces the previous global `app.emit("open-file", …)` + always-focus-`main` (Codex R3): emits are now **targeted** to one window. Also change the initial-path emit in `.setup` from `app.emit` to a targeted `main`-window emit:
```rust
if let Some(ref p) = args.initial_path {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("open-file", p.to_string_lossy().to_string());
    }
}
```

- [ ] **Step 4: Build + test**

Run: `cargo build -p pmd-app -j 2 && cargo test -p pmd-app-lib -j 2`
Expected: PASS. (End-to-end routing verified manually — Phase 8 items 3–5.)

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-app/src/main.rs crates/pmd-app/src/cmd/window.rs
git commit -m "feat(multiwindow): targeted launch routing (reuse/forward/new-window)"
```

---

## Phase 6 — Frontend per-window integration

> Reconcile with the concurrent `master` window-**Close** button here: the close path below replaces/augments `installCloseFlush`. After rebasing, ensure the Close button also routes through `window_closing`.

### Task 6.1: Per-window save payload + label-aware load (pure)

**Files:**
- Modify: `ui/src/session.ts`
- Create: `ui/src/window_session.test.ts`

- [ ] **Step 1: Write failing unit tests**

`ui/src/window_session.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowPayload, classifyRestore, type LoadedWindowSession } from './session.ts';

test('buildWindowPayload wraps slice with label + geometry', () => {
  const p = buildWindowPayload('w-2',
    { x: 5, y: 6, width: 800, height: 600, maximized: false },
    [{ kind: 'doc', docId: 1, mode: 'split', buffer: 'hi' }], 0);
  assert.equal(p.label, 'w-2');
  assert.equal(p.geometry.width, 800);
  assert.equal(p.docs.length, 1);
  assert.deepEqual(p.active, { doc: 0 });
  assert.equal(p.browserTab, false);
});

test('classifyRestore still works on a window slice doc', () => {
  const w: LoadedWindowSession = {
    label: 'main',
    geometry: { x: 0, y: 0, width: 1100, height: 720, maximized: false },
    docs: [{ path: null, mode: 'source', unsaved: { content: 'draft' } }],
    active: { doc: 0 }, browser_tab: false,
  };
  assert.equal(classifyRestore(w.docs[0]).kind, 'untitled');
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd ui && npm run test:unit`
Expected: FAIL — `buildWindowPayload`/`LoadedWindowSession` missing.

- [ ] **Step 3: Implement in `session.ts`**

Add (keeping `buildSavePayload`/`classifyRestore`):
```ts
export interface WindowGeometry { x: number; y: number; width: number; height: number; maximized: boolean; }

export interface SaveWindowPayload {
  label: string;
  geometry: WindowGeometry;
  docs: SaveDocInput[];
  active: ActiveTab;
  browserTab: boolean;
}

export interface LoadedWindowSession {
  label: string;
  geometry: WindowGeometry;
  docs: SessionDoc[];
  active: ActiveTab;
  browser_tab: boolean;
}

/** Wrap a per-window tab slice into the save_window_session payload. */
export function buildWindowPayload(
  label: string, geometry: WindowGeometry, tabs: TabSnapshot[], activeIndex: number,
): SaveWindowPayload {
  const { docs, active, browserTab } = buildSavePayload(tabs, activeIndex);
  return { label, geometry, docs, active, browserTab };
}
```

- [ ] **Step 4: Run green; commit**

Run: `cd ui && npm run test:unit` → PASS.
```bash
git add ui/src/session.ts ui/src/window_session.test.ts
git commit -m "feat(ui/session): per-window save payload + window-slice load type"
```

### Task 6.2: `session_manager` pushes/reads per-window slices

**Files:**
- Modify: `ui/src/session_manager.ts`, `ui/src/main.ts`

- [ ] **Step 1: Read current window geometry helper**

Add to `session_manager.ts` imports: `import { getCurrentWindow } from '@tauri-apps/api/window';` (already imported). Add a geometry reader:
```ts
async function readGeometry() {
  const w = getCurrentWindow();
  const [pos, size, max] = await Promise.all([w.outerPosition(), w.innerSize(), w.isMaximized()]);
  return { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: max };
}
```

- [ ] **Step 2: Replace `doSaveSession` to push this window's slice**

```ts
async function doSaveSession(): Promise<void> {
  const label = getCurrentWindow().label;
  const { docs, active, browserTab } = buildSessionPayloadFromStore();
  try {
    const geometry = await readGeometry();
    await invoke('save_window_session', { input: { label, geometry, docs, active, browserTab } });
  } catch (e) {
    console.error('save_window_session failed:', e);
  }
}
```
(Tauri camelCases the top-level `input` arg; nested fields are already camelCase to match `SaveWindowInput`/`SaveDocInput`.)

- [ ] **Step 3: `window_closing` in the close flush**

In `installCloseFlush`, after `await flushSessionNow();` add:
```ts
try { await invoke('window_closing', { label: getCurrentWindow().label }); }
catch (e) { console.error('window_closing failed:', e); }
```
(Order: flush this window's final slice first so the backend has it, then run the close transaction.)

- [ ] **Step 4: Restore from the window slice in `bootstrap`**

In `main.ts` `bootstrap`, replace the `load_session`/`restoreSession` block with:
```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
// …
const label = getCurrentWindow().label;
let restored = false;
try {
  const w = await invoke<LoadedWindowSession | null>('get_window_session', { label });
  if (w) restored = await sessionManager.restoreSession({ version: 2, docs: w.docs, active: w.active, browser_tab: w.browser_tab });
} catch (e) { console.error('Window session restore failed:', e); }
```
`restoreSession`'s parameter is structurally `{ docs, active, browser_tab }`; pass the window slice's fields. (Keep `LoadedSession` type compatible or import `LoadedWindowSession` and adapt.)

- [ ] **Step 5: Typecheck + unit + commit**

Run: `cd ui && npm run typecheck && npm run test:unit`
Expected: PASS.
```bash
git add ui/src/session_manager.ts ui/src/main.ts
git commit -m "feat(ui/session): push & restore per-window slices keyed by window label"
```

### Task 6.3: targeted `activate-doc` listener

**Files:**
- Modify: `ui/src/main.ts`

- [ ] **Step 1: Add the listener next to the existing `open-file` listener**

```ts
listen<string>('activate-doc', (event) => {
  const tab = store.findDocByPath(event.payload);
  if (tab) store.setActive(tab.id);
  else openFile(event.payload); // not actually open here — open it
}).catch(() => {});
```
The `open-file` listener is unchanged (now delivered targeted from the backend).

- [ ] **Step 2: Typecheck + commit**

Run: `cd ui && npm run typecheck` → PASS.
```bash
git add ui/src/main.ts
git commit -m "feat(ui): activate-doc listener for reuse-if-open launch routing"
```

---

## Phase 7 — New-window UX

### Task 7.1: `window.new` + `window.closeAll` actions (hotkey + command overlay)

**Files:**
- Modify: `ui/src/actions.ts`, and the action-list construction site (search for where `spec(...)` rows are built — same file, after line 140).

- [ ] **Step 1: Add the action ids + default shortcut**

In `actions.ts`: add to the `ActionId` union: `| "window.new" | "window.closeAll"`. Add to `DEFAULT_ACTION_SHORTCUTS`: `"window.new": ["Ctrl+Shift+N"],`. (`window.closeAll` has no default shortcut → add `"window.closeAll"` to `NO_DEFAULT_ACTION_IDS`.)

- [ ] **Step 2: Add the specs to the action list**

Where the action array is built (the `spec("file.new", …)` rows), add:
```ts
spec("window.new", "New Window", "File", "Open a new window"),
spec("window.closeAll", "Close All Windows", "File", "Close every open window (restored next launch)"),
```

- [ ] **Step 3: Wire `run` for these actions**

In `main.ts` where actions are given their `run` handlers (the `ActionContext`/registry wiring that maps action ids to behaviour), add:
```ts
case 'window.new': await invoke('new_window'); break;
case 'window.closeAll': {
  const { getAllWindows } = await import('@tauri-apps/api/window');
  for (const w of await getAllWindows()) await w.close(); // each runs its onCloseRequested -> flush + window_closing
  break;
}
```
(Closing every window: the last one hits the backend `PreservedForQuit` branch, so the whole set restores next launch. Requires `core:window:allow-close`, already granted.)

- [ ] **Step 4: Manual-only behaviour note**

Hotkey dispatch + command-overlay listing are covered by the existing `keybindings.test.ts`/overlay tests structurally; the *effect* (a real new OS window) is **not** e2e-testable (Phase 8). Run `cd ui && npm run typecheck && npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/actions.ts ui/src/main.ts
git commit -m "feat(ui): New Window (Ctrl+Shift+N) + Close All Windows actions"
```

### Task 7.2: Tab context menu with disabled "Move to New Window"

**Files:**
- Modify: `ui/src/tabbar.ts`
- Create: `ui/src/tab_context_menu.test.ts`

- [ ] **Step 1: Write a failing unit test for the menu items**

Extract the item list into a pure builder so it is testable. `ui/src/tab_context_menu.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTabContextItems } from './tabbar.ts';

test('tab context menu shows a disabled Move to New Window affordance', () => {
  const items = buildTabContextItems({ onClose: () => {} });
  const move = items.find((i) => i.label === 'Move to New Window');
  assert.ok(move, 'item present');
  assert.equal(move!.disabled, true);
  const close = items.find((i) => i.label === 'Close Tab');
  assert.ok(close && !close.disabled);
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd ui && npm run test:unit`
Expected: FAIL — `buildTabContextItems` not exported.

- [ ] **Step 3: Implement the builder + wire `contextmenu`**

In `tabbar.ts`, add (and export):
```ts
import { openContextMenu, type MenuItem } from './context_menu.js';

export function buildTabContextItems(handlers: { onClose: () => void }): MenuItem[] {
  return [
    { label: 'Close Tab', onSelect: handlers.onClose },
    // Phase-2 affordance: disabled until cross-window handoff lands.
    { label: 'Move to New Window', onSelect: () => {}, disabled: true },
  ];
}
```
Then, where each tab element is created in `createTabBar`, attach:
```ts
tabEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY, buildTabContextItems({ onClose: () => handlers.onClose(tab.id) }));
});
```
(Use the existing `handlers.onClose` the tab bar already has for the close button.)

- [ ] **Step 4: Run green; typecheck**

Run: `cd ui && npm run test:unit && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/tabbar.ts ui/src/tab_context_menu.test.ts
git commit -m "feat(ui): tab context menu with disabled Move-to-New-Window affordance"
```

---

## Phase 8 — Full gate + manual verification

### Task 8.1: Run the full pre-PR gate

- [ ] **Step 1: Run `just check`**

Run: `just check`
Expected: fmt clean, Rust tests pass, clippy clean, UI typecheck/unit/build pass, theme + package smoke pass. Fix anything red. (Baseline: per memory there are ~7 pre-existing e2e fails on this box; the gate is "no NEW failures beyond those". `just check` does not run e2e — if you run e2e separately, hold to that baseline.)

- [ ] **Step 2: Commit any fmt/clippy fixups**

```bash
git add -A && git commit -m "chore(multiwindow): fmt + clippy cleanup"
```

### Task 8.2: Manual verification on a real `just run` (NOT e2e-coverable)

Per CLAUDE.md, multi-window / native window mgmt / geometry / single-instance are not reachable by the mocked-Chromium e2e suite. Walk this checklist by hand and record results in the PR description:

- [ ] Two windows, edit unsaved docs in both, **Close All** (or quit) → relaunch → both windows + both unsaved docs restored; geometry, active tab, focused window correct.
- [ ] Three windows, close one → relaunch → only the other two restored.
- [ ] Second instance `btr-md <newfile>` while two windows open → opens in the MRU-focused window only (not all).
- [ ] Second instance with a file already open → focuses the owning window + activates its tab.
- [ ] Bare relaunch (no file, e.g. taskbar middle-click) → a new empty window.
- [ ] Geometry restore under X11 and Wayland (size+maximized reliable; position best-effort on Wayland — acceptable).
- [ ] Save authority: a doc owned by window A cannot be saved/dropped from window B (try via dev console `invoke`).
- [ ] `kill -9` the process mid-edit → relaunch restores the last snapshot.
- [ ] Ctrl+Shift+N and the command-overlay "New Window" both open a window; tab context menu shows a grayed "Move to New Window".

### Task 8.3: Finish the branch

- [ ] Rebase on `master` (reconcile with the landed Close button — ensure it routes through `window_closing`). Re-run `just check`.
- [ ] Use `superpowers:finishing-a-development-branch` to merge `feat/multiwindow-session` → `master`, then `git worktree remove .worktrees/multiwindow-session` and delete the branch.

---

## Self-Review (author checklist — done)

- **Spec coverage:** §1 arch → Phases 2–4; §2 schema v2 → Phase 1; §3 restore + close transaction → Phases 3–4 + 6.2; §4 launch routing → Phase 5; §5 new-window UX (incl. grayed Move) → Phase 7; §6 capabilities → Phase 0; §7 Wayland → Task 1.1 default + 8.2; §8 SessionStore API → Phase 3; §9 testing → tests in every phase + Phase 8. Close All Windows → Task 7.1. All covered.
- **Placeholder scan:** none — every code/test step has concrete content; compiler-driven steps (2.2) list exact transforms + call sites.
- **Type consistency:** `register(owner, path, contents)` / `register_restored(owner, path, base, state)` / `set_active(label, doc)` / `is_active(label, doc)` / `owner_of` / `owns` / `find_by_path` used consistently across Phases 2–5; `SaveWindowInput`(Rust) ↔ `SaveWindowPayload`(TS) field names match (`label`, `geometry`, `docs`, `active`, `browserTab`/`browser_tab`); `CloseOutcome`, `LaunchRoute`, `MruOrder` referenced consistently.
- **Known follow-ups (phase 2, by design):** functional Move-to-New-Window (ACK protocol; grants keyed by `window_label`+`doc_id`) and drag-tab-out remain deferred.
