use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// Write `contents` to `path` while refusing to follow symlinks.
///
/// The scope check happens before the write, so an attacker who can place
/// files in the parent directory of an allowed-but-nonexistent path could
/// race to plant a symlink between the check and the write. We mitigate
/// the race two ways:
///
/// 1. On Unix, open with `O_NOFOLLOW` so the kernel refuses to follow a
///    symlink at the final path component.
/// 2. On other platforms, fall back to `std::fs::write` after a
///    best-effort `symlink_metadata` check.
fn write_no_follow(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    // Pre-write best-effort symlink check (catches the common case even on
    // platforms without O_NOFOLLOW).
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "refusing to write through a symlink",
            ));
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)?;
        f.write_all(contents)?;
        f.sync_all()?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        f.write_all(contents)?;
        f.sync_all()?;
        Ok(())
    }
}

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

/// User-initiated open. The renderer calls this when the user has performed
/// an OS-level trust action (drag/drop from the file manager, click in the
/// recents list, etc.) on a path that may not yet be in the active scope.
/// We canonicalise and admit the path to the scope here, then read it the
/// same way `open_file` does.
#[tauri::command]
pub async fn request_open_file(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<FileBuffer, String> {
    let canon = state.scope.allow(&path).map_err(|e| e.to_string())?;
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    crate::state::recents::push(&canon).map_err(|e| e.to_string())?;
    Ok(FileBuffer {
        path: canon,
        contents,
    })
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
    write_no_follow(&path, contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_initial_path(state: tauri::State<'_, crate::AppState>) -> Option<PathBuf> {
    // Recover from a poisoned lock — initial_path is a leaf Option with no
    // multi-step invariants that could be left half-written.
    state
        .initial_path
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
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
