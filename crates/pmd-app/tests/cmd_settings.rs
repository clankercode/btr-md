use pmd_app_lib::cmd::settings::{get_settings, set_theme_pair};
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
fn set_theme_pair_only_updates_provided_slots() {
    // Regression test for the picker's "As light" / "As dark" buttons:
    // setting one slot must not silently clear the other.
    let _lock = config_env_lock();
    let _home = ConfigHomeGuard::new();

    set_theme_pair(Some("github-light".to_string()), Some("github-dark".to_string()))
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
