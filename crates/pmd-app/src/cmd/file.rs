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
//! entry point). Anything else is rejected; brand-new paths must arrive through
//! a trusted origin (`open_dialog` or CLI argv) before they can be opened.
//!
//! A target that passes the gates but does **not exist on disk** is *created*
//! rather than refused: an empty file is written and opened. This is the same
//! authority an existing-file open would have (the gates already proved the
//! user may read/write there), so it admits no new write capability. Creating
//! missing *parent directories* is confirmed first via a native OS dialog that
//! names every directory to be created.
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
use crate::preview::trust_roots::DocumentTrustContextForUi;

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

/// What an open command returns: enough for the renderer to adopt the document
/// (its `doc_id`, canonical `path`, `contents`, and initial lifecycle `state`).
#[derive(Serialize)]
pub struct OpenedDoc {
    pub doc_id: DocId,
    pub path: PathBuf,
    pub contents: String,
    pub state: FileState,
    pub trust_context: DocumentTrustContextForUi,
}

/// Push to recents, treating I/O / parse failures as non-fatal.
pub(crate) fn try_push_recent(path: &PathBuf) {
    if let Err(e) = crate::state::recents::push(path) {
        eprintln!(
            "[btr-md] could not record {} in recents: {}",
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
    window_label: &str,
    canon: PathBuf,
    contents: String,
    foreground: bool,
) -> Result<OpenedDoc, String> {
    let contents_ui = contents.clone();
    let (doc_id, fstate) = state
        .docs
        .register(window_label, Some(canon.clone()), contents);
    if foreground {
        state.docs.set_active(window_label, doc_id);
    }
    state.watcher.set_target(app.clone(), doc_id, canon.clone());
    let applied = crate::preview::trust_roots::apply_remembered_trust_for_document_global(
        window_label,
        doc_id,
        &canon,
    )?;
    Ok(OpenedDoc {
        doc_id,
        path: canon,
        contents: contents_ui,
        state: fstate,
        trust_context: applied.trust_context,
    })
}

#[tauri::command]
pub async fn open_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<OpenedDoc, String> {
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    if !state.scope.check_canonical(&canon) {
        return Err(format!("path not in active scope: {}", canon.display()));
    }
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    register_opened(&app, &state, window.label(), canon, contents, true)
}

/// User-initiated open from a Tauri-event-driven entry point (drag/drop,
/// recents, the `open-file` event). Admission: already-scoped or in recents.
///
/// `background` mirrors the UI concept: a background open registers the doc
/// and starts watching it, but does NOT transfer save authority to it.
/// Authority is transferred only when the user activates the tab
/// (`set_active_doc` IPC). Foreground opens (the default) transfer authority
/// immediately, matching `open_dialog` behaviour.
/// Run the user-open admission gates on `path` and return the **admitted
/// canonical path** (now permanently in scope) on success.
///
/// Used by `restore_dirty_doc`, which reconciles in-memory edits against the
/// file's current disk content and therefore *requires the file to exist*.
/// Applies the same security policy as the open path: a document-extension
/// check (markdown or HTML; before and after canonicalisation, to defeat
/// symlink-to-non-document swaps), file existence, then the three admission
/// gates. The renderer's regular open path (`request_open_file`) uses
/// [`plan_open_or_create`] instead, which tolerates a missing file and creates it.
pub(crate) fn admit_open_path(state: &crate::AppState, path: &Path) -> Result<PathBuf, String> {
    if !crate::path_scope::is_document_path(path) {
        return Err(format!(
            "request_open_file refuses non-document extension: {}",
            path.display()
        ));
    }
    if !path.exists() {
        return Err(format!(
            "request_open_file: path does not exist: {}",
            path.display()
        ));
    }

    let canon = crate::path_scope::PathScope::canonicalise(path).map_err(|e| e.to_string())?;
    if !crate::path_scope::is_document_path(&canon) {
        return Err(format!(
            "request_open_file refuses canonical non-document target: {}",
            canon.display()
        ));
    }
    check_admission_gates(state, &canon)?;
    Ok(state.scope.allow_canonical(&canon))
}

/// The three admission gates shared by every renderer-supplied open: a path is
/// admissible only when it is already-scoped, present in recents, OR within a
/// folder the user admitted via the file-browser picker (Phase 2 third gate).
/// Anything else is rejected; new paths must arrive through a trusted origin
/// (the OS dialog, CLI argv) before they can be opened.
fn check_admission_gates(state: &crate::AppState, canon: &Path) -> Result<(), String> {
    let already_scoped = state.scope.check_canonical(canon);
    let in_recents = crate::state::recents::contains_canonical_eq(canon);
    let under_allowed_dir = state.scope.is_within_allowed_dir(canon);
    if !already_scoped && !in_recents && !under_allowed_dir {
        return Err(format!(
            "request_open_file: {} is not in scope, recents, or an allowed folder; use the file dialog to open new paths",
            canon.display()
        ));
    }
    Ok(())
}

/// Outcome of admitting a renderer-supplied open path that may not yet exist.
/// The canonical target is admitted into the scope; the command layer is then
/// responsible for any filesystem effects (`missing_dirs` creation, touching
/// the empty file) and the user confirmation that gates them.
pub(crate) struct OpenOrCreatePlan {
    /// Admitted canonical target (in scope on return).
    pub canon: PathBuf,
    /// True if the file already exists on disk; false means it must be created.
    pub exists: bool,
    /// Canonical ancestor directories that must be created first, outermost-first.
    pub missing_dirs: Vec<PathBuf>,
}

/// Admit a renderer-supplied open path, tolerating a not-yet-existing file.
///
/// Shares the document-extension (markdown or HTML) and admission-gate policy
/// with [`admit_open_path`], but instead of rejecting a missing file it resolves
/// a creatable canonical target (see [`crate::path_scope::PathScope::resolve_creatable`])
/// and reports what would have to be created. The path is held to the same
/// admission gates as an existing open, so a missing file is only creatable
/// where the user could already open one — within scope, recents, or an
/// admitted folder. This is pure w.r.t. the filesystem (it never creates
/// anything); the caller performs the effects after confirming with the user.
pub(crate) fn plan_open_or_create(
    state: &crate::AppState,
    path: &Path,
) -> Result<OpenOrCreatePlan, String> {
    if !crate::path_scope::is_document_path(path) {
        return Err(format!(
            "request_open_file refuses non-document extension: {}",
            path.display()
        ));
    }

    if path.exists() {
        let canon = crate::path_scope::PathScope::canonicalise(path).map_err(|e| e.to_string())?;
        if !crate::path_scope::is_document_path(&canon) {
            return Err(format!(
                "request_open_file refuses canonical non-document target: {}",
                canon.display()
            ));
        }
        check_admission_gates(state, &canon)?;
        return Ok(OpenOrCreatePlan {
            canon: state.scope.allow_canonical(&canon),
            exists: true,
            missing_dirs: Vec::new(),
        });
    }

    let (canon, missing_dirs) =
        crate::path_scope::PathScope::resolve_creatable(path).map_err(|e| e.to_string())?;
    if !crate::path_scope::is_document_path(&canon) {
        return Err(format!(
            "request_open_file refuses canonical non-document target: {}",
            canon.display()
        ));
    }
    check_admission_gates(state, &canon)?;
    Ok(OpenOrCreatePlan {
        canon: state.scope.allow_canonical(&canon),
        exists: false,
        missing_dirs,
    })
}

#[tauri::command]
pub async fn request_open_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    background: Option<bool>,
) -> Result<OpenedDoc, String> {
    let plan = plan_open_or_create(&state, &path)?;
    let canon = plan.canon;

    if !plan.exists {
        // Opening a path that doesn't exist yet: create an empty file there so
        // the user lands in an editable buffer instead of an error. Creating
        // missing parent directories is a bigger commitment, so confirm it with
        // a native dialog that names exactly what will be created.
        if !plan.missing_dirs.is_empty() {
            let listing = plan
                .missing_dirs
                .iter()
                .map(|d| format!("  {}", d.display()))
                .collect::<Vec<_>>()
                .join("\n");
            let confirmed = app
                .dialog()
                .message(format!(
                    "{} does not exist. Create it and the following directories?\n\n{listing}",
                    canon.display()
                ))
                .title("Create new file")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                    "Create".into(),
                    "Cancel".into(),
                ))
                .blocking_show();
            if !confirmed {
                return Err("open cancelled: file creation declined".to_string());
            }
            if let Some(parent) = canon.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        std::fs::write(&canon, "").map_err(|e| e.to_string())?;
        // The parent dir now exists; admit it so siblings are browsable, exactly
        // as a trusted file-open would (best-effort, mirrors `open_dialog`).
        if let Some(parent) = canon.parent() {
            let _ = state.scope.allow_dir(parent);
        }
    }

    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    try_push_recent(&canon);
    let foreground = !background.unwrap_or(false);
    register_opened(&app, &state, window.label(), canon, contents, foreground)
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
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<OpenedDoc>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Documents", crate::path_scope::DOCUMENT_EXTENSIONS)
        .add_filter("Markdown", crate::path_scope::MARKDOWN_EXTENSIONS)
        .add_filter("HTML", crate::path_scope::HTML_EXTENSIONS)
        .blocking_pick_file();

    if let Some(path) = file_path {
        let canon = path.into_path().map_err(|e| e.to_string())?;
        let canon = state
            .scope
            .allow_file_and_parent(&canon)
            .map_err(|e| e.to_string())?;
        let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
        try_push_recent(&canon);
        Ok(Some(register_opened(
            &app,
            &state,
            window.label(),
            canon,
            contents,
            true,
        )?))
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

#[cfg(test)]
mod plan_tests {
    use super::plan_open_or_create;
    use crate::state::config_env_lock;

    /// Fresh AppState with a temp XDG_CONFIG_HOME so recents starts empty and a
    /// single admitted base dir. Returns (guard, state, base_dir).
    fn fixture() -> (
        std::sync::MutexGuard<'static, ()>,
        crate::AppState,
        tempfile::TempDir,
    ) {
        let lock = config_env_lock();
        let cfg = tempfile::tempdir().expect("cfg dir");
        std::env::set_var("XDG_CONFIG_HOME", cfg.path());
        // Leak the cfg dir for the test's lifetime by forgetting it is fine, but
        // we keep `base` separate so the admitted dir is what we control.
        let base = tempfile::tempdir().expect("base dir");
        let state = crate::AppState::new(None);
        state.scope.allow_dir(base.path()).expect("admit base");
        std::mem::forget(cfg);
        (lock, state, base)
    }

    #[test]
    fn missing_file_under_allowed_dir_is_creatable_with_no_missing_dirs() {
        let (_lock, state, base) = fixture();
        let target = base.path().join("fresh.md");

        let plan = plan_open_or_create(&state, &target).expect("admitted");

        assert!(!plan.exists, "file does not exist yet");
        assert!(plan.missing_dirs.is_empty(), "parent dir exists");
        assert_eq!(
            plan.canon,
            base.path().canonicalize().unwrap().join("fresh.md")
        );
        // The target was admitted into scope by the plan.
        assert!(state.scope.check_canonical(&plan.canon));
    }

    #[test]
    fn missing_file_with_missing_parent_dirs_lists_them() {
        let (_lock, state, base) = fixture();
        let target = base.path().join("notes").join("2026").join("fresh.md");

        let plan = plan_open_or_create(&state, &target).expect("admitted");

        assert!(!plan.exists);
        let base_canon = base.path().canonicalize().unwrap();
        assert_eq!(
            plan.missing_dirs,
            vec![
                base_canon.join("notes"),
                base_canon.join("notes").join("2026")
            ]
        );
    }

    #[test]
    fn existing_file_reports_exists_and_no_creation() {
        let (_lock, state, base) = fixture();
        let target = base.path().join("there.md");
        std::fs::write(&target, "hi").expect("write");

        let plan = plan_open_or_create(&state, &target).expect("admitted");

        assert!(plan.exists);
        assert!(plan.missing_dirs.is_empty());
    }

    #[test]
    fn non_admissible_missing_path_is_rejected() {
        let (_lock, state, _base) = fixture();
        // A different temp dir that was never admitted.
        let outside = tempfile::tempdir().expect("outside");
        let target = outside.path().join("nope.md");

        assert!(
            plan_open_or_create(&state, &target).is_err(),
            "missing file outside any allowed dir must be rejected"
        );
    }

    #[test]
    fn non_document_extension_is_rejected() {
        let (_lock, state, base) = fixture();
        let target = base.path().join("fresh.txt");

        assert!(plan_open_or_create(&state, &target).is_err());
    }

    #[test]
    fn html_extension_is_admitted_under_allowed_dir() {
        let (_lock, state, base) = fixture();
        let target = base.path().join("page.html");
        std::fs::write(&target, "<p>hi</p>").expect("write");

        let plan = plan_open_or_create(&state, &target).expect("html should open");
        assert!(plan.exists);
        assert!(plan.canon.ends_with("page.html"));
    }
}
