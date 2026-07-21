use pmd_app_lib::{
    cmd::settings::{
        get_settings, set_active_theme, set_shortcut_overrides_for_test, set_show_full_path,
        set_show_hidden_files, set_theme_pair,
    },
    state::settings,
};
use std::{
    env,
    ffi::OsString,
    sync::{Mutex, OnceLock},
};

/// Per-process guard so XDG_CONFIG_HOME-swapping tests don't trample each
/// other. Mirrors the pattern used by `state::recents` tests.
fn config_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

struct ConfigHomeGuard {
    previous: Option<OsString>,
    _dir: tempfile::TempDir,
}

impl ConfigHomeGuard {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("create temp config home");
        let previous = env::var_os("XDG_CONFIG_HOME");
        env::set_var("XDG_CONFIG_HOME", dir.path());
        Self {
            previous,
            _dir: dir,
        }
    }
}

impl Drop for ConfigHomeGuard {
    fn drop(&mut self) {
        if let Some(previous) = &self.previous {
            env::set_var("XDG_CONFIG_HOME", previous);
        } else {
            env::remove_var("XDG_CONFIG_HOME");
        }
    }
}

#[test]
fn renderer_cannot_register_add_recent_file_command() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let main_rs = std::fs::read_to_string(manifest_dir.join("src/main.rs")).expect("read main.rs");
    let settings_rs = std::fs::read_to_string(manifest_dir.join("src/cmd/settings.rs"))
        .expect("read settings command source");

    assert!(
        !main_rs.contains("add_recent_file"),
        "add_recent_file must not be registered as a Tauri command"
    );
    assert!(
        !settings_rs.contains("add_recent_file"),
        "add_recent_file must not exist as a renderer-callable command"
    );
}

#[test]
fn set_theme_pair_only_updates_provided_slots() {
    // Regression test for the picker's "As light" / "As dark" buttons:
    // setting one slot must not silently clear the other.
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    set_theme_pair(
        Some("github-light".to_string()),
        Some("github-dark".to_string()),
    )
    .expect("seed both slots");

    set_theme_pair(Some("solarized-light".to_string()), None).expect("update only light");

    let s = get_settings().expect("read settings");
    assert_eq!(s.light_theme.as_deref(), Some("solarized-light"));
    assert_eq!(
        s.dark_theme.as_deref(),
        Some("github-dark"),
        "dark slot must be preserved when only light is sent"
    );

    set_theme_pair(None, Some("dracula".to_string())).expect("update only dark");

    let s = get_settings().expect("read settings");
    assert_eq!(s.light_theme.as_deref(), Some("solarized-light"));
    assert_eq!(s.dark_theme.as_deref(), Some("dracula"));
}

#[test]
fn set_active_theme_persists_slug_without_clearing_other_settings() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    set_theme_pair(
        Some("github-light".to_string()),
        Some("github-dark".to_string()),
    )
    .expect("seed theme slots");

    set_active_theme("solarized-light".to_string()).expect("persist active theme");

    let s = get_settings().expect("read settings");
    assert_eq!(s.active_theme.as_deref(), Some("solarized-light"));
    assert_eq!(s.light_theme.as_deref(), Some("github-light"));
    assert_eq!(s.dark_theme.as_deref(), Some("github-dark"));
}

#[test]
fn shortcut_overrides_round_trip_without_clearing_theme_settings() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    set_theme_pair(
        Some("github-light".to_string()),
        Some("github-dark".to_string()),
    )
    .expect("seed theme slots");

    let settings = set_shortcut_overrides_for_test(vec![(
        "navigate.commandOverlay".to_string(),
        vec!["Ctrl+K".to_string()],
    )])
    .expect("settings");

    assert_eq!(
        settings.shortcut_overrides["navigate.commandOverlay"],
        vec!["Ctrl+K"]
    );
    assert_eq!(settings.light_theme.as_deref(), Some("github-light"));
    assert_eq!(settings.dark_theme.as_deref(), Some("github-dark"));
}

#[test]
fn get_settings_recovers_from_corrupt_toml() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    if let Some(parent) = settings::path().parent() {
        std::fs::create_dir_all(parent).expect("create config dir");
    }
    std::fs::write(settings::path(), "this is not valid toml = = =")
        .expect("write corrupt settings");

    let s = get_settings().expect("corrupt settings should fall back to defaults");
    assert_eq!(s.active_theme, None);
    assert_eq!(s.light_theme, None);
    assert_eq!(s.dark_theme, None);
    assert!(!s.auto_switch);
    assert_eq!(s.default_mode, None);
}

#[test]
fn settings_rmw_recovers_from_corrupt_toml_and_overwrites_on_next_write() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    if let Some(parent) = settings::path().parent() {
        std::fs::create_dir_all(parent).expect("create config dir");
    }
    std::fs::write(settings::path(), "this is not valid toml = = =")
        .expect("write corrupt settings");

    set_active_theme("github-dark".to_string()).expect("write after corrupt settings");

    let content = std::fs::read_to_string(settings::path()).expect("read rewritten settings");
    let parsed: settings::Settings = toml::from_str(&content).expect("settings rewritten as TOML");
    assert_eq!(parsed.active_theme.as_deref(), Some("github-dark"));
}

#[test]
fn set_show_full_path_persists_and_defaults_false() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    let defaults = get_settings().expect("defaults");
    assert!(
        !defaults.show_full_path,
        "missing key must default to compressed path (false)"
    );

    let updated = set_show_full_path(true).expect("enable full path");
    assert!(updated.show_full_path);

    let reread = get_settings().expect("reread");
    assert!(reread.show_full_path);

    let content = std::fs::read_to_string(settings::path()).expect("read state.toml");
    assert!(
        content.contains("show_full_path = true"),
        "preference must land in state.toml: {content}"
    );

    let cleared = set_show_full_path(false).expect("disable full path");
    assert!(!cleared.show_full_path);
    assert!(!get_settings().expect("reread after clear").show_full_path);
}

#[test]
fn set_show_hidden_files_persists_and_defaults_false() {
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    let defaults = get_settings().expect("defaults");
    assert!(
        !defaults.show_hidden_files,
        "missing key must default to hiding dotfiles (false)"
    );

    let updated = set_show_hidden_files(true).expect("enable hidden files");
    assert!(updated.show_hidden_files);

    let reread = get_settings().expect("reread");
    assert!(reread.show_hidden_files);

    let content = std::fs::read_to_string(settings::path()).expect("read state.toml");
    assert!(
        content.contains("show_hidden_files = true"),
        "preference must land in state.toml: {content}"
    );

    let cleared = set_show_hidden_files(false).expect("disable hidden files");
    assert!(!cleared.show_hidden_files);
    assert!(
        !get_settings()
            .expect("reread after clear")
            .show_hidden_files
    );
}
