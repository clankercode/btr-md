use std::{collections::HashSet, path::PathBuf, sync::Mutex};

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

    pub fn allow(&self, p: &std::path::Path) -> std::io::Result<PathBuf> {
        let canon = if p.exists() {
            std::fs::canonicalize(p)?
        } else {
            let parent = p.parent().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory")
            })?;
            let parent_canon = std::fs::canonicalize(parent)?;
            parent_canon.join(p.file_name().unwrap())
        };
        self.allowed.lock().unwrap().insert(canon.clone());
        Ok(canon)
    }

    pub fn check(&self, p: &std::path::Path) -> bool {
        let canon = if p.exists() {
            std::fs::canonicalize(p).ok()
        } else {
            p.parent().and_then(|parent| {
                std::fs::canonicalize(parent)
                    .ok()
                    .map(|parent_canon| parent_canon.join(p.file_name().unwrap()))
            })
        };
        match canon {
            Some(c) => self.allowed.lock().unwrap().contains(&c),
            None => false,
        }
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
