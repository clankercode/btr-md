pub mod cli;
pub mod cmd;
pub mod doc;
pub mod navigation_policy;
pub mod path_scope;
pub mod preview;
pub mod state;
pub mod watcher;

use std::path::PathBuf;

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
    /// In-memory, single-writer store of the live per-window session.
    pub sessions: state::window_session::SessionStore,
}

impl AppState {
    pub fn new(initial_path: Option<PathBuf>) -> Self {
        Self {
            scope: path_scope::PathScope::new(),
            initial_path: std::sync::Mutex::new(initial_path),
            open_dialog_on_start: std::sync::Mutex::new(false),
            docs: doc::DocRegistry::new(),
            watcher: watcher::WatcherSet::new(),
            sessions: state::window_session::SessionStore::new(),
        }
    }
}
