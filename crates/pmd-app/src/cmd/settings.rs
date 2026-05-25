use crate::state::{recents, settings};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
}

impl From<settings::Settings> for Settings {
    fn from(s: settings::Settings) -> Self {
        Self {
            active_theme: s.active_theme,
            light_theme: s.light_theme,
            dark_theme: s.dark_theme,
            auto_switch: s.auto_switch,
            default_mode: s.default_mode,
        }
    }
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    let path = settings::path();
    if !path.exists() {
        return Ok(Settings {
            active_theme: None,
            light_theme: None,
            dark_theme: None,
            auto_switch: false,
            default_mode: None,
        });
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let s: settings::Settings = toml::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Settings::from(s))
}

#[tauri::command]
pub fn set_default_mode(mode: String) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        default_mode: Some(mode),
        ..s
    })
    .map_err(|e| e.to_string())
}

/// Update the auto-switch theme slots. Slots that the caller does not pass
/// (or passes as `null`) are left untouched; only slots explicitly set to
/// a string slug are overwritten.
///
/// The previous implementation always overwrote both fields, so a UI that
/// only meant to update the `light` slot would silently wipe the `dark`
/// slot. The picker's per-card "As light" / "As dark" buttons hit that.
#[tauri::command]
pub fn set_theme_pair(light: Option<String>, dark: Option<String>) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        light_theme: light.or(s.light_theme.clone()),
        dark_theme: dark.or(s.dark_theme.clone()),
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_auto_switch(auto_switch: bool) -> Result<(), String> {
    settings::rmw(|s| settings::Settings { auto_switch, ..s }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_files() -> Result<Vec<PathBuf>, String> {
    // Filter out paths that no longer exist on disk; the helper also rewrites
    // the on-disk file so the list shrinks over time instead of accumulating
    // dead entries.
    recents::get_existing().map_err(|e| e.to_string())
}

/// Add a renderer-supplied path to the recents list.
///
/// Backend open commands (`open_file`, `request_open_file`, `open_dialog`)
/// already push to recents on success, so this command exists only as a
/// fallback for renderer flows that need to record a recent without going
/// through an open. It validates that the path exists and canonicalises it
/// so the renderer can't add arbitrary garbage strings.
#[tauri::command]
pub fn add_recent_file(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "add_recent_file: path does not exist: {}",
            path.display()
        ));
    }
    let canon = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    recents::push(&canon).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_recent_files() -> Result<(), String> {
    recents::clear().map_err(|e| e.to_string())
}
