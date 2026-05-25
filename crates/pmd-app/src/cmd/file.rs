//! File commands: open / save / dialog / initial-path.
//!
//! # Security model
//!
//! The renderer is not trusted to nominate arbitrary filesystem paths. Open
//! and save commands therefore distinguish between two kinds of paths:
//!
//! - **Scope-admitted paths**: paths the *backend* (this process, not the
//!   renderer) has admitted via a trusted entry point. Trusted entry points
//!   are the CLI argv parser, the OS file dialog (`open_dialog` /
//!   `save_dialog`), the initial recents seeding from those entry points,
//!   and `request_open_file` only for paths that already pass an admission
//!   gate (see below). Once admitted, scope membership is permanent for
//!   process lifetime.
//!
//! - **Currently active path**: `AppState::current_path`, the canonical path
//!   of the file the user is editing right now. `save_file` requires the
//!   target to equal `current_path` (or to be a fresh save-as target the
//!   user just confirmed via `save_dialog`). This narrows authority so a
//!   compromised renderer can't overwrite an arbitrary previously-opened
//!   file — only the active buffer.
//!
//! ## `request_open_file` admission
//!
//! `request_open_file` is the renderer's entry point for paths it has been
//! given by Tauri events (the `open-file` emit, recents picks, drag/drop).
//! We admit a path only when one of the following holds:
//!
//! 1. It is already in the scope (re-open without re-prompting).
//! 2. It appears in the persisted recents list (the user previously chose it
//!    through a trusted entry point).
//!
//! Anything else is rejected with a clear error. To open an arbitrary new
//! file, the user must go through `open_dialog`, which is OS-mediated and
//! cannot be triggered by markup alone.
//!
//! ## TOCTOU
//!
//! All read/write paths use the canonical form returned by admission. The
//! window between canonicalise and open is unavoidably non-zero on a
//! filesystem we don't control, but reading by the canonical path (rather
//! than the renderer's input) keeps the attack surface to "swap the inode
//! at the canonical path after admit" — which a local attacker who can
//! already write the user's home dir can do regardless of our checks.
//! `save_file` additionally opens with `O_NOFOLLOW` (Unix) so a
//! mid-flight symlink swap cannot redirect the write.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
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

/// Markdown extensions we accept. Kept in one place so UI and backend agree.
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

fn is_markdown_path(p: &Path) -> bool {
    let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let lower = ext.to_lowercase();
    MARKDOWN_EXTENSIONS.iter().any(|e| *e == lower)
}

#[derive(Serialize)]
pub struct FileBuffer {
    pub path: PathBuf,
    pub contents: String,
}

/// Set the "currently active" path on `AppState`. Called by every successful
/// open and by save-as. Lock-poison-tolerant.
fn set_current(state: &crate::AppState, path: Option<PathBuf>) {
    let mut cur = state
        .current_path
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cur = path;
}

fn current(state: &crate::AppState) -> Option<PathBuf> {
    state
        .current_path
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
}

/// Push to recents, but treat I/O / parse failures as non-fatal: log and
/// move on. Open commands must not fail just because the recents file is
/// corrupt or unwritable.
fn try_push_recent(path: &PathBuf) {
    if let Err(e) = crate::state::recents::push(path) {
        eprintln!(
            "[preview-md] could not record {} in recents: {}",
            path.display(),
            e
        );
    }
}

/// Start (or restart) the file watcher for `path` on the shared state's
/// watcher slot. Idempotent across opens.
fn rewatch(app: &tauri::AppHandle, path: &Path) {
    let state = app.state::<crate::AppState>();
    state.watcher.set_target(app.clone(), path.to_path_buf());
}

#[tauri::command]
pub async fn open_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<FileBuffer, String> {
    // Read the canonical path, not the renderer's input — admission stored
    // the canonical form, and using it here removes a TOCTOU step between
    // "scope says yes" and "read".
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    if !state.scope.check_canonical(&canon) {
        return Err(format!("path not in active scope: {}", canon.display()));
    }
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    set_current(&state, Some(canon.clone()));
    rewatch(&app, &canon);
    Ok(FileBuffer {
        path: canon,
        contents,
    })
}

/// User-initiated open. The renderer calls this from Tauri-event-driven
/// entry points (drag/drop, recents, the `open-file` event).
///
/// Admission rule: the path must be either already-scoped or present in the
/// persisted recents list. Anything else is rejected — to open a brand new
/// file the user must go through `open_dialog`. See the module-level docs
/// for the full security model.
#[tauri::command]
pub async fn request_open_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<FileBuffer, String> {
    if !is_markdown_path(&path) {
        return Err(format!(
            "request_open_file refuses non-markdown extension: {}",
            path.display()
        ));
    }
    if !path.exists() {
        return Err(format!(
            "request_open_file: path does not exist: {}",
            path.display()
        ));
    }

    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    if !is_markdown_path(&canon) {
        return Err(format!(
            "request_open_file refuses canonical non-markdown target: {}",
            canon.display()
        ));
    }

    // Admission gate: either already scoped, or in recents.
    let already_scoped = state.scope.check_canonical(&canon);
    let in_recents = crate::state::recents::contains_canonical_eq(&canon);
    if !already_scoped && !in_recents {
        return Err(format!(
            "request_open_file: {} is not in scope or recents; use the file dialog to open new paths",
            canon.display()
        ));
    }

    // It's fine to re-admit an already-scoped path; HashSet inserts are
    // idempotent. For recents-only paths this is the moment we add the
    // canonical form to the in-process scope.
    let canon = state.scope.allow_canonical(&canon);
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    set_current(&state, Some(canon.clone()));
    rewatch(&app, &canon);
    Ok(FileBuffer {
        path: canon,
        contents,
    })
}

#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    contents: String,
) -> Result<(), String> {
    // Authorise by *active* path, not scope membership. The scope is
    // append-only, so a path opened earlier in the session would otherwise
    // remain writable forever; restricting `save_file` to the current path
    // means at most one file is overwritable at any moment.
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    let active = current(&state);
    let authorised = match active.as_deref() {
        Some(active_canon) => active_canon == canon.as_path(),
        None => false,
    };
    if !authorised {
        return Err(format!(
            "save_file refuses {}: not the active file",
            canon.display()
        ));
    }
    // Belt-and-braces: even the active path must still be in scope.
    if !state.scope.check_canonical(&canon) {
        return Err("path not in active scope".into());
    }
    write_no_follow(&canon, contents.as_bytes()).map_err(|e| e.to_string())?;
    // After a successful save, ensure the watcher is pointing at the
    // canonical path (it might not be, for an untitled buffer that was
    // just saved-as). Idempotent for the common case.
    rewatch(&app, &canon);
    Ok(())
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
pub fn get_open_dialog_on_start(state: tauri::State<'_, crate::AppState>) -> bool {
    let mut flag = state
        .open_dialog_on_start
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let should_open = *flag;
    *flag = false;
    should_open
}

#[tauri::command]
pub async fn open_dialog(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<FileBuffer>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", MARKDOWN_EXTENSIONS)
        .blocking_pick_file();

    if let Some(path) = file_path {
        let canon = path.into_path().map_err(|e| e.to_string())?;
        let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;
        let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
        try_push_recent(&canon);
        set_current(&state, Some(canon.clone()));
        rewatch(&app, &canon);
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
        // The renderer's next call will be `save_file`; pre-set the active
        // path so that authorisation succeeds without an additional round
        // trip, and start watching the new target.
        set_current(&state, Some(canon.clone()));
        rewatch(&app, &canon);
        Ok(Some(canon))
    } else {
        Ok(None)
    }
}

/// Notify the backend that the renderer has switched to an untitled buffer
/// ("new file"). Clears the active path and stops watching.
#[tauri::command]
pub fn clear_active_file(state: tauri::State<'_, crate::AppState>) {
    set_current(&state, None);
    state.watcher.clear();
}
