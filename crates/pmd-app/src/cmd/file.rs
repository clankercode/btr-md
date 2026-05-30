//! File commands: open / save-as dialog / initial-path.
//!
//! # Security model
//!
//! The renderer is not trusted to nominate arbitrary filesystem paths. Open
//! and save commands therefore distinguish between two kinds of paths:
//!
//! - **Scope-admitted paths**: paths the *backend* (this process, not the
//!   renderer) has admitted via a trusted entry point — the CLI argv parser,
//!   the OS file dialog (`open_dialog` / `save_dialog`), the initial recents
//!   seeding from those entry points, and `request_open_file` only for paths
//!   that already pass an admission gate (see below). Once admitted, scope
//!   membership is permanent for process lifetime.
//!
//! - **The active document**: `AppState::docs` tracks which `DocId` is active.
//!   `cmd::doc::save_doc` requires the target document to be the active one (and
//!   its path to be in scope). This narrows write authority so a compromised
//!   renderer can't overwrite an arbitrary previously-opened file — only the
//!   active buffer. See `crate::doc::registry` for the save-authority model.
//!
//! ## `request_open_file` admission
//!
//! `request_open_file` is the renderer's entry point for paths it has been
//! given by Tauri events (the `open-file` emit, recents picks, drag/drop). We
//! admit a path only when it is already in the scope (re-open) or appears in
//! the persisted recents list (the user previously chose it through a trusted
//! entry point). Anything else is rejected; new files must go through
//! `open_dialog`, which is OS-mediated and cannot be triggered by markup.
//!
//! ## TOCTOU
//!
//! All read/write paths use the canonical form returned by admission. Saving
//! opens with `O_NOFOLLOW` (Unix) so a mid-flight symlink swap cannot redirect
//! the write.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

use crate::doc::state::{DocId, FileState};

/// Write `contents` to `path` while refusing to follow symlinks.
///
/// 1. On Unix, open with `O_NOFOLLOW` so the kernel refuses a final-component
///    symlink. 2. Elsewhere, a best-effort `symlink_metadata` check first.
pub(crate) fn write_no_follow(path: &Path, contents: &[u8]) -> std::io::Result<()> {
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

/// What an open command returns: enough for the renderer to adopt the document
/// (its `doc_id`, canonical `path`, `contents`, and initial lifecycle `state`).
#[derive(Serialize)]
pub struct OpenedDoc {
    pub doc_id: DocId,
    pub path: PathBuf,
    pub contents: String,
    pub state: FileState,
}

/// Push to recents, treating I/O / parse failures as non-fatal.
fn try_push_recent(path: &PathBuf) {
    if let Err(e) = crate::state::recents::push(path) {
        eprintln!(
            "[preview-md] could not record {} in recents: {}",
            path.display(),
            e
        );
    }
}

/// Register a freshly-opened file in the registry and start watching it.
/// If `foreground` is true, also mark the document as the active one (the
/// save-authority target). Background opens (e.g. restoring a session tab
/// while another tab is already active) must NOT steal save authority, so they
/// pass `foreground = false` and rely on the explicit `set_active_doc` IPC
/// call that fires when the tab is actually focused.
fn register_opened(
    app: &tauri::AppHandle,
    state: &crate::AppState,
    canon: PathBuf,
    contents: String,
    foreground: bool,
) -> OpenedDoc {
    let contents_ui = contents.clone();
    let (doc_id, fstate) = state.docs.register(Some(canon.clone()), contents);
    if foreground {
        state.docs.set_active(doc_id);
    }
    state.watcher.set_target(app.clone(), doc_id, canon.clone());
    OpenedDoc {
        doc_id,
        path: canon,
        contents: contents_ui,
        state: fstate,
    }
}

#[tauri::command]
pub async fn open_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<OpenedDoc, String> {
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    if !state.scope.check_canonical(&canon) {
        return Err(format!("path not in active scope: {}", canon.display()));
    }
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    Ok(register_opened(&app, &state, canon, contents, true))
}

/// User-initiated open from a Tauri-event-driven entry point (drag/drop,
/// recents, the `open-file` event). Admission: already-scoped or in recents.
///
/// `background` mirrors the UI concept: a background open registers the doc
/// and starts watching it, but does NOT transfer save authority to it.
/// Authority is transferred only when the user activates the tab
/// (`set_active_doc` IPC). Foreground opens (the default) transfer authority
/// immediately, matching `open_dialog` behaviour.
#[tauri::command]
pub async fn request_open_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    background: Option<bool>,
) -> Result<OpenedDoc, String> {
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

    // Admission gates: already-scoped, in recents, OR within a folder the user
    // admitted via the file-browser picker (Phase 2 third gate).
    let already_scoped = state.scope.check_canonical(&canon);
    let in_recents = crate::state::recents::contains_canonical_eq(&canon);
    let under_allowed_dir = state.scope.is_within_allowed_dir(&canon);
    if !already_scoped && !in_recents && !under_allowed_dir {
        return Err(format!(
            "request_open_file: {} is not in scope, recents, or an allowed folder; use the file dialog to open new paths",
            canon.display()
        ));
    }

    let canon = state.scope.allow_canonical(&canon);
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    let foreground = !background.unwrap_or(false);
    Ok(register_opened(&app, &state, canon, contents, foreground))
}

#[tauri::command]
pub fn get_initial_path(state: tauri::State<'_, crate::AppState>) -> Option<PathBuf> {
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
) -> Result<Option<OpenedDoc>, String> {
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
        Ok(Some(register_opened(&app, &state, canon, contents, true)))
    } else {
        Ok(None)
    }
}

/// Pick a save-as target. Admits the chosen path to the scope and returns its
/// canonical form; the renderer then calls `save_doc` with this path so the
/// document is (re)bound and written in one authorised step.
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
