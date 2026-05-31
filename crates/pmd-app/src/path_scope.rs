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
fn is_within(dir: &Path, child: &Path) -> bool {
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

#[cfg(test)]
mod tests {
    use super::PathScope;

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
}
