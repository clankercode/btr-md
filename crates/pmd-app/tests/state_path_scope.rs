use pmd_app_lib::{
    path_scope::PathScope,
    state::{recents, settings},
};
use std::{env, ffi::OsString, path::Path, sync::Mutex};
use tempfile::TempDir;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct ConfigHomeGuard {
    _dir: TempDir,
    previous: Option<OsString>,
}

impl ConfigHomeGuard {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp config dir");
        let previous = env::var_os("XDG_CONFIG_HOME");
        env::set_var("XDG_CONFIG_HOME", dir.path());
        Self {
            _dir: dir,
            previous,
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

fn with_config_home<T>(f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _config = ConfigHomeGuard::new();
    f()
}

#[test]
fn path_scope_allows_new_file_inside_existing_directory() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("new.md");
    let scope = PathScope::new();

    let allowed = scope.allow(&path).expect("allow new file path");

    assert_eq!(allowed, path);
    assert!(scope.check(&path));
}

#[test]
fn path_scope_canonical_methods_do_not_touch_filesystem() {
    let dir = tempfile::tempdir().expect("temp dir");
    let canon = dir.path().join("missing-parent").join("future.md");
    let scope = PathScope::new();

    let allowed = scope.allow_canonical(&canon);

    assert_eq!(allowed, canon);
    assert!(scope.check_canonical(&canon));
    assert!(!scope.check(&canon));
}

#[test]
fn path_scope_rejects_unallowed_sibling_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let allowed = dir.path().join("allowed.md");
    let sibling = dir.path().join("sibling.md");
    std::fs::write(&allowed, "allowed").expect("write allowed file");
    std::fs::write(&sibling, "sibling").expect("write sibling file");

    let scope = PathScope::new();
    scope.allow(&allowed).expect("allow one file");

    assert!(!scope.check(&sibling));
}

#[test]
fn recents_push_preserves_existing_entries() {
    with_config_home(|| {
        let first = Path::new("/tmp/preview-md-first.md").to_path_buf();
        let second = Path::new("/tmp/preview-md-second.md").to_path_buf();

        recents::push(&first).expect("push first recent");
        recents::push(&second).expect("push second recent");

        assert_eq!(recents::get().expect("read recents"), vec![second, first]);
    });
}

#[cfg(unix)]
#[test]
fn recents_contains_canonical_eq_compares_target_without_recanonicalizing_it() {
    use std::os::unix::fs::symlink;

    with_config_home(|| {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        let link = dir.path().join("link.md");
        std::fs::write(&path, "note").expect("write note");
        symlink(&path, &link).expect("symlink note");
        let canon = path.canonicalize().expect("canonicalize note");

        recents::push(&path).expect("push recent");

        assert_eq!(link.canonicalize().unwrap(), canon);
        assert_ne!(link, canon);
        assert!(recents::contains_canonical_eq(&canon));
        assert!(!recents::contains_canonical_eq(&link));
    });
}

#[test]
fn settings_rmw_preserves_unrelated_fields() {
    with_config_home(|| {
        settings::rmw(|s| settings::Settings {
            active_theme: Some("github-light".into()),
            ..s
        })
        .expect("write active theme");

        settings::rmw(|s| settings::Settings {
            default_mode: Some("split".into()),
            ..s
        })
        .expect("write default mode");

        let content = std::fs::read_to_string(settings::path()).expect("read settings");
        let settings: settings::Settings = toml::from_str(&content).expect("parse settings");

        assert_eq!(settings.active_theme.as_deref(), Some("github-light"));
        assert_eq!(settings.default_mode.as_deref(), Some("split"));
    });
}
