//! Directory-browsing commands for the file-browser tab (Phase 2).
//!
//! # Security
//!
//! A base directory is admitted to the scope ONLY via [`pick_base_dir`] (the OS
//! folder picker) or by re-admitting a backend-persisted previously-trusted
//! base on startup — never from a renderer-supplied string, and never an
//! implicit `$HOME`. [`list_dir`] canonicalises both the directory and every
//! entry and re-checks each against the directory allowlist, so a symlink that
//! escapes the admitted base is silently dropped rather than traversed.

use serde::Serialize;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

use crate::path_scope::MARKDOWN_EXTENSIONS;
use crate::state::settings;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    /// Canonical path of the entry.
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_markdown: bool,
}

#[derive(Serialize)]
pub struct DirListing {
    /// Canonical path of the directory that was listed.
    pub dir: PathBuf,
    pub entries: Vec<DirEntry>,
}

fn is_markdown_name(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| {
            let lower = ext.to_lowercase();
            MARKDOWN_EXTENSIONS.iter().any(|e| *e == lower)
        })
        .unwrap_or(false)
}

/// List a directory's children. Refuses directories outside the allowlist and
/// silently drops entries (typically symlinks) that resolve outside it. Hides
/// dotfiles; sorts directories first, then case-insensitively by name.
#[tauri::command]
pub fn list_dir(
    state: tauri::State<'_, crate::AppState>,
    dir: PathBuf,
) -> Result<DirListing, String> {
    let canon = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    if !state.scope.check_dir_access(&canon) {
        return Err(format!(
            "list_dir: {} is not within an allowed directory",
            canon.display()
        ));
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in std::fs::read_dir(&canon).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // hide dotfiles
        }
        // Canonicalise the entry; a symlink that escapes the admitted base
        // resolves outside it and is refused.
        let Ok(entry_canon) = std::fs::canonicalize(entry.path()) else {
            continue;
        };
        if !state.scope.is_within_allowed_dir(&entry_canon) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&entry_canon) else {
            continue;
        };
        let is_dir = meta.is_dir();
        entries.push(DirEntry {
            is_markdown: !is_dir && is_markdown_name(&name),
            name,
            path: entry_canon,
            is_dir,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirListing {
        dir: canon,
        entries,
    })
}

/// Open the OS folder picker and admit the chosen directory as the browser's
/// trusted base. Persists it so it is re-admitted on the next launch.
#[tauri::command]
pub async fn pick_base_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<PathBuf>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    if let Some(folder) = folder {
        let path = folder.into_path().map_err(|e| e.to_string())?;
        let canon = state.scope.allow_dir(&path).map_err(|e| e.to_string())?;
        if let Err(e) = settings::rmw(|s| settings::Settings {
            browser_base_dir: Some(canon.clone()),
            ..s
        }) {
            eprintln!("[btr-md] could not persist browser base dir: {e}");
        }
        Ok(Some(canon))
    } else {
        Ok(None)
    }
}

/// Set the UI workspace root. Accepts only a directory already within a granted
/// base (the renderer cannot widen authority here); persists it as the browser
/// base so it is restored next launch. Returns the canonical root. On rejection
/// the frontend falls back to `pick_base_dir` (the OS picker) to grant a new
/// base.
#[tauri::command]
pub fn set_workspace_root(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<PathBuf, String> {
    let canon = state
        .scope
        .set_workspace_root(&path)
        .map_err(|e| e.to_string())?;
    if let Err(e) = settings::rmw(|s| settings::Settings {
        browser_base_dir: Some(canon.clone()),
        ..s
    }) {
        eprintln!("[btr-md] could not persist workspace root: {e}");
    }
    Ok(canon)
}

/// Reject a proposed new file name: it must be a bare file name (no path
/// separators, no `.`/`..`, non-empty) so a rename can never escape the file's
/// own directory.
fn is_valid_rename(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

/// Core of [`rename_path`], split out so it can be unit-tested against a real
/// [`PathScope`] + tempdir without a Tauri `State`. See that command for the
/// security contract.
fn rename_in_scope(
    scope: &crate::path_scope::PathScope,
    path: &std::path::Path,
    new_name: &str,
) -> Result<PathBuf, String> {
    if !is_valid_rename(new_name) {
        return Err(format!("rename_path: invalid file name: {new_name:?}"));
    }
    let canon = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !scope.is_within_allowed_dir(&canon) {
        return Err(format!(
            "rename_path: {} is not within an allowed directory",
            canon.display()
        ));
    }
    if canon.is_dir() {
        return Err("rename_path: only files can be renamed".into());
    }
    let parent = canon
        .parent()
        .ok_or_else(|| "rename_path: path has no parent directory".to_string())?;
    let target = parent.join(new_name);
    if target == canon {
        return Ok(canon);
    }
    if target.exists() {
        return Err(format!(
            "rename_path: a file named {new_name:?} already exists"
        ));
    }
    std::fs::rename(&canon, &target).map_err(|e| e.to_string())?;
    // The new path inherits the parent's grant; admit it to the file scope too
    // so a subsequent open/save of the just-renamed file is authorised.
    let target_canon = std::fs::canonicalize(&target).map_err(|e| e.to_string())?;
    Ok(scope.allow_canonical(&target_canon))
}

/// Rename a file within its current directory. The source must resolve inside an
/// admitted directory (same allowlist `list_dir` enforces); `new_name` must be a
/// bare file name so the target stays in that directory. Refuses to overwrite an
/// existing entry. Returns the new canonical path.
///
/// # Security
///
/// This is a renderer-reachable mutation, so it re-checks scope on the canonical
/// source rather than trusting the supplied string, and constructs the target
/// from the canonical parent + a separator-free name. It never widens the scope.
#[tauri::command]
pub fn rename_path(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    new_name: String,
) -> Result<PathBuf, String> {
    rename_in_scope(&state.scope, &path, &new_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path_scope::PathScope;

    #[test]
    fn is_valid_rename_rejects_path_escapes_and_empties() {
        assert!(is_valid_rename("notes.md"));
        assert!(is_valid_rename("My File.markdown"));
        assert!(!is_valid_rename(""));
        assert!(!is_valid_rename("."));
        assert!(!is_valid_rename(".."));
        assert!(!is_valid_rename("../escape.md"));
        assert!(!is_valid_rename("sub/dir.md"));
        assert!(!is_valid_rename("a\\b.md"));
        assert!(!is_valid_rename("nul\0.md"));
    }

    #[test]
    fn rename_in_scope_renames_within_granted_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("old.md");
        std::fs::write(&src, "x").expect("write");
        let scope = PathScope::new();
        scope.allow_dir(dir.path()).expect("grant dir");

        let new_path = rename_in_scope(&scope, &src, "new.md").expect("rename ok");

        assert_eq!(new_path, dir.path().join("new.md").canonicalize().unwrap());
        assert!(!src.exists());
        assert!(new_path.exists());
        // The renamed file is admitted to the file scope (openable/savable).
        assert!(scope.check_canonical(&new_path));
    }

    #[test]
    fn rename_in_scope_rejects_outside_grant() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("old.md");
        std::fs::write(&src, "x").expect("write");
        // No grant for `dir`.
        let scope = PathScope::new();

        let err = rename_in_scope(&scope, &src, "new.md").expect_err("must reject");
        assert!(err.contains("not within an allowed directory"), "{err}");
        assert!(src.exists(), "source must be untouched on rejection");
    }

    #[test]
    fn rename_in_scope_refuses_to_clobber_existing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("old.md");
        let occupied = dir.path().join("taken.md");
        std::fs::write(&src, "x").expect("write src");
        std::fs::write(&occupied, "y").expect("write occupied");
        let scope = PathScope::new();
        scope.allow_dir(dir.path()).expect("grant dir");

        let err = rename_in_scope(&scope, &src, "taken.md").expect_err("must refuse clobber");
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(std::fs::read_to_string(&occupied).unwrap(), "y");
        assert!(src.exists());
    }

    #[test]
    fn rename_in_scope_rejects_separator_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("old.md");
        std::fs::write(&src, "x").expect("write");
        let scope = PathScope::new();
        scope.allow_dir(dir.path()).expect("grant dir");

        let err = rename_in_scope(&scope, &src, "../evil.md").expect_err("must reject");
        assert!(err.contains("invalid file name"), "{err}");
        assert!(src.exists());
    }
}
