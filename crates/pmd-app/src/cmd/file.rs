use serde::Serialize;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

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

#[tauri::command]
pub async fn open_dialog(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<FileBuffer>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        let canon = path.into_path().map_err(|e| e.to_string())?;
        let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;
        let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
        crate::state::recents::push(&canon).map_err(|e| e.to_string())?;
        Ok(Some(FileBuffer {
            path: canon,
            contents,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_dialog(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    suggested_name: String,
) -> Result<Option<PathBuf>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();

    if let Some(path) = file_path {
        let canon = path.into_path().map_err(|e| e.to_string())?;
        let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;
        Ok(Some(canon))
    } else {
        Ok(None)
    }
}
