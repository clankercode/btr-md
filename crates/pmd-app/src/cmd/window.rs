use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

use crate::cmd::session::{build_session_doc, SaveDocInput};
use crate::state::session::{ActiveTab, SessionWindow, WindowGeometry};

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(2); // "main" is window 1

/// Allocate a fresh window label that will not collide with restored windows.
fn fresh_window_label() -> String {
    let n = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    format!("w-{n}")
}

#[tauri::command]
pub fn set_window_title(window: Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

/// Create a fresh empty window (Rust-side). Returns its label.
#[tauri::command]
pub fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    let label = fresh_window_label();
    crate::build_window(&app, &label, None).map_err(|e| e.to_string())?;
    Ok(label)
}

/// Pure computation: the lowest `new_window` counter value that won't collide
/// with any already-restored label. "main" is window 1; restored labels look
/// like "w-{N}". Returns one past the highest restored N (min 2, so an empty
/// session keeps the initial counter).
fn next_after<I: IntoIterator<Item = String>>(existing: I) -> u64 {
    let mut max_n = 1u64;
    for label in existing {
        if let Some(n) = label.strip_prefix("w-").and_then(|s| s.parse::<u64>().ok()) {
            max_n = max_n.max(n);
        }
    }
    max_n + 1
}

/// Ensure `new_window` never reuses a label already restored from the session.
/// Bump the global counter past the highest restored `w-{N}`.
pub fn reserve_window_labels<I: IntoIterator<Item = String>>(existing: I) {
    NEXT_WINDOW.fetch_max(next_after(existing), Ordering::Relaxed);
}

#[derive(Debug, PartialEq, Eq)]
pub enum LaunchRoute {
    NewWindow,
    ReuseWindow(String), // file already open here -> focus + activate
    ForwardTo(String),   // open file as a new tab in this window
}

/// What windows to build at startup (`main.rs` setup).
///
/// A "launch intent" is a file passed on the command line / via xdg-open, or a
/// `--open-dialog` request: something the *first fresh* window should act on by
/// consuming the global initial-path / open-dialog flag (see the frontend
/// `bootstrap`). A restored window carries a persisted session slice and must
/// NOT swallow that intent — otherwise xdg-opening a file would silently
/// hijack a restored window instead of opening a new one.
#[derive(Debug, PartialEq, Eq)]
pub enum StartupWindows {
    /// No session to restore: build a single `main` window. The frontend opens
    /// the launch file / dialog there, or shows the welcome tab.
    JustMain,
    /// Restore the persisted session windows only (no launch intent).
    RestoreOnly,
    /// Restore the persisted session windows AND mint one extra fresh window to
    /// host the launch intent, so the whole prior workspace comes back and the
    /// xdg-opened file lands in its own new window.
    RestorePlusLaunch,
}

/// Decide the startup window set from whether a launch intent is present and
/// whether the persisted session has any windows. Pure; unit-tested.
pub fn plan_startup(has_launch_intent: bool, has_session: bool) -> StartupWindows {
    match (has_session, has_launch_intent) {
        (false, _) => StartupWindows::JustMain,
        (true, false) => StartupWindows::RestoreOnly,
        (true, true) => StartupWindows::RestorePlusLaunch,
    }
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
    if paths.is_empty() {
        return LaunchRoute::NewWindow;
    }
    for p in paths {
        if let Some(owner) = owner_of_path(p) {
            return LaunchRoute::ReuseWindow(owner);
        }
    }
    match mru_live {
        Some(label) => LaunchRoute::ForwardTo(label),
        None => LaunchRoute::NewWindow,
    }
}

#[cfg(test)]
mod routing_tests {
    use super::*;
    use std::path::{Path, PathBuf};
    #[test]
    fn bare_relaunch_opens_new_window() {
        assert_eq!(
            route_launch(&[], |_| None, Some("main".into())),
            LaunchRoute::NewWindow
        );
    }
    #[test]
    fn already_open_file_reuses_owner() {
        let open = PathBuf::from("/tmp/a.md");
        let r = route_launch(
            &[open],
            |p| (p == Path::new("/tmp/a.md")).then(|| "w-2".to_string()),
            Some("main".into()),
        );
        assert_eq!(r, LaunchRoute::ReuseWindow("w-2".into()));
    }
    #[test]
    fn new_file_forwards_to_mru() {
        let r = route_launch(
            &[PathBuf::from("/tmp/new.md")],
            |_| None,
            Some("main".into()),
        );
        assert_eq!(r, LaunchRoute::ForwardTo("main".into()));
    }
    #[test]
    fn new_file_with_no_live_window_opens_new() {
        let r = route_launch(&[PathBuf::from("/tmp/new.md")], |_| None, None);
        assert_eq!(r, LaunchRoute::NewWindow);
    }

    #[test]
    fn no_session_always_builds_just_main() {
        assert_eq!(plan_startup(false, false), StartupWindows::JustMain);
        assert_eq!(plan_startup(true, false), StartupWindows::JustMain);
    }

    #[test]
    fn session_without_launch_intent_restores_only() {
        assert_eq!(plan_startup(false, true), StartupWindows::RestoreOnly);
    }

    #[test]
    fn session_with_launch_intent_restores_plus_extra_window() {
        // The xdg-open bug: a launch file alongside a saved session must restore
        // the whole workspace AND open the file in a new window.
        assert_eq!(plan_startup(true, true), StartupWindows::RestorePlusLaunch);
    }
}

/// One window's live slice as sent by the frontend for `save_window_session`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWindowInput {
    pub label: String,
    pub geometry: WindowGeometry,
    pub docs: Vec<SaveDocInput>,
    pub active: Option<ActiveTab>,
    pub browser_tab: bool,
}

/// Push one window's live slice into the SessionStore + persist.
#[tauri::command]
pub async fn save_window_session(
    state: tauri::State<'_, crate::AppState>,
    input: SaveWindowInput,
) -> Result<(), String> {
    let docs = input
        .docs
        .into_iter()
        .filter_map(|d| build_session_doc(&state, d))
        .collect();
    state.sessions.upsert(SessionWindow {
        label: input.label,
        geometry: input.geometry,
        docs,
        active: input.active,
        browser_tab: input.browser_tab,
    });
    state.sessions.persist().map_err(|e| e.to_string())
}

/// Return one window's slice for restore-on-boot (None if not in the session).
#[tauri::command]
pub fn get_window_session(
    state: tauri::State<'_, crate::AppState>,
    label: String,
) -> Option<SessionWindow> {
    state
        .sessions
        .snapshot()
        .windows
        .into_iter()
        .find(|w| w.label == label)
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

/// One closed window as shown in the History menu.
#[derive(Serialize)]
pub struct ClosedWindowSummary {
    pub tabs: Vec<String>,
    pub browser_tab: bool,
}

fn summarize_closed_window(window: &crate::state::session::SessionWindow) -> ClosedWindowSummary {
    let tabs = window
        .docs
        .iter()
        .map(|d| {
            d.path
                .as_deref()
                .and_then(|p| std::path::Path::new(p).file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        })
        .collect();
    ClosedWindowSummary {
        tabs,
        browser_tab: window.browser_tab,
    }
}

/// List recently closed windows for the History menu.
#[tauri::command]
pub fn get_recently_closed_windows(
    state: tauri::State<'_, crate::AppState>,
) -> Vec<ClosedWindowSummary> {
    state
        .sessions
        .recently_closed()
        .iter()
        .map(summarize_closed_window)
        .collect()
}

/// Reopen the closed window at `index` (0 = oldest) in a new window.
/// Returns the label of the newly created window.
#[tauri::command]
pub fn restore_recently_closed_window(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
    index: usize,
) -> Result<String, String> {
    let window = state
        .sessions
        .take_recently_closed(index)
        .ok_or_else(|| "No recently closed window at that index".to_string())?;
    let label = fresh_window_label();
    let geometry = Some(window.geometry.clone());
    state.sessions.upsert(crate::state::session::SessionWindow {
        label: label.clone(),
        ..window
    });
    state.sessions.persist().map_err(|e| e.to_string())?;
    crate::build_window(&app, &label, geometry.as_ref()).map_err(|e| e.to_string())?;
    Ok(label)
}

/// Forget all recently closed windows.
#[tauri::command]
pub fn clear_recently_closed_windows(state: tauri::State<'_, crate::AppState>) {
    state.sessions.clear_recently_closed();
}

/// Mark the app as intentionally quitting (Close All / Quit) so the subsequent
/// per-window `window_closing` calls preserve every window — the whole workspace
/// is restored next launch. Persists the current full snapshot immediately so it
/// survives even if a window never reports its close.
#[tauri::command]
pub fn begin_quit(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.sessions.begin_quit();
    state.sessions.persist().map_err(|e| e.to_string())
}

/// Schedule a fresh process of `exe` to start after this process exits.
///
/// Required because `tauri-plugin-single-instance` holds a D-Bus name (Linux)
/// / socket (macOS) while we are alive: spawning *before* exit makes the child
/// treat us as the primary instance, forward empty argv, and exit itself.
#[cfg(unix)]
fn schedule_restart_after_exit(exe: &std::path::Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt;

    let parent = std::process::id();
    // Single-quote for the shell; escape any embedded `'`.
    let quoted = exe.to_string_lossy().replace('\'', "'\\''");
    // - `trap '' HUP` + new process group: survive SIGHUP when the parent was
    //   started from a terminal (common with `just run`).
    // - Wait until the parent PID is gone so the single-instance D-Bus name is
    //   released before we `exec`.
    // - Cap the wait (~20s) so a stuck parent cannot leave a zombie waiter.
    let script = format!(
        "trap '' HUP; \
         n=0; \
         while kill -0 {parent} 2>/dev/null; do \
           sleep 0.05; \
           n=$((n+1)); \
           if [ \"$n\" -gt 400 ]; then break; fi; \
         done; \
         exec '{quoted}'"
    );
    std::process::Command::new("sh")
        .arg("-c")
        .arg(script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("failed to schedule restart: {e}"))?;
    Ok(())
}

#[cfg(not(unix))]
fn schedule_restart_after_exit(exe: &std::path::Path) -> Result<(), String> {
    // Best-effort fallback (Linux is the primary target). Immediate spawn may
    // race the single-instance lock if the parent has not exited yet.
    std::process::Command::new(exe)
        .spawn()
        .map_err(|e| format!("failed to spawn restart process: {e}"))?;
    Ok(())
}

/// Restart the app process while preserving the full workspace session.
///
/// Schedules a fresh binary **without** the original CLI args (restore comes
/// only from the session, not a re-applied launch path), marks the session as
/// a deliberate quit, persists it, then exits. The frontend should flush this
/// window's live buffers first.
///
/// Multi-window note: only the initiating window is flushed by the frontend
/// before this command runs. Peer windows keep their last debounced
/// `save_window_session` snapshot (same ~300ms window as a crash).
#[tauri::command]
pub fn restart_app(app: AppHandle, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    let path = tauri::process::current_binary(&app.env()).map_err(|e| e.to_string())?;
    // Arm the relaunch *before* begin_quit so a schedule failure does not leave
    // the session store stuck in quitting mode.
    schedule_restart_after_exit(&path)?;

    state.sessions.begin_quit();
    if let Err(e) = state.sessions.persist() {
        // Relaunch is already armed; still exit so the child can start.
        eprintln!("[btr-md] restart: session persist failed: {e}");
    }

    // Hard exit so the single-instance lock drops and the scheduled child can
    // become the new primary instance.
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_after_bumps_past_highest_restored() {
        assert_eq!(
            next_after(["w-2", "w-5", "main", "garbage"].map(String::from)),
            6
        );
    }

    #[test]
    fn next_after_empty_session_keeps_initial_counter() {
        assert_eq!(next_after(std::iter::empty::<String>()), 2);
    }

    #[test]
    fn next_after_ignores_main_and_non_window_labels() {
        assert_eq!(next_after(["main", "browser", "w-x"].map(String::from)), 2);
    }

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
