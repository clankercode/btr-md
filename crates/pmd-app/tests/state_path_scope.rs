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
        let first = Path::new("/tmp/btr-md-first.md").to_path_buf();
        let second = Path::new("/tmp/btr-md-second.md").to_path_buf();

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
fn dir_allowlist_uses_component_wise_match_not_string_prefix() {
    let root = tempfile::tempdir().expect("temp root");
    let base = root.path().join("base");
    let base_evil = root.path().join("base_evil");
    std::fs::create_dir(&base).expect("mk base");
    std::fs::create_dir(&base_evil).expect("mk base_evil");

    let scope = PathScope::new();
    let base_canon = scope.allow_dir(&base).expect("admit base dir");

    // The base and anything nested under it are within scope.
    assert!(scope.is_within_allowed_dir(&base_canon));
    assert!(scope.is_within_allowed_dir(&base_canon.join("notes").join("a.md")));
    assert!(scope.check_dir_access(&base));

    // `/base_evil` shares a string prefix with `/base` but is a DIFFERENT
    // component — it must be rejected.
    let evil_canon = base_evil.canonicalize().expect("canon base_evil");
    assert!(!scope.is_within_allowed_dir(&evil_canon));
    assert!(!scope.is_within_allowed_dir(&evil_canon.join("x.md")));
    assert!(!scope.check_dir_access(&base_evil));
}

#[test]
fn dir_allowlist_rejects_path_under_unadmitted_dir() {
    let root = tempfile::tempdir().expect("temp root");
    let base = root.path().join("base");
    let other = root.path().join("other");
    std::fs::create_dir(&base).expect("mk base");
    std::fs::create_dir(&other).expect("mk other");
    let stray = other.join("x.md");
    std::fs::write(&stray, "stray").expect("write stray");

    let scope = PathScope::new();
    scope.allow_dir(&base).expect("admit base");

    // A renderer could name a path under an un-admitted directory; reject it.
    assert!(!scope.is_within_allowed_dir(&stray.canonicalize().unwrap()));
    assert!(!scope.check_dir_access(&other));
}

#[cfg(unix)]
#[test]
fn dir_allowlist_refuses_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().expect("temp root");
    let base = root.path().join("base");
    let outside = root.path().join("outside");
    std::fs::create_dir(&base).expect("mk base");
    std::fs::create_dir(&outside).expect("mk outside");
    let secret = outside.join("secret.md");
    std::fs::write(&secret, "secret").expect("write secret");

    // A symlink INSIDE the admitted base that points OUTSIDE it.
    let link = base.join("escape.md");
    symlink(&secret, &link).expect("symlink escape");

    let scope = PathScope::new();
    scope.allow_dir(&base).expect("admit base");

    // Canonicalising the entry resolves the symlink to outside/secret.md,
    // which is not under base → refused.
    let resolved = link.canonicalize().expect("canon link");
    assert!(!scope.is_within_allowed_dir(&resolved));
}

#[test]
fn allow_dir_rejects_a_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let file = dir.path().join("not-a-dir.md");
    std::fs::write(&file, "x").expect("write file");
    let scope = PathScope::new();
    assert!(scope.allow_dir(&file).is_err());
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
