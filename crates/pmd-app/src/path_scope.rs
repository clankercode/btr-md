use std::{collections::HashSet, path::PathBuf, sync::Mutex};

/// Tracks the set of paths the renderer is allowed to read or write.
///
/// Admission to the scope is performed by trusted backend code paths only:
/// the CLI argv parser, the OS file dialog (`open_dialog` / `save_dialog`),
/// and drag/drop events the OS routed through Tauri. The renderer cannot
/// admit arbitrary paths — see `cmd::file::request_open_file` for the
/// re-admission rules it applies on renderer-supplied paths.
///
/// Scope is append-only for the process lifetime; `save_file` additionally
/// requires the path to match the currently-active file (see
/// `AppState::current_path`), so a stale scope entry from an earlier-opened
/// file cannot be used to overwrite that file once the user has moved on.
pub struct PathScope {
    allowed: Mutex<HashSet<PathBuf>>,
}

impl Default for PathScope {
    fn default() -> Self {
        Self::new()
    }
}

impl PathScope {
    pub fn new() -> Self {
        Self {
            allowed: Mutex::new(HashSet::new()),
        }
    }

    /// Admit a path into the scope, returning its canonical form. For
    /// non-existent paths (e.g. save-as targets), the parent directory is
    /// canonicalised and the file name is appended.
    pub fn allow(&self, p: &std::path::Path) -> std::io::Result<PathBuf> {
        let canon = canonicalise(p)?;
        // Recover from a poisoned lock instead of panicking: the contained
        // HashSet has no invariants the panicked thread could have broken
        // partway through.
        let mut allowed = self
            .allowed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        allowed.insert(canon.clone());
        Ok(canon)
    }

    /// Returns `true` if `p` (canonicalised) is in the scope.
    pub fn check(&self, p: &std::path::Path) -> bool {
        let Ok(canon) = canonicalise(p) else {
            return false;
        };
        self.allowed
            .lock()
            .map(|g| g.contains(&canon))
            .unwrap_or_else(|poisoned| poisoned.into_inner().contains(&canon))
    }

    /// Canonicalise without mutating the scope. Useful when a caller wants
    /// to compare a candidate to a list of known-good paths (e.g. recents)
    /// before deciding whether to admit it.
    pub fn canonicalise(p: &std::path::Path) -> std::io::Result<PathBuf> {
        canonicalise(p)
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
}
