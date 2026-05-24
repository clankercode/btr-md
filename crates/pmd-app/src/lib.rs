pub mod cli;
pub mod cmd;
pub mod path_scope;
pub mod state;

use std::path::PathBuf;

pub struct AppState {
    pub scope: path_scope::PathScope,
    pub initial_path: std::sync::Mutex<Option<PathBuf>>,
}
