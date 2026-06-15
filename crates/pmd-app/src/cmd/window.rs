use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;
use tauri::{Manager, Window};

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
    let gate = app
        .state::<std::sync::Arc<crate::navigation_policy::NavigationGate>>()
        .inner()
        .clone();
    crate::build_window(&app, &label, None, gate).map_err(|e| e.to_string())?;
    Ok(label)
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
    fn window_slice_input_deserializes_camelcase() {
        let json = r#"{"label":"w-2","geometry":{"x":1,"y":2,"width":800,"height":600,"maximized":false},
                       "docs":[{"docId":3,"mode":"split","content":"hi"}],"active":{"doc":0},"browserTab":true}"#;
        let v: SaveWindowInput = serde_json::from_str(json).expect("camelCase");
        assert_eq!(v.label, "w-2");
        assert_eq!(v.docs[0].doc_id, 3);
        assert!(v.browser_tab);
    }
}
