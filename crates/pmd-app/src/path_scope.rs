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
        let canon = std::fs::canonicalize(p)?;
        self.allowed.lock().unwrap().insert(canon.clone());
        Ok(canon)
    }

    pub fn check(&self, p: &std::path::Path) -> bool {
        match std::fs::canonicalize(p) {
            Ok(c) => self.allowed.lock().unwrap().contains(&c),
            Err(_) => false,
        }
    }
}
