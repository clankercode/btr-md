use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pmd_core::config_doc::render_config_document;
use pmd_core::document_kind::{detect_document_kind, DocumentKind};
use pmd_core::html::{render_html_document_with_options, HtmlRenderExtras, HtmlRenderOptions};
use pmd_core::incremental::render_incremental;

use crate::path_scope::is_within;
use crate::preview::contracts::RenderResult;
use crate::preview::resource_policy::{resolve_resources, ResourcePolicyContext};
use crate::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

/// Options for [`render_preview`].
#[derive(Debug, Clone, Copy, Default)]
pub struct PreviewRenderOptions {
    /// Frontend request to apply sanitized document `<style>` blocks. Still
    /// gated server-side: only trusted docs (path under allowed roots) may
    /// apply styles even when this is true.
    pub allow_document_styles: bool,
}

pub fn render_preview(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    allowed_roots: Vec<std::path::PathBuf>,
    source: &str,
) -> Result<RenderResult, String> {
    render_preview_with_options(
        doc_id,
        version,
        doc_path,
        allowed_roots,
        source,
        PreviewRenderOptions::default(),
    )
}

pub fn render_preview_with_options(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    allowed_roots: Vec<std::path::PathBuf>,
    source: &str,
    opts: PreviewRenderOptions,
) -> Result<RenderResult, String> {
    let kind = detect_document_kind(doc_path, source);
    let trusted = is_document_trusted(doc_path, &allowed_roots);

    let (mut core, html_extras) = match kind {
        DocumentKind::Html => {
            // Styles only when the document is trusted AND the UI asked for them
            // (after user confirm). Untrusted docs never apply document styles.
            let allow_styles = opts.allow_document_styles && trusted;
            let (result, extras) =
                render_html_document_with_options(source, HtmlRenderOptions { allow_styles });
            // If styles exist but trust is missing, still report available so
            // the UI knows not to prompt (or can show a static notice later).
            let extras = HtmlRenderExtras {
                styles_available: extras.styles_available,
                styles_applied: extras.styles_applied,
            };
            (result, extras)
        }
        DocumentKind::Json | DocumentKind::Yaml | DocumentKind::Toml | DocumentKind::Ini => (
            render_config_document(kind, source),
            HtmlRenderExtras::default(),
        ),
        DocumentKind::Markdown => (render_incremental(source), HtmlRenderExtras::default()),
    };
    core.version = version;
    let policy = resolve_resources(ResourcePolicyContext {
        doc_id,
        version,
        doc_path,
        markdown: source,
        facts: &core.facts,
        rendered_html: &core.html,
        allowed_roots,
    })?;
    let mut result = RenderResult::from_core_and_policy(doc_id, version, core, policy);
    result.document_kind = kind.as_str().to_string();
    // Only advertise styles when the doc is trusted — untrusted never prompts.
    result.document_styles_available =
        kind == DocumentKind::Html && html_extras.styles_available && trusted;
    result.document_styles_applied = html_extras.styles_applied;
    Ok(result)
}

/// A document is trusted for author-style application when it has a path that
/// lies under an admitted allowed root (dialog/CLI open, workspace grant, …).
fn is_document_trusted(doc_path: Option<&Path>, allowed_roots: &[PathBuf]) -> bool {
    let Some(path) = doc_path else {
        return false;
    };
    if allowed_roots.is_empty() {
        return false;
    }
    // Prefer canonical comparison; fall back to lexical when the path is new.
    let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    allowed_roots.iter().any(|root| {
        let root_c = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        is_within(&root_c, &candidate)
    })
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
