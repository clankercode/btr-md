use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

use crate::doc::state::DocId;
use crate::preview::asset_scope::{AssetScopeMirror, ProductionAssetScopeMirror};
use crate::preview::render_pipeline::ValidationWorker;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(transparent)]
pub struct AssetGrantId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssetGrant {
    pub id: AssetGrantId,
    pub window_label: String,
    pub doc_id: DocId,
    pub canonical_root: PathBuf,
}

pub struct GrantStore {
    next_id: u64,
    grants: BTreeMap<AssetGrantId, AssetGrant>,
    root_counts: BTreeMap<PathBuf, usize>,
    mirror: Box<dyn AssetScopeMirror + Send + Sync>,
}

impl GrantStore {
    pub fn with_mirror(mirror: Box<dyn AssetScopeMirror + Send + Sync>) -> Self {
        Self {
            next_id: 1,
            grants: BTreeMap::new(),
            root_counts: BTreeMap::new(),
            mirror,
        }
    }

    pub fn grant(
        &mut self,
        window_label: &str,
        doc_id: DocId,
        root: &Path,
    ) -> Result<AssetGrant, String> {
        let canonical_root = root.canonicalize().map_err(|err| err.to_string())?;
        if !canonical_root.is_dir() {
            return Err(format!(
                "asset grant root is not a directory: {}",
                canonical_root.display()
            ));
        }

        let count = self.root_counts.entry(canonical_root.clone()).or_insert(0);
        if *count == 0 {
            self.mirror.allow_directory(&canonical_root)?;
        }
        *count += 1;

        let grant = AssetGrant {
            id: AssetGrantId(self.next_id),
            window_label: window_label.to_string(),
            doc_id,
            canonical_root,
        };
        self.next_id += 1;
        self.grants.insert(grant.id, grant.clone());
        Ok(grant)
    }

    pub fn revoke(
        &mut self,
        window_label: &str,
        doc_id: DocId,
        grant_id: AssetGrantId,
    ) -> Result<(), String> {
        let grant = self
            .grants
            .get(&grant_id)
            .ok_or_else(|| format!("unknown asset grant id {}", grant_id.0))?;
        if grant.window_label != window_label || grant.doc_id != doc_id {
            return Err("asset grant does not belong to this window/document".into());
        }
        let canonical_root = grant.canonical_root.clone();
        let count = self
            .root_counts
            .get(&canonical_root)
            .copied()
            .ok_or_else(|| "asset grant root count is missing".to_string())?;

        if count == 1 {
            self.mirror.revoke_directory(&canonical_root)?;
            self.root_counts.remove(&canonical_root);
        } else {
            self.root_counts.insert(canonical_root.clone(), count - 1);
        }
        self.grants.remove(&grant_id);
        Ok(())
    }

    pub fn is_allowed(&self, window_label: &str, doc_id: DocId, path: &Path) -> bool {
        let Ok(canonical_path) = path.canonicalize() else {
            return false;
        };
        self.grants.values().any(|grant| {
            grant.window_label == window_label
                && grant.doc_id == doc_id
                && canonical_path.starts_with(&grant.canonical_root)
        })
    }

    pub fn active_roots(&self, window_label: &str, doc_id: DocId) -> Vec<PathBuf> {
        let mut roots = self
            .grants
            .values()
            .filter(|grant| grant.window_label == window_label && grant.doc_id == doc_id)
            .map(|grant| grant.canonical_root.clone())
            .collect::<Vec<_>>();
        roots.sort();
        roots.dedup();
        roots
    }

    pub fn list(&self, window_label: &str, doc_id: DocId) -> Vec<AssetGrant> {
        self.grants
            .values()
            .filter(|grant| grant.window_label == window_label && grant.doc_id == doc_id)
            .cloned()
            .collect()
    }

    pub fn revoke_all_for_doc(&mut self, doc_id: DocId) -> Result<(), String> {
        let ids = self
            .grants
            .values()
            .filter(|grant| grant.doc_id == doc_id)
            .map(|grant| grant.id)
            .collect::<Vec<_>>();
        for id in ids {
            let Some(grant) = self.grants.get(&id).cloned() else {
                continue;
            };
            self.revoke(&grant.window_label, doc_id, id)?;
        }
        Ok(())
    }

    pub fn revoke_all_for_root(&mut self, root: &Path) -> Result<(), String> {
        let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let ids = self
            .grants
            .values()
            .filter(|grant| grant.canonical_root == canonical_root)
            .map(|grant| grant.id)
            .collect::<Vec<_>>();
        for id in ids {
            let Some(grant) = self.grants.get(&id).cloned() else {
                continue;
            };
            self.revoke(&grant.window_label, grant.doc_id, id)?;
        }
        Ok(())
    }

    #[doc(hidden)]
    pub fn grant_for_test(
        &mut self,
        window_label: &str,
        doc_id: u64,
        root: &Path,
    ) -> Result<AssetGrant, String> {
        self.grant(window_label, DocId(doc_id), root)
    }

    #[doc(hidden)]
    pub fn revoke_for_test(
        &mut self,
        window_label: &str,
        doc_id: u64,
        grant_id: AssetGrantId,
    ) -> Result<(), String> {
        self.revoke(window_label, DocId(doc_id), grant_id)
    }

    #[doc(hidden)]
    pub fn is_allowed_for_test(&self, window_label: &str, doc_id: u64, path: &Path) -> bool {
        self.is_allowed(window_label, DocId(doc_id), path)
    }
}

static GRANT_STORE: OnceLock<Mutex<GrantStore>> = OnceLock::new();

pub fn init_grant_store(scope: tauri::scope::fs::Scope) {
    let _ = GRANT_STORE.set(Mutex::new(GrantStore::with_mirror(Box::new(
        ProductionAssetScopeMirror::new(scope),
    ))));
}

pub fn grant_remembered_root(
    window_label: &str,
    doc_id: DocId,
    root: &Path,
) -> Result<AssetGrant, String> {
    let mut store = grant_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    store.grant(window_label, doc_id, root)
}

pub fn active_grant_roots_for_render(
    window_label: &str,
    doc_id: DocId,
) -> Result<Vec<PathBuf>, String> {
    let store = grant_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(store.active_roots(window_label, doc_id))
}

pub fn revoke_grants_for_doc(doc_id: DocId) -> Result<(), String> {
    let mut store = grant_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    store.revoke_all_for_doc(doc_id)
}

pub fn revoke_grants_for_root(root: &Path) -> Result<(), String> {
    let mut store = grant_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    store.revoke_all_for_root(root)
}

fn grant_store() -> Result<&'static Mutex<GrantStore>, String> {
    GRANT_STORE
        .get()
        .ok_or_else(|| "asset grant store is not initialized".to_string())
}

#[tauri::command]
pub async fn grant_asset_folder(
    window: tauri::Window,
    validation: tauri::State<'_, ValidationWorker>,
    doc_id: DocId,
    version: u64,
    placeholder_id: String,
) -> Result<Option<AssetGrant>, String> {
    let _version = version;
    let _placeholder_id = placeholder_id;
    let Some(path) = window.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|err| err.to_string())?;
    let grant = {
        let mut store = grant_store()?
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        store.grant(window.label(), doc_id, &path)?
    };
    validation.invalidate_for_grant_change(doc_id.0).await;
    Ok(Some(grant))
}

#[tauri::command]
pub async fn grant_recommended_root(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    validation: tauri::State<'_, ValidationWorker>,
    doc_id: DocId,
    version: u64,
    canonical_root: PathBuf,
) -> Result<AssetGrant, String> {
    let _version = version;
    let doc_path = state
        .docs
        .path_of(doc_id)
        .ok_or_else(|| format!("trust root requires a saved document: {}", doc_id.0))?;
    let context = crate::preview::git_root::discover_document_trust_context(&doc_path)?;
    let expected_root = context
        .git_root
        .ok_or_else(|| "document is not inside a git repository".to_string())?;
    let canonical_root = canonical_root
        .canonicalize()
        .map_err(|err| err.to_string())?;
    if canonical_root != expected_root {
        return Err("recommended trust root does not match the document repository".into());
    }
    crate::preview::trust_roots::remember_trusted_root_path(&canonical_root)?;
    let grant = {
        let mut store = grant_store()?
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        store.grant(window.label(), doc_id, &canonical_root)?
    };
    validation.invalidate_for_grant_change(doc_id.0).await;
    Ok(grant)
}

#[tauri::command]
pub async fn revoke_asset_grant(
    window: tauri::Window,
    validation: tauri::State<'_, ValidationWorker>,
    doc_id: DocId,
    grant_id: AssetGrantId,
) -> Result<(), String> {
    {
        let mut store = grant_store()?
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        store.revoke(window.label(), doc_id, grant_id)?;
    }
    validation.invalidate_for_grant_change(doc_id.0).await;
    Ok(())
}

#[tauri::command]
pub async fn list_asset_grants(
    window: tauri::Window,
    doc_id: DocId,
) -> Result<Vec<AssetGrant>, String> {
    let store = grant_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(store.list(window.label(), doc_id))
}
