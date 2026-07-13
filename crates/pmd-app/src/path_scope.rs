//! Filesystem containment primitives for the app.
//!
//! Per ADR-0002, every filesystem-containment helper (canonicalisation,
//! component-wise ancestor tests, lexical path normalisation, and the
//! markdown-extension predicate used to gate which files may be opened) is
//! concentrated here so the security-relevant behaviour has exactly one
//! implementation. The invariant these helpers uphold is *containment*: a
//! candidate path is admissible only when it lies at or below a trusted
//! ancestor once symlinks and `..` segments are resolved — a **component-wise**
//! relationship, never a textual `starts_with` (so `/base` contains `/base/x`
//! but never `/base_evil`).
//!
//! Link/URL *semantics* (scheme classification, mailto/http detection,
//! reference-label normalisation) deliberately do NOT live here — they belong
//! to `pmd_core::facts`. Do not add URL parsing to this module.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Tracks the set of paths the renderer is allowed to read or write.
///
/// Admission to the scope is performed by trusted backend code paths only:
/// the CLI argv parser, the OS file dialog (`open_dialog` / `save_dialog`),
/// and drag/drop events the OS routed through Tauri. The renderer cannot
/// admit arbitrary paths — see `cmd::file::request_open_file` for the
/// re-admission rules it applies on renderer-supplied paths.
///
/// Scope is append-only for the process lifetime; `cmd::doc::save_doc`
/// additionally requires the document to be the active one (see
/// `crate::doc::DocRegistry`), so a stale scope entry from an earlier-opened
/// file cannot be used to overwrite that file once the user has moved on.
///
/// # Directory allowlist (Phase 2 file browser)
///
/// `allowed_dirs` holds *directories* the user has admitted via the OS folder
/// picker (or a previously-trusted base re-admitted on startup). A path is
/// "within an allowed dir" when its canonical components are prefixed by the
/// directory's canonical components — a **component-wise** ancestor match, NOT
/// a string `starts_with` (so `/base` admits `/base/x` but never `/base_evil`).
/// Browsing canonicalises every entry and re-checks it, so a symlink that
/// escapes the base is refused. Directories are never admitted from a
/// renderer-supplied string and there is no implicit `$HOME` default.
pub struct PathScope {
    allowed: Mutex<HashSet<PathBuf>>,
    allowed_dirs: Mutex<HashSet<PathBuf>>,
    /// The current UI listing root. This is a *display cursor only* — it never
    /// grants authority and is always constrained to sit within an admitted
    /// dir. Mutating it cannot widen `allowed` / `allowed_dirs`.
    workspace_root: Mutex<Option<PathBuf>>,
}

impl Default for PathScope {
    fn default() -> Self {
        Self::new()
    }
}

/// Component-wise ancestor test: is `child` equal to, or nested under, `dir`?
/// Both are expected to be canonical (absolute, symlink-resolved). Compares
/// path *components* so `/base` does not match `/base_evil`.
///
/// This is the single containment predicate for the crate. It is equivalent to
/// `child == dir || child.starts_with(dir)` (Rust's `Path::starts_with` is
/// itself component-wise), spelled out as an explicit loop for clarity.
pub(crate) fn is_within(dir: &Path, child: &Path) -> bool {
    let mut d = dir.components();
    let mut c = child.components();
    loop {
        match (d.next(), c.next()) {
            (Some(dc), Some(cc)) => {
                if dc != cc {
                    return false;
                }
            }
            // `dir` fully consumed → `child` is `dir` or below it.
            (None, _) => return true,
            // `child` is shorter than `dir` → it is an ancestor, not a descendant.
            (Some(_), None) => return false,
        }
    }
}

/// True if `dir` (a candidate directory to grant) is grantable — i.e. it is not
/// a filesystem root. Granting a filesystem root would, via transitive
/// membership, admit the entire tree, so it is refused.
fn dir_is_grantable(dir: &Path) -> bool {
    dir.parent().is_some()
}

impl PathScope {
    pub fn new() -> Self {
        Self {
            allowed: Mutex::new(HashSet::new()),
            allowed_dirs: Mutex::new(HashSet::new()),
            workspace_root: Mutex::new(None),
        }
    }

    /// Admit a path into the scope, returning its canonical form. For
    /// non-existent paths (e.g. save-as targets), the parent directory is
    /// canonicalised and the file name is appended.
    pub fn allow(&self, p: &std::path::Path) -> std::io::Result<PathBuf> {
        let canon = canonicalise(p)?;
        Ok(self.allow_canonical(&canon))
    }

    /// Admit an already-canonical path into the scope without touching the
    /// filesystem again.
    pub fn allow_canonical(&self, canon: &std::path::Path) -> PathBuf {
        let canon = canon.to_path_buf();
        // Recover from a poisoned lock instead of panicking: the contained
        // HashSet has no invariants the panicked thread could have broken
        // partway through.
        let mut allowed = self
            .allowed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        allowed.insert(canon.clone());
        canon
    }

    /// Returns `true` if `p` (canonicalised) is in the scope.
    pub fn check(&self, p: &std::path::Path) -> bool {
        let Ok(canon) = canonicalise(p) else {
            return false;
        };
        self.check_canonical(&canon)
    }

    /// Returns `true` if an already-canonical path is in the scope without
    /// touching the filesystem again.
    pub fn check_canonical(&self, canon: &std::path::Path) -> bool {
        self.allowed
            .lock()
            .map(|g| g.contains(canon))
            .unwrap_or_else(|poisoned| poisoned.into_inner().contains(canon))
    }

    /// Canonicalise without mutating the scope. Useful when a caller wants
    /// to compare a candidate to a list of known-good paths (e.g. recents)
    /// before deciding whether to admit it.
    pub fn canonicalise(p: &std::path::Path) -> std::io::Result<PathBuf> {
        canonicalise(p)
    }

    /// Resolve a (possibly not-yet-existing) path into its canonical target plus
    /// the ancestor directories that would have to be created to open it.
    ///
    /// Where [`canonicalise`](Self::canonicalise) requires the *immediate*
    /// parent to exist, this walks up to the nearest existing ancestor,
    /// canonicalises that, and re-appends the missing tail. The returned
    /// `missing_dirs` are the canonical directories that do not yet exist,
    /// ordered outermost-first (ready for sequential `create_dir`); the target
    /// file itself is never included. Does NOT mutate the scope.
    pub fn resolve_creatable(p: &std::path::Path) -> std::io::Result<(PathBuf, Vec<PathBuf>)> {
        resolve_creatable(p)
    }

    // --- directory allowlist (Phase 2) ---

    /// Admit a directory (and, transitively, its descendants) into the scope.
    /// Must only be called from trusted entry points: the OS folder picker
    /// (`cmd::browse::pick_base_dir`) or re-admitting a persisted trusted base
    /// on startup. Returns the canonical directory path.
    pub fn allow_dir(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = std::fs::canonicalize(p)?;
        if !canon.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "allow_dir target is not a directory",
            ));
        }
        let mut dirs = self.allowed_dirs.lock().unwrap_or_else(|p| p.into_inner());
        dirs.insert(canon.clone());
        Ok(canon)
    }

    /// True if `canon` (already canonical) is equal to, or nested under, any
    /// admitted directory. Component-wise ancestor match.
    pub fn is_within_allowed_dir(&self, canon: &Path) -> bool {
        let dirs = self.allowed_dirs.lock().unwrap_or_else(|p| p.into_inner());
        dirs.iter().any(|dir| is_within(dir, canon))
    }

    /// Check that `p` (a directory to browse) is within an admitted base.
    /// Canonicalises first (resolving symlinks) so an entry that escapes the
    /// base via a symlink is rejected.
    pub fn check_dir_access(&self, p: &Path) -> bool {
        let Ok(canon) = std::fs::canonicalize(p) else {
            return false;
        };
        self.is_within_allowed_dir(&canon)
    }

    /// Snapshot of the admitted directories (diagnostics / tests).
    pub fn allowed_dirs(&self) -> Vec<PathBuf> {
        self.allowed_dirs
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    /// Set the UI workspace root. Canonicalises `p` and **requires** it to be
    /// within an already-admitted directory; otherwise returns an error and the
    /// current root is left unchanged. This never inserts into `allowed_dirs`,
    /// so the renderer cannot use it to widen authority.
    pub fn set_workspace_root(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = std::fs::canonicalize(p)?;
        if !self.is_within_allowed_dir(&canon) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "workspace root is outside all granted directories",
            ));
        }
        let mut root = self
            .workspace_root
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        *root = Some(canon.clone());
        Ok(canon)
    }

    /// The current workspace root, if any.
    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.workspace_root
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Deepest admitted directory that contains `canon` (component-wise).
    /// Prefer this when a preferred workspace base is not itself listable.
    pub fn deepest_allowed_containing(&self, canon: &Path) -> Option<PathBuf> {
        let dirs = self
            .allowed_dirs
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        dirs.iter()
            .filter(|dir| is_within(dir, canon))
            .max_by_key(|dir| dir.components().count())
            .cloned()
    }

    /// Test-visible wrapper over the root guard predicate.
    #[cfg(test)]
    pub fn grants_parent_dir(dir: &Path) -> bool {
        dir_is_grantable(dir)
    }

    /// Admit a file via a TRUSTED origin (CLI argv or OS open dialog) and, when
    /// its canonical parent is not a filesystem root, also admit that parent
    /// directory so the user can browse/open siblings. The renderer must never
    /// call this (it would forge a directory grant); renderer opens go through
    /// `cmd::file::request_open_file`, which only admits the single file.
    pub fn allow_file_and_parent(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = self.allow(p)?;
        if let Some(parent) = canon.parent() {
            if dir_is_grantable(parent) {
                // Best-effort: parent of a real file is a dir; ignore errors so
                // a transient stat failure never blocks opening the file.
                let _ = self.allow_dir(parent);
            }
        }
        Ok(canon)
    }
}

/// Lexically normalise a path without touching the filesystem, collapsing
/// `.` and resolving `..` against earlier components. Returns an error if a
/// `..` would escape above the root of the accumulated path. Unlike
/// [`canonicalise`], this does NOT resolve symlinks or require the path to
/// exist — callers that need symlink safety must additionally canonicalise
/// and re-check containment.
pub(crate) fn normalize_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.as_ref().components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Path escapes above the document root".to_string());
                }
            }
            std::path::Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

/// Filename extensions the backend recognises as Markdown. Single source of
/// truth so the open dialog, directory browser, and open-path guards agree.
pub(crate) const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

/// True if `p`'s final extension (case-insensitive) is one of
/// [`MARKDOWN_EXTENSIONS`]. Operates on the filesystem *path* extension; link
/// targets (which may carry `#fragment`/`?query`) are classified by
/// `pmd_core::facts::links`, not here.
pub(crate) fn is_markdown_path(p: &Path) -> bool {
    let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let lower = ext.to_lowercase();
    MARKDOWN_EXTENSIONS.iter().any(|e| *e == lower)
}

fn canonicalise(p: &std::path::Path) -> std::io::Result<PathBuf> {
    if p.exists() {
        std::fs::canonicalize(p)
    } else {
        let parent = p.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory")
        })?;
        let parent_canon = std::fs::canonicalize(parent)?;
        let file_name = p.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
        })?;
        Ok(parent_canon.join(file_name))
    }
}

/// Resolve a path that may not yet exist (and whose parent dirs may not exist
/// either) into `(canonical_target, missing_dirs)`. Relative inputs are
/// resolved against the current working directory. See
/// [`PathScope::resolve_creatable`] for the contract.
fn resolve_creatable(p: &std::path::Path) -> std::io::Result<(PathBuf, Vec<PathBuf>)> {
    use std::io::{Error, ErrorKind};
    if p.file_name().is_none() {
        return Err(Error::new(ErrorKind::InvalidInput, "path has no file name"));
    }
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir()?.join(p)
    };

    // Walk up to the nearest existing ancestor, recording the missing tail
    // components (leaf-first).
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = abs.as_path();
    let existing = loop {
        if cursor.exists() {
            break cursor;
        }
        match (cursor.file_name(), cursor.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name.to_os_string());
                cursor = parent;
            }
            _ => {
                return Err(Error::new(
                    ErrorKind::NotFound,
                    "no existing ancestor directory",
                ))
            }
        }
    };

    let mut canon = std::fs::canonicalize(existing)?;
    // Re-append outermost-first; every component except the final file name is
    // a directory that must be created.
    tail.reverse();
    let last = tail.len().saturating_sub(1);
    let mut missing_dirs = Vec::new();
    for (i, comp) in tail.into_iter().enumerate() {
        canon.push(comp);
        if i < last {
            missing_dirs.push(canon.clone());
        }
    }
    Ok((canon, missing_dirs))
}

#[cfg(test)]
mod tests {
    use super::{is_markdown_path, is_within, normalize_path, PathScope};
    use std::path::Path;

    #[test]
    fn is_within_is_component_wise_not_textual() {
        // Equal paths and true descendants are within.
        assert!(is_within(Path::new("/base"), Path::new("/base")));
        assert!(is_within(Path::new("/base"), Path::new("/base/x")));
        assert!(is_within(Path::new("/base"), Path::new("/base/x/y")));
        // A sibling that merely shares a textual prefix is NOT within.
        assert!(!is_within(Path::new("/base"), Path::new("/base_evil")));
        assert!(!is_within(Path::new("/base"), Path::new("/base_evil/x")));
        // An ancestor is not a descendant.
        assert!(!is_within(Path::new("/base/x"), Path::new("/base")));
    }

    #[test]
    fn is_within_matches_path_starts_with() {
        // Pin equivalence to the `child == dir || child.starts_with(dir)` form
        // the scattered copy used, across a spread of shapes.
        for (dir, child) in [
            ("/a/b", "/a/b"),
            ("/a/b", "/a/b/c"),
            ("/a/b", "/a/bc"),
            ("/a/b", "/a"),
            ("/a/b", "/x/y"),
            ("/", "/anything"),
        ] {
            let d = Path::new(dir);
            let c = Path::new(child);
            let reference = c == d || c.starts_with(d);
            assert_eq!(is_within(d, c), reference, "dir={dir} child={child}");
        }
    }

    #[test]
    fn normalize_path_collapses_curdir_and_resolves_parentdir() {
        assert_eq!(
            normalize_path("/base/./sub/../file.md").unwrap(),
            Path::new("/base/file.md")
        );
        // Trailing separator does not add a trailing empty component.
        assert_eq!(
            normalize_path("/base/sub/").unwrap(),
            Path::new("/base/sub")
        );
        // Relative inputs stay relative (no cwd resolution here).
        assert_eq!(normalize_path("a/b/../c").unwrap(), Path::new("a/c"));
    }

    #[test]
    fn normalize_path_refuses_escape_above_root() {
        assert!(normalize_path("/base/../../etc/passwd").is_err());
        assert!(normalize_path("../escape").is_err());
    }

    #[test]
    fn normalize_path_does_not_resolve_symlinks_or_require_existence() {
        // Nonexistent path is normalised lexically, no filesystem access.
        assert_eq!(
            normalize_path("/definitely/does/not/exist/../x").unwrap(),
            Path::new("/definitely/does/not/x")
        );
    }

    #[test]
    fn is_markdown_path_matches_known_extensions_case_insensitively() {
        for ok in ["a.md", "a.MARKDOWN", "a.Mdown", "deep/dir/a.mkd", "a.b.md"] {
            assert!(is_markdown_path(Path::new(ok)), "{ok} should be markdown");
        }
        for no in ["a.txt", "README", "a.mdx", "notes.md.bak"] {
            assert!(
                !is_markdown_path(Path::new(no)),
                "{no} should not be markdown"
            );
        }
    }

    #[test]
    fn canonicalise_resolves_symlink_and_rejects_missing_parent() {
        let dir = tempfile::tempdir().expect("dir");
        let real = dir.path().join("real.md");
        std::fs::write(&real, "x").expect("write");
        let canon_real = std::fs::canonicalize(&real).unwrap();

        // A symlink to the file canonicalises to the real target.
        #[cfg(unix)]
        {
            let link = dir.path().join("link.md");
            std::os::unix::fs::symlink(&real, &link).expect("symlink");
            assert_eq!(PathScope::canonicalise(&link).unwrap(), canon_real);
        }

        // Nonexistent file with an existing parent: parent is canonicalised and
        // the file name re-appended (supports save-as targets).
        let new = dir.path().join("new.md");
        assert_eq!(
            PathScope::canonicalise(&new).unwrap(),
            dir.path().canonicalize().unwrap().join("new.md")
        );

        // Nonexistent file whose parent also does not exist: error.
        let orphan = dir.path().join("missing_dir").join("f.md");
        assert!(PathScope::canonicalise(&orphan).is_err());
    }

    #[test]
    fn is_within_rejects_symlink_escape_after_canonicalise() {
        // A symlink inside `base` that points outside must, once canonicalised,
        // fail the containment test — this is the property browsing relies on.
        #[cfg(unix)]
        {
            let base = tempfile::tempdir().expect("base");
            let outside = tempfile::tempdir().expect("outside");
            let outside_file = outside.path().join("secret.md");
            std::fs::write(&outside_file, "x").expect("write");

            let escape = base.path().join("escape.md");
            std::os::unix::fs::symlink(&outside_file, &escape).expect("symlink");

            let base_canon = base.path().canonicalize().unwrap();
            let escape_canon = std::fs::canonicalize(&escape).unwrap();
            assert!(
                !is_within(&base_canon, &escape_canon),
                "symlink escaping the base must not be contained"
            );
        }
    }

    #[test]
    fn resolve_creatable_existing_parent_has_no_missing_dirs() {
        let dir = tempfile::tempdir().expect("dir");
        let target = dir.path().join("new.md");

        let (canon, missing) = PathScope::resolve_creatable(&target).expect("resolve");

        assert_eq!(canon, dir.path().canonicalize().unwrap().join("new.md"));
        assert!(missing.is_empty(), "parent exists -> nothing to create");
    }

    #[test]
    fn resolve_creatable_lists_missing_dirs_outermost_first() {
        let dir = tempfile::tempdir().expect("dir");
        let base = dir.path().canonicalize().unwrap();
        let target = base.join("a").join("b").join("new.md");

        let (canon, missing) = PathScope::resolve_creatable(&target).expect("resolve");

        assert_eq!(canon, base.join("a").join("b").join("new.md"));
        assert_eq!(missing, vec![base.join("a"), base.join("a").join("b")]);
    }

    #[test]
    fn allows_existing_file() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let file_path = dir.path().join("draft.md");
        std::fs::write(&file_path, "content").expect("create temp file");
        let scope = PathScope::new();

        let allowed = scope.allow(&file_path).expect("allow save target");

        assert_eq!(allowed, file_path.canonicalize().unwrap());
        assert!(scope.check(&file_path));
    }

    #[test]
    fn set_workspace_root_accepts_within_allowed_dir_and_rejects_outside() {
        let base = tempfile::tempdir().expect("base");
        let sub = base.path().join("docs");
        std::fs::create_dir(&sub).expect("sub");
        let outside = tempfile::tempdir().expect("outside");

        let scope = PathScope::new();
        scope.allow_dir(base.path()).expect("admit base");

        // Within an admitted dir → accepted, stored, returns canonical.
        let canon = scope.set_workspace_root(&sub).expect("within base");
        assert_eq!(canon, sub.canonicalize().unwrap());
        assert_eq!(scope.workspace_root(), Some(sub.canonicalize().unwrap()));

        // Outside all admitted dirs → rejected, and allowed_dirs is unchanged.
        let before = scope.allowed_dirs().len();
        assert!(scope.set_workspace_root(outside.path()).is_err());
        assert_eq!(scope.allowed_dirs().len(), before, "must not escalate");
        // Root unchanged after a rejected set.
        assert_eq!(scope.workspace_root(), Some(sub.canonicalize().unwrap()));
    }

    #[test]
    fn allow_file_and_parent_grants_parent_dir() {
        let dir = tempfile::tempdir().expect("dir");
        let file = dir.path().join("readme.md");
        std::fs::write(&file, "x").expect("write");
        let scope = PathScope::new();

        let canon = scope.allow_file_and_parent(&file).expect("admit");
        assert_eq!(canon, file.canonicalize().unwrap());
        // The file is in scope...
        assert!(scope.check_canonical(&canon));
        // ...and its parent dir is now an admitted dir (siblings browsable).
        let sibling = dir.path().join("other.md");
        std::fs::write(&sibling, "y").expect("write sibling");
        assert!(scope.is_within_allowed_dir(&sibling.canonicalize().unwrap()));
    }

    #[test]
    fn deepest_allowed_containing_picks_nested_grant() {
        let outer = tempfile::tempdir().expect("outer");
        let inner = outer.path().join("proj");
        let file = inner.join("docs").join("a.md");
        std::fs::create_dir_all(file.parent().unwrap()).expect("mkdir");
        std::fs::write(&file, "x").expect("write");
        let scope = PathScope::new();
        scope.allow_dir(outer.path()).expect("outer grant");
        scope.allow_dir(&inner).expect("inner grant");

        let got = scope
            .deepest_allowed_containing(&file.canonicalize().unwrap())
            .expect("containing grant");
        assert_eq!(got, inner.canonicalize().unwrap());
    }

    #[test]
    fn deepest_allowed_containing_none_when_outside_all_grants() {
        let dir = tempfile::tempdir().expect("dir");
        let file = dir.path().join("a.md");
        std::fs::write(&file, "x").expect("write");
        let scope = PathScope::new();
        assert!(scope
            .deepest_allowed_containing(&file.canonicalize().unwrap())
            .is_none());
    }

    #[test]
    fn allow_file_and_parent_root_guard_skips_filesystem_root() {
        // We can't write to "/", so simulate a path whose parent is the root by
        // checking the guard directly: a file directly under root must NOT add a
        // dir grant. Use the canonical root of the temp dir's filesystem via "/".
        let scope = PathScope::new();
        // Construct a path "/<name>" that may or may not exist; the guard is
        // about the parent being a filesystem root (parent.parent() == None).
        // We assert no allowed_dir is added even when the file itself is admitted
        // via a real file placed at a mount we control is not possible portably,
        // so we test the helper's guard predicate instead.
        assert!(
            !PathScope::grants_parent_dir(std::path::Path::new("/")),
            "root has no parent to grant"
        );
        assert!(
            PathScope::grants_parent_dir(std::path::Path::new("/home/user")),
            "a normal dir is grantable"
        );
        let _ = scope; // silence unused in case
    }
}
