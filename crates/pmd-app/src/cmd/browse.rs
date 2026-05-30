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

use crate::cmd::file::MARKDOWN_EXTENSIONS;
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
            eprintln!("[preview-md] could not persist browser base dir: {e}");
        }
        Ok(Some(canon))
    } else {
        Ok(None)
    }
}
