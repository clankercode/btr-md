//! Quick file-op commands: reveal-in-folder + open-in-default-app (Phase 4).
//!
//! Linux-first (the project ships Linux packaging): open via `xdg-open`, reveal
//! via the `org.freedesktop.FileManager1` D-Bus interface (which highlights the
//! file) with a parent-directory `xdg-open` fallback. macOS/Windows use their
//! native openers. Both commands are scope-checked: only a path the backend has
//! admitted (active scope or an allowed browser dir) may be opened.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Verify the path is admitted, returning its canonical form.
fn scope_ok(state: &crate::AppState, path: &Path) -> Result<PathBuf, String> {
    let canon = crate::path_scope::PathScope::canonicalise(path).map_err(|e| e.to_string())?;
    if state.scope.check_canonical(&canon) || state.scope.is_within_allowed_dir(&canon) {
        Ok(canon)
    } else {
        Err(format!(
            "reveal/open refused: {} not in scope",
            canon.display()
        ))
    }
}

#[tauri::command]
pub fn open_in_default_app(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<(), String> {
    let canon = scope_ok(&state, &path)?;
    open_path(&canon)
}

#[tauri::command]
pub fn reveal_in_folder(
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
) -> Result<(), String> {
    let canon = scope_ok(&state, &path)?;
    reveal_path(&canon)
}

fn spawn(mut cmd: Command) -> Result<(), String> {
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open an external URL in the system browser. Restricted to http(s) so a
/// compromised renderer can't launch `file:`/`javascript:`/custom schemes.
/// Used by the "Copy + Open Gist" flow (Phase 5).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("open_url: only http(s) URLs are allowed".into());
    }
    open_external(&url)
}

#[cfg(target_os = "linux")]
fn open_external(s: &str) -> Result<(), String> {
    let mut c = Command::new("xdg-open");
    c.arg(s);
    spawn(c)
}

#[cfg(target_os = "macos")]
fn open_external(s: &str) -> Result<(), String> {
    let mut c = Command::new("open");
    c.arg(s);
    spawn(c)
}

#[cfg(target_os = "windows")]
fn open_external(s: &str) -> Result<(), String> {
    let mut c = Command::new("cmd");
    c.args(["/C", "start", ""]).arg(s);
    spawn(c)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn open_external(_s: &str) -> Result<(), String> {
    Err("open_url is not supported on this platform".into())
}

#[cfg(target_os = "linux")]
fn open_path(p: &Path) -> Result<(), String> {
    let mut c = Command::new("xdg-open");
    c.arg(p);
    spawn(c)
}

#[cfg(target_os = "linux")]
fn reveal_path(p: &Path) -> Result<(), String> {
    // FileManager1.ShowItems highlights the file in the user's file manager.
    let uri = format!("file://{}", p.display());
    let status = Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{uri}"))
        .arg("string:")
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        // No FileManager1 provider — open the containing folder instead.
        _ => {
            let parent = p.parent().ok_or("no parent directory")?;
            let mut c = Command::new("xdg-open");
            c.arg(parent);
            spawn(c)
        }
    }
}

#[cfg(target_os = "macos")]
fn open_path(p: &Path) -> Result<(), String> {
    let mut c = Command::new("open");
    c.arg(p);
    spawn(c)
}

#[cfg(target_os = "macos")]
fn reveal_path(p: &Path) -> Result<(), String> {
    let mut c = Command::new("open");
    c.arg("-R").arg(p);
    spawn(c)
}

#[cfg(target_os = "windows")]
fn open_path(p: &Path) -> Result<(), String> {
    let mut c = Command::new("cmd");
    c.args(["/C", "start", ""]).arg(p);
    spawn(c)
}

#[cfg(target_os = "windows")]
fn reveal_path(p: &Path) -> Result<(), String> {
    let mut c = Command::new("explorer");
    c.arg(format!("/select,{}", p.display()));
    spawn(c)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn open_path(_p: &Path) -> Result<(), String> {
    Err("open-in-default-app is not supported on this platform".into())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn reveal_path(_p: &Path) -> Result<(), String> {
    Err("reveal-in-folder is not supported on this platform".into())
}
