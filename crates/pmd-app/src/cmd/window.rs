use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;
use tauri::Window;

use crate::cmd::session::{build_session_doc, SaveDocInput};
use crate::state::session::{ActiveTab, SessionWindow, WindowGeometry};

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(2); // "main" is window 1

#[tauri::command]
pub fn set_window_title(window: Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

/// Create a fresh empty window (Rust-side). Returns its label.
#[tauri::command]
pub fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    let n = NEXT_WINDOW.fetch_add(1, Ordering::Relaxed);
    let label = format!("w-{n}");
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
        let r = route_launch(&[PathBuf::from("/tmp/new.md")], |_| None, Some("main".into()));
        assert_eq!(r, LaunchRoute::ForwardTo("main".into()));
    }
    #[test]
    fn new_file_with_no_live_window_opens_new() {
        let r = route_launch(&[PathBuf::from("/tmp/new.md")], |_| None, None);
        assert_eq!(r, LaunchRoute::NewWindow);
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
