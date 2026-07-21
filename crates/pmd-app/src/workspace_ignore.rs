//! Workspace-tree ignore predicates for high-churn directories.
//!
//! Used by [`crate::watcher::WorkspaceTreeWatcher`] so recursive FS events under
//! `node_modules/`, `target/`, `.git/`, etc. do not spam `workspace_tree_changed`.
//! Pure path logic — unit-testable without `notify` or Tauri.

use std::ffi::OsStr;
use std::path::{Component, Path};

/// Directory basenames that are always ignored for sidebar tree events.
/// Expandable: add common build/cache dirs here. (Python `*.egg-info` is handled
/// via a suffix check in [`is_always_ignored_name`], not this list.)
pub const ALWAYS_IGNORE_BASENAMES: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".parcel-cache",
    ".svelte-kit",
    "bower_components",
    ".gradle",
    ".idea",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".eggs",
];

fn is_always_ignored_name(name: &OsStr) -> bool {
    let Some(s) = name.to_str() else {
        return false;
    };
    if ALWAYS_IGNORE_BASENAMES.iter().any(|n| *n == s) {
        return true;
    }
    // Python egg-info dirs: `foo.egg-info`
    s.ends_with(".egg-info")
}

/// True when `dir` or any ancestor up through `stop` (inclusive) contains `marker`.
fn ancestor_has_marker(dir: &Path, stop: &Path, marker: &str) -> bool {
    let mut cur = dir;
    loop {
        if cur.join(marker).is_file() {
            return true;
        }
        if cur == stop {
            break;
        }
        match cur.parent() {
            Some(p) if p != cur => cur = p,
            _ => break,
        }
    }
    // Also check stop itself when dir is not under stop (absolute event paths).
    if dir != stop && stop.join(marker).is_file() {
        return true;
    }
    false
}

/// Whether a path component named `target` should be treated as a Cargo build dir.
/// True when a `Cargo.toml` exists on an ancestor of that segment (including the
/// workspace root).
fn is_cargo_target_segment(segment_parent: &Path, workspace_root: &Path) -> bool {
    ancestor_has_marker(segment_parent, workspace_root, "Cargo.toml")
}

/// Return true if `path` is under (or is) a high-churn directory that should not
/// trigger sidebar tree refresh.
///
/// `workspace_root` scopes relative checks and Cargo.toml discovery.
pub fn should_ignore_workspace_event_path(path: &Path, workspace_root: &Path) -> bool {
    // Prefer the portion under the workspace root; if not under it, still scan
    // the full path's components for always-ignored names.
    let scan = path.strip_prefix(workspace_root).unwrap_or(path);

    let mut prefix = workspace_root.to_path_buf();
    for component in scan.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        if is_always_ignored_name(name) {
            return true;
        }
        if name == "target" && is_cargo_target_segment(&prefix, workspace_root) {
            return true;
        }
        prefix.push(name);
    }

    // Event path is exactly the workspace root — never ignore the root itself.
    false
}

/// True when every path in `paths` is under an ignored segment.
/// Empty path lists are **not** treated as ignored (some notify backends omit
/// paths on structural events; keep the conservative emit).
pub fn all_paths_ignored(paths: &[impl AsRef<Path>], workspace_root: &Path) -> bool {
    if paths.is_empty() {
        return false;
    }
    paths
        .iter()
        .all(|p| should_ignore_workspace_event_path(p.as_ref(), workspace_root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn touch(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"").unwrap();
    }

    #[test]
    fn always_ignores_node_modules_and_git() {
        let root = Path::new("/proj");
        assert!(should_ignore_workspace_event_path(
            Path::new("/proj/node_modules/left-pad/index.js"),
            root
        ));
        assert!(should_ignore_workspace_event_path(
            Path::new("/proj/.git/objects/aa"),
            root
        ));
        assert!(should_ignore_workspace_event_path(
            Path::new("/proj/src/__pycache__/x.pyc"),
            root
        ));
        assert!(should_ignore_workspace_event_path(
            Path::new("/proj/.next/cache/x"),
            root
        ));
        assert!(!should_ignore_workspace_event_path(
            Path::new("/proj/src/main.rs"),
            root
        ));
    }

    #[test]
    fn ignores_target_only_when_cargo_toml_present() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let cargo = root.join("Cargo.toml");
        let target_file = root.join("target/debug/foo");
        touch(&target_file);
        // No Cargo.toml yet → do not ignore bare "target" (could be a user folder).
        assert!(!should_ignore_workspace_event_path(&target_file, root));

        touch(&cargo);
        assert!(should_ignore_workspace_event_path(&target_file, root));
        assert!(!should_ignore_workspace_event_path(
            &root.join("src/lib.rs"),
            root
        ));
    }

    #[test]
    fn nested_crate_target_with_local_cargo_toml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let crate_dir = root.join("crates/pmd-app");
        touch(&crate_dir.join("Cargo.toml"));
        let artifact = crate_dir.join("target/debug/deps/x.rlib");
        touch(&artifact);
        assert!(should_ignore_workspace_event_path(&artifact, root));
        assert!(!should_ignore_workspace_event_path(
            &crate_dir.join("src/lib.rs"),
            root
        ));
    }

    #[test]
    fn egg_info_suffix_ignored() {
        let root = Path::new("/py");
        assert!(should_ignore_workspace_event_path(
            Path::new("/py/mypkg.egg-info/PKG-INFO"),
            root
        ));
    }

    #[test]
    fn all_paths_ignored_helpers() {
        let root = Path::new("/proj");
        let empty: &[&Path] = &[];
        assert!(!all_paths_ignored(empty, root), "empty paths stay relevant");
        assert!(all_paths_ignored(
            &[
                Path::new("/proj/node_modules/a"),
                Path::new("/proj/.git/HEAD")
            ],
            root
        ));
        assert!(!all_paths_ignored(
            &[
                Path::new("/proj/node_modules/a"),
                Path::new("/proj/src/main.rs")
            ],
            root
        ));
    }
}
