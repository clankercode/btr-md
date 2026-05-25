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
///
/// Trust note: this command admits a renderer-supplied path to the scope
/// without an OS-level confirmation step. That means a compromised renderer
/// could expand the scope to arbitrary paths it can name. We mitigate by
/// (a) restricting to markdown-like extensions so reads can't be aimed at
/// e.g. `/etc/shadow`, and (b) reading and canonicalising before returning
/// — the caller gets the canonical path the scope now covers, not the raw
/// input. A stronger guarantee (real proof of user intent) would require
/// moving drag/drop and recents into Rust-side OS event handlers.
#[tauri::command]
pub async fn request_open_file(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<FileBuffer, String> {
    // Restrict admission to markdown-ish files. We check both the raw input
    // and the canonical target so a symlink whose name ends `.md` cannot be
    // used to aim the read at e.g. `/etc/passwd`.
    let is_md_ext = |p: &std::path::Path| -> bool {
        matches!(
            p.extension().and_then(|e| e.to_str()).map(str::to_lowercase),
            Some(ref ext) if ext == "md" || ext == "markdown" || ext == "mdown" || ext == "mkd"
        )
    };
    if !is_md_ext(&path) {
        return Err(format!(
            "request_open_file refuses non-markdown extension: {}",
            path.display()
        ));
    }
    // Canonicalise *without* admitting yet, so a symlink-to-non-md target
    // doesn't get a free entry in the scope.
    let canon = if path.exists() {
        std::fs::canonicalize(&path).map_err(|e| e.to_string())?
    } else {
        return Err(format!(
            "request_open_file: path does not exist: {}",
            path.display()
        ));
    };
    if !is_md_ext(&canon) {
        return Err(format!(
            "request_open_file refuses canonical non-markdown target: {}",
            canon.display()
        ));
    }
    let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;
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
