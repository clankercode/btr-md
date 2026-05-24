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

#[tauri::command]
pub fn set_theme_pair(light: Option<String>, dark: Option<String>) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        light_theme: light,
        dark_theme: dark,
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
    recents::get().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_recent_file(path: PathBuf) -> Result<(), String> {
    recents::push(&path).map_err(|e| e.to_string())
}
