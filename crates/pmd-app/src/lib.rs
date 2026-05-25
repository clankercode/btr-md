pub mod cli;
pub mod cmd;
pub mod path_scope;
pub mod state;
pub mod watcher;

use std::path::PathBuf;

/// Shared application state. Backend file commands consult `current_path` so
/// `save_file` only authorises writes to the actively-open buffer (not every
/// path the scope has ever admitted), and so the file watcher tracks the
/// right file as the user switches between files.
pub struct AppState {
    pub scope: path_scope::PathScope,
    pub initial_path: std::sync::Mutex<Option<PathBuf>>,
    /// Whether the frontend should open the OS file dialog once startup has
    /// completed. Set by the desktop "Open File..." action.
    pub open_dialog_on_start: std::sync::Mutex<bool>,
    /// The canonical path of the file currently being edited, if any. Set
    /// by every successful open code path; cleared on "new file" /
    /// untitled buffer.
    pub current_path: std::sync::Mutex<Option<PathBuf>>,
    pub watcher: watcher::FileWatcher,
}

impl AppState {
    pub fn new(initial_path: Option<PathBuf>) -> Self {
        Self {
            scope: path_scope::PathScope::new(),
            initial_path: std::sync::Mutex::new(initial_path),
            open_dialog_on_start: std::sync::Mutex::new(false),
            current_path: std::sync::Mutex::new(None),
            watcher: watcher::FileWatcher::new(),
        }
    }
}
