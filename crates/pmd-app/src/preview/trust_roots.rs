use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::doc::state::DocId;
use crate::preview::git_root::{discover_document_trust_context, DocumentTrustContext};
use crate::preview::grants::{grant_remembered_root, GrantStore};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustRootState {
    Unknown,
    Trusted,
    Declined,
}

impl Default for TrustRootState {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustRootDecision {
    pub canonical_root: PathBuf,
    pub state: TrustRootState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct AppliedTrustRoots {
    pub trust_context: DocumentTrustContextForUi,
    pub granted_roots: Vec<PathBuf>,
    pub declined_roots: Vec<PathBuf>,
    pub recommended_repo_root: Option<PathBuf>,
    pub should_prompt_for_repo_root: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct DocumentTrustContextForUi {
    pub doc_dir: Option<PathBuf>,
    pub git_root: Option<PathBuf>,
    pub git_root_state: TrustRootState,
    pub should_prompt_for_repo_root: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedTrustRoots {
    roots: Vec<TrustRootDecision>,
}

pub struct TrustRootStore {
    decisions: BTreeMap<PathBuf, TrustRootState>,
    settings_path: PathBuf,
}

impl TrustRootStore {
    pub fn load(settings_path: PathBuf) -> Result<Self, String> {
        let bytes = match std::fs::read(&settings_path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::empty_at(settings_path));
            }
            Err(err) => return Err(err.to_string()),
        };
        let persisted: PersistedTrustRoots =
            serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
        let mut store = Self::empty_at(settings_path);
        for decision in persisted.roots {
            if decision.state != TrustRootState::Unknown {
                if let Some(canonical) = persisted_authority_root(decision.canonical_root) {
                    store.decisions.insert(canonical, decision.state);
                }
            }
        }
        Ok(store)
    }

    #[doc(hidden)]
    pub fn empty_for_test() -> Self {
        Self::empty_at(PathBuf::new())
    }

    #[doc(hidden)]
    pub fn empty_at(settings_path: PathBuf) -> Self {
        Self {
            decisions: BTreeMap::new(),
            settings_path,
        }
    }

    pub fn remember(&mut self, root: &Path, state: TrustRootState) -> Result<(), String> {
        let canonical = canonical_directory(root)?;
        if state == TrustRootState::Unknown {
            self.decisions.remove(&canonical);
        } else {
            self.decisions.insert(canonical, state);
        }
        self.persist()
    }

    pub fn forget(&mut self, root: &Path) -> Result<(), String> {
        let canonical = canonical_directory(root).unwrap_or_else(|_| root.to_path_buf());
        self.decisions.remove(&canonical);
        self.persist()
    }

    pub fn decision_for(&self, canonical_root: &Path) -> Option<TrustRootState> {
        self.decisions.get(canonical_root).copied()
    }

    pub fn list(&self) -> Vec<TrustRootDecision> {
        self.decisions
            .iter()
            .map(|(canonical_root, state)| TrustRootDecision {
                canonical_root: canonical_root.clone(),
                state: *state,
            })
            .collect()
    }

    pub fn apply_remembered_trust_for_document(
        &self,
        window_label: &str,
        doc_id: u64,
        doc_path: &Path,
        grants: &mut GrantStore,
    ) -> Result<AppliedTrustRoots, String> {
        let context = discover_document_trust_context(doc_path)?;
        self.apply_context(window_label, DocId(doc_id), context, |root| {
            grants.grant(window_label, DocId(doc_id), root).map(|_| ())
        })
    }

    fn apply_context<F>(
        &self,
        _window_label: &str,
        _doc_id: DocId,
        context: DocumentTrustContext,
        mut grant_root: F,
    ) -> Result<AppliedTrustRoots, String>
    where
        F: FnMut(&Path) -> Result<(), String>,
    {
        let mut applied = AppliedTrustRoots {
            trust_context: DocumentTrustContextForUi {
                doc_dir: Some(context.doc_dir.clone()),
                git_root: context.git_root.clone(),
                git_root_state: TrustRootState::Unknown,
                should_prompt_for_repo_root: false,
            },
            ..AppliedTrustRoots::default()
        };

        let Some(git_root) = context.git_root else {
            return Ok(applied);
        };
        let decision = self
            .decision_for(&git_root)
            .unwrap_or(TrustRootState::Unknown);
        applied.trust_context.git_root_state = decision;
        match decision {
            TrustRootState::Trusted => {
                grant_root(&git_root)?;
                applied.granted_roots.push(git_root);
            }
            TrustRootState::Declined => {
                applied.declined_roots.push(git_root);
            }
            TrustRootState::Unknown => {
                applied.recommended_repo_root = Some(git_root);
                applied.should_prompt_for_repo_root = true;
            }
        }
        applied.trust_context.should_prompt_for_repo_root = applied.should_prompt_for_repo_root;
        Ok(applied)
    }

    fn persist(&self) -> Result<(), String> {
        if self.settings_path.as_os_str().is_empty() {
            return Ok(());
        }
        if let Some(parent) = self.settings_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let persisted = PersistedTrustRoots { roots: self.list() };
        let bytes = serde_json::to_vec_pretty(&persisted).map_err(|err| err.to_string())?;
        std::fs::write(&self.settings_path, bytes).map_err(|err| err.to_string())
    }

    #[doc(hidden)]
    pub fn remember_trusted_for_test(&mut self, root: &Path) -> Result<(), String> {
        self.remember(root, TrustRootState::Trusted)
    }

    #[doc(hidden)]
    pub fn remember_declined_for_test(&mut self, root: &Path) -> Result<(), String> {
        self.remember(root, TrustRootState::Declined)
    }
}

static TRUST_ROOT_STORE: OnceLock<Mutex<TrustRootStore>> = OnceLock::new();

pub fn init_trust_root_store(settings_path: PathBuf) -> Result<(), String> {
    let store = TrustRootStore::load(settings_path)?;
    let _ = TRUST_ROOT_STORE.set(Mutex::new(store));
    Ok(())
}

pub fn trust_root_settings_path() -> PathBuf {
    crate::state::settings::path().with_file_name("trust-roots.json")
}

pub fn remember_trusted_root_path(canonical_root: &Path) -> Result<(), String> {
    trust_root_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remember(canonical_root, TrustRootState::Trusted)
}

pub fn apply_remembered_trust_for_document_global(
    window_label: &str,
    doc_id: DocId,
    doc_path: &Path,
) -> Result<AppliedTrustRoots, String> {
    let context = discover_document_trust_context(doc_path)?;
    let store = trust_root_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    store.apply_context(window_label, doc_id, context, |root| {
        grant_remembered_root(window_label, doc_id, root).map(|_| ())
    })
}

pub fn trust_context_for_document(doc_path: &Path) -> Result<DocumentTrustContextForUi, String> {
    let context = discover_document_trust_context(doc_path)?;
    let state = match &context.git_root {
        Some(root) => trust_root_store()?
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .decision_for(root)
            .unwrap_or(TrustRootState::Unknown),
        None => TrustRootState::Unknown,
    };
    let should_prompt_for_repo_root =
        context.git_root.is_some() && state == TrustRootState::Unknown;
    Ok(DocumentTrustContextForUi {
        doc_dir: Some(context.doc_dir),
        git_root: context.git_root,
        git_root_state: state,
        should_prompt_for_repo_root,
    })
}

fn trust_root_store() -> Result<&'static Mutex<TrustRootStore>, String> {
    TRUST_ROOT_STORE
        .get()
        .ok_or_else(|| "trust root store is not initialized".to_string())
}

fn canonical_directory(root: &Path) -> Result<PathBuf, String> {
    let canonical = root.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.is_dir() {
        return Err(format!(
            "trust root is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn persisted_authority_root(root: PathBuf) -> Option<PathBuf> {
    if !root.is_absolute() {
        return None;
    }
    match root.canonicalize() {
        Ok(canonical) if canonical == root => Some(root),
        Ok(_) => None,
        Err(_) => Some(root),
    }
}

#[tauri::command]
pub async fn remember_trusted_root(canonical_root: PathBuf) -> Result<(), String> {
    remember_trusted_root_path(&canonical_root)
}

#[tauri::command]
pub async fn remember_declined_root(canonical_root: PathBuf) -> Result<(), String> {
    trust_root_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remember(&canonical_root, TrustRootState::Declined)
}

#[tauri::command]
pub async fn forget_trust_root(canonical_root: PathBuf) -> Result<(), String> {
    crate::preview::grants::revoke_grants_for_root(&canonical_root)?;
    trust_root_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .forget(&canonical_root)
}

#[tauri::command]
pub async fn list_trust_roots() -> Result<Vec<TrustRootDecision>, String> {
    Ok(trust_root_store()?
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .list())
}
