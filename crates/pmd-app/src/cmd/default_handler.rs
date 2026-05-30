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

#[cfg(target_os = "linux")]
fn set_default() -> Result<(), String> {
    use std::process::Command;
    for mime in MARKDOWN_MIMES {
        let status = Command::new("xdg-mime")
            .args(["default", DESKTOP_ID, mime])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("xdg-mime default failed for {mime}"));
        }
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
