pub mod cli;
pub mod cmd;
pub mod doc;
pub mod navigation_policy;
pub mod path_scope;
pub mod preview;
pub mod state;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

/// Build a webview window with optional restored geometry. Used by startup
/// (restore spawner) and the `new_window` command so window config lives in one
/// place. Geometry position is best-effort on Wayland.
///
/// Each window gets its OWN [`navigation_policy::NavigationGate`]: the gate is a
/// one-shot that admits exactly the first shell load, so sharing one across
/// windows would deny every window past the first (blank webview).
pub fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    geometry: Option<&state::session::WindowGeometry>,
) -> tauri::Result<tauri::WebviewWindow> {
    let gate = Arc::new(navigation_policy::NavigationGate::new(
        "tauri://localhost".parse().expect("valid app shell URL"),
    ));
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
        Some(g) => {
            b = b
                .inner_size(g.width as f64, g.height as f64)
                .position(g.x as f64, g.y as f64);
        }
        None => {
            b = b.inner_size(1100.0, 720.0);
        }
    }
    let win = b.build()?;
    if matches!(geometry, Some(g) if g.maximized) {
        let _ = win.maximize();
    }
    Ok(win)
}

/// Shared application state.
///
/// File-lifecycle authority lives in [`doc::DocRegistry`] (`docs`): it owns the
/// per-`DocId` `FileState`, merge ancestor, path, and the **active-doc** slot
/// that gates save authorisation (writes are only ever permitted to the active
/// document — see `cmd::doc::save_doc`). `watcher` holds one file watcher per
/// open file-backed document. This replaces the previous single
/// `current_path` + single-watcher design.
pub struct AppState {
    pub scope: path_scope::PathScope,
    pub initial_path: std::sync::Mutex<Option<PathBuf>>,
    /// Whether the frontend should open the OS file dialog once startup has
    /// completed. Set by the desktop "Open File..." action.
    pub open_dialog_on_start: std::sync::Mutex<bool>,
    /// The document registry: source of truth for every open document.
    pub docs: doc::DocRegistry,
    /// One file watcher per open file-backed document.
    pub watcher: watcher::WatcherSet,
    /// Recursive watcher for the UI workspace root (sidebar tree refresh).
    pub workspace_watcher: watcher::WorkspaceTreeWatcher,
    /// In-memory, single-writer store of the live per-window session.
    pub sessions: state::window_session::SessionStore,
    /// Most-recently-focused window ordering, for launch routing.
    pub mru: std::sync::Mutex<state::focus_order::MruOrder>,
}

impl AppState {
    pub fn new(initial_path: Option<PathBuf>) -> Self {
        Self {
            scope: path_scope::PathScope::new(),
            initial_path: std::sync::Mutex::new(initial_path),
            open_dialog_on_start: std::sync::Mutex::new(false),
            docs: doc::DocRegistry::new(),
            watcher: watcher::WatcherSet::new(),
            workspace_watcher: watcher::WorkspaceTreeWatcher::new(),
            sessions: state::window_session::SessionStore::new(),
            mru: std::sync::Mutex::new(Default::default()),
        }
    }
}
