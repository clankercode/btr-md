//! "Set btr-md as the default markdown handler" (Phase 5).
//!
//! Linux-first via `xdg-mime` against the installed `.desktop` id. macOS
//! (Launch Services) and Windows (per-user ProgID / `ms-settings:defaultapps`)
//! are stubbed: detection returns `Unsupported` and `set_as_default` deep-links
//! to the OS settings where the user can choose, since neither platform lets an
//! app silently claim a default.

use serde::Serialize;

/// The installed desktop-entry id (see packaging/linux/md.btr.app.desktop).
const DESKTOP_ID: &str = "md.btr.app.desktop";
/// MIME types we want to own.
const MARKDOWN_MIMES: &[&str] = &["text/markdown", "text/x-markdown"];

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum HandlerStatus {
    /// We are the registered default for markdown.
    Default,
    /// Some other app (or none) is the default.
    NotDefault,
    /// Could not determine (tooling missing / unsupported platform).
    Unknown,
}

#[derive(Serialize)]
pub struct DefaultHandlerReport {
    pub status: HandlerStatus,
    pub platform: &'static str,
}

#[tauri::command]
pub fn default_handler_status() -> DefaultHandlerReport {
    DefaultHandlerReport {
        status: query_status(),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
pub fn set_as_default_handler() -> Result<(), String> {
    set_default()
}

#[cfg(target_os = "linux")]
fn query_status() -> HandlerStatus {
    use std::process::Command;
    // If any markdown MIME resolves to our desktop id, consider us the default.
    for mime in MARKDOWN_MIMES {
        let out = Command::new("xdg-mime")
            .args(["query", "default", mime])
            .output();
        if let Ok(out) = out {
            let current = String::from_utf8_lossy(&out.stdout);
            if current.trim() == DESKTOP_ID {
                return HandlerStatus::Default;
            }
        } else {
            return HandlerStatus::Unknown;
        }
    }
    HandlerStatus::NotDefault
}

/// True if an installed desktop entry with our id exists in any XDG application
/// directory. `xdg-mime default <id> <mime>` happily writes a `mimeapps.list`
/// association even when no such entry is installed — file managers then ignore
/// the dangling association, so the default silently "doesn't take". Checking
/// first lets us return an actionable error instead.
#[cfg(target_os = "linux")]
fn desktop_entry_installed() -> bool {
    use std::path::PathBuf;

    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".local/share")));
    let data_dirs = std::env::var("XDG_DATA_DIRS")
        .unwrap_or_else(|_| "/usr/local/share:/usr/share".to_string());

    data_home
        .into_iter()
        .chain(
            data_dirs
                .split(':')
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
        )
        .any(|dir| dir.join("applications").join(DESKTOP_ID).is_file())
}

#[cfg(target_os = "linux")]
fn set_default() -> Result<(), String> {
    use std::process::Command;

    // Setting the association is pointless if the desktop entry isn't installed:
    // the file manager has nothing to launch. Fail loudly with a fix-it hint.
    if !desktop_entry_installed() {
        return Err(format!(
            "{DESKTOP_ID} is not installed. Install desktop integration first \
             (e.g. `just install-desktop`, or use the AppImage/Flatpak build), \
             then set btr-md as the default again."
        ));
    }

    for mime in MARKDOWN_MIMES {
        let status = Command::new("xdg-mime")
            .args(["default", DESKTOP_ID, mime])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("xdg-mime default failed for {mime}"));
        }
    }

    // Refresh the mimeinfo cache so file managers pick the change up without a
    // re-login. Best-effort: the association is already written, and not every
    // system ships update-desktop-database.
    if let Some(apps_dir) = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))
        })
        .map(|d| d.join("applications"))
    {
        let _ = Command::new("update-desktop-database")
            .arg(apps_dir)
            .status();
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn query_status() -> HandlerStatus {
    HandlerStatus::Unknown
}

#[cfg(target_os = "macos")]
fn set_default() -> Result<(), String> {
    // No silent default on macOS; the user assigns it via Finder's "Get Info".
    Err("On macOS, set the default via Finder → Get Info → Open with → Change All".into())
}

#[cfg(target_os = "windows")]
fn set_default() -> Result<(), String> {
    use std::process::Command;
    // Modern Windows deep-links to the Settings default-apps page.
    Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn set_default() -> Result<(), String> {
    Err("Setting the default markdown handler is not supported on this platform".into())
}
