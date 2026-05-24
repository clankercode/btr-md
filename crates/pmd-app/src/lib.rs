pub mod cli;
pub mod cmd;
pub mod path_scope;
pub mod state;

pub struct AppState {
    pub scope: path_scope::PathScope,
}
