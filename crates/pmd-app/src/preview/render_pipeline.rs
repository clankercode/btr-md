use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pmd_core::incremental::render_incremental;

use crate::preview::contracts::RenderResult;
use crate::preview::resource_policy::{resolve_resources, ResourcePolicyContext};
use crate::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

pub fn render_preview(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    allowed_roots: Vec<std::path::PathBuf>,
    markdown: &str,
) -> Result<RenderResult, String> {
    let mut core = render_incremental(markdown);
    core.version = version;
    let policy = resolve_resources(ResourcePolicyContext {
        doc_id,
        version,
        doc_path,
        markdown,
        facts: &core.facts,
        rendered_html: &core.html,
        allowed_roots,
    })?;
    Ok(RenderResult::from_core_and_policy(
        doc_id, version, core, policy,
    ))
}

#[derive(Clone)]
pub struct ValidationWorker {
    latest_versions: Arc<Mutex<BTreeMap<u64, u64>>>,
    engine: Arc<tokio::sync::Mutex<ValidationEngine>>,
}

impl ValidationWorker {
    pub fn new() -> Self {
        Self {
            latest_versions: Arc::new(Mutex::new(BTreeMap::new())),
            engine: Arc::new(tokio::sync::Mutex::new(ValidationEngine::new(
                ValidationLimits::default(),
            ))),
        }
    }

    pub fn observe_render(&self, doc_id: u64, version: u64) {
        let mut latest = self
            .latest_versions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if latest.get(&doc_id).copied().unwrap_or(0) < version {
            latest.insert(doc_id, version);
        }
    }

    pub async fn validate_current(
        &self,
        doc_id: u64,
        version: u64,
        doc_path: PathBuf,
        markdown: String,
        initial_diagnostics: crate::preview::contracts::DocumentDiagnostics,
    ) -> Result<Option<crate::preview::contracts::DocumentDiagnostics>, String> {
        let latest_versions = self.latest_versions.clone();
        let is_current = Arc::new(move |candidate_doc: u64, candidate_version: u64| {
            latest_versions
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(&candidate_doc)
                .copied()
                == Some(candidate_version)
        });
        if !is_current(doc_id, version) {
            return Ok(None);
        }
        let request = ValidationRequest {
            doc_id,
            version,
            doc_path,
            markdown,
            initial_diagnostics,
            is_current: is_current.clone(),
        };
        let diagnostics = self.engine.lock().await.validate(request).await?;
        if !is_current(diagnostics.doc_id, diagnostics.version) {
            return Ok(None);
        }
        Ok(Some(diagnostics))
    }

    pub async fn invalidate_for_save(&self, path: &Path) {
        self.engine.lock().await.invalidate_for_save(path);
    }

    pub fn invalidate_for_watcher_change(&self, path: PathBuf) {
        let engine = self.engine.clone();
        tauri::async_runtime::spawn(async move {
            engine.lock().await.invalidate_for_watcher_change(&path);
        });
    }

    pub async fn invalidate_for_grant_change(&self, doc_id: u64) {
        self.engine.lock().await.invalidate_for_grant_change(doc_id);
    }

    pub async fn invalidate_for_reload(&self, doc_id: u64) {
        self.engine.lock().await.invalidate_for_reload(doc_id);
    }
}

impl Default for ValidationWorker {
    fn default() -> Self {
        Self::new()
    }
}
