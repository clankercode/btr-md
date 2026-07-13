use crate::doc::modes::{AutoreloadMode, AutosaveMode, DiffMode, MergeStrategy};
use crate::state::{recents, settings};
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
    pub autosave_mode: AutosaveMode,
    pub autoreload_mode: AutoreloadMode,
    pub merge_strategy: MergeStrategy,
    pub browser_base_dir: Option<PathBuf>,
    pub gist_enabled: bool,
    pub diff_mode: DiffMode,
    pub dont_ask_default_handler: bool,
    pub mono_font: Option<String>,
    pub shortcut_overrides: BTreeMap<String, Vec<String>>,
    pub split_scroll_locked: bool,
    pub show_full_path: bool,
}

impl From<settings::Settings> for Settings {
    fn from(s: settings::Settings) -> Self {
        Self {
            active_theme: s.active_theme,
            light_theme: s.light_theme,
            dark_theme: s.dark_theme,
            auto_switch: s.auto_switch,
            default_mode: s.default_mode,
            autosave_mode: s.autosave_mode,
            autoreload_mode: s.autoreload_mode,
            merge_strategy: s.merge_strategy,
            browser_base_dir: s.browser_base_dir,
            gist_enabled: s.gist_enabled,
            diff_mode: s.diff_mode,
            dont_ask_default_handler: s.dont_ask_default_handler,
            mono_font: s.mono_font,
            shortcut_overrides: s.shortcut_overrides,
            split_scroll_locked: s.split_scroll_locked,
            show_full_path: s.show_full_path,
        }
    }
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    let path = settings::path();
    if !path.exists() {
        return Ok(Settings::from(settings::Settings::default()));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let s = settings::parse_or_default(&content);
    Ok(Settings::from(s))
}

#[tauri::command]
pub fn set_active_theme(slug: String) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        active_theme: Some(slug),
        ..s
    })
    .map_err(|e| e.to_string())
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
pub fn set_autosave_mode(mode: AutosaveMode) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        autosave_mode: mode,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autoreload_mode(mode: AutoreloadMode) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        autoreload_mode: mode,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_merge_strategy(strategy: MergeStrategy) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        merge_strategy: strategy,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_gist_enabled(enabled: bool) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        gist_enabled: enabled,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_diff_mode(mode: DiffMode) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        diff_mode: mode,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dont_ask_default_handler(value: bool) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        dont_ask_default_handler: value,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_mono_font(font: Option<String>) -> Result<(), String> {
    settings::rmw(|s| settings::Settings {
        mono_font: font,
        ..s
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_shortcut_overrides(
    overrides: BTreeMap<String, Vec<String>>,
) -> Result<Settings, String> {
    settings::rmw(|s| settings::Settings {
        shortcut_overrides: overrides,
        ..s
    })
    .map_err(|e| e.to_string())?;
    get_settings()
}

pub fn set_shortcut_overrides_for_test(
    overrides: Vec<(String, Vec<String>)>,
) -> Result<Settings, String> {
    set_shortcut_overrides(overrides.into_iter().collect())
}

#[tauri::command]
pub fn set_split_scroll_locked(enabled: bool) -> Result<Settings, String> {
    settings::rmw(|s| settings::Settings {
        split_scroll_locked: enabled,
        ..s
    })
    .map_err(|e| e.to_string())?;
    get_settings()
}

#[tauri::command]
pub fn set_show_full_path(enabled: bool) -> Result<Settings, String> {
    settings::rmw(|s| settings::Settings {
        show_full_path: enabled,
        ..s
    })
    .map_err(|e| e.to_string())?;
    get_settings()
}

#[tauri::command]
pub fn get_recent_files() -> Result<Vec<PathBuf>, String> {
    // Filter out paths that no longer exist on disk; the helper also rewrites
    // the on-disk file so the list shrinks over time instead of accumulating
    // dead entries.
    recents::get_existing().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_recent_files() -> Result<(), String> {
    recents::clear().map_err(|e| e.to_string())
}
