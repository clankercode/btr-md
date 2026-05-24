use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct FileBuffer {
    pub path: PathBuf,
    pub contents: String,
}

#[tauri::command]
pub async fn open_file(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<FileBuffer, String> {
    if !state.scope.check(&path) {
        return Err(format!("path not in active scope: {}", path.display()));
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    crate::state::recents::push(&path).map_err(|e| e.to_string())?;
    Ok(FileBuffer { path, contents })
}

#[tauri::command]
pub async fn save_file(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    contents: String,
) -> Result<(), String> {
    if !state.scope.check(&path) {
        return Err("path not in active scope".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_initial_path(state: tauri::State<'_, crate::AppState>) -> Option<PathBuf> {
    state.initial_path.lock().unwrap().take()
}
