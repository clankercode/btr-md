use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub trait AssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String>;
    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String>;
}

pub struct ProductionAssetScopeMirror {
    scope: tauri::scope::fs::Scope,
}

impl ProductionAssetScopeMirror {
    pub fn new(scope: tauri::scope::fs::Scope) -> Self {
        Self { scope }
    }
}

impl AssetScopeMirror for ProductionAssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.scope
            .allow_directory(canonical_root, true)
            .map_err(|err| err.to_string())
    }

    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String> {
        let _ = canonical_root;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct RecordingAssetScopeMirror {
    allowed: Arc<Mutex<Vec<PathBuf>>>,
    revoked: Arc<Mutex<Vec<PathBuf>>>,
}

impl RecordingAssetScopeMirror {
    pub fn allowed_roots(&self) -> Vec<PathBuf> {
        self.allowed
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub fn revoked_roots(&self) -> Vec<PathBuf> {
        self.revoked
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}

impl AssetScopeMirror for RecordingAssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.allowed
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(canonical_root.to_path_buf());
        Ok(())
    }

    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.revoked
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(canonical_root.to_path_buf());
        Ok(())
    }
}
