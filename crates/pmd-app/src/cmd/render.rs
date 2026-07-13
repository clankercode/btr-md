use std::path::Path;

use crate::preview::contracts::RenderResult;
use crate::preview::render_pipeline::{render_preview_with_options, PreviewRenderOptions};
use crate::AppState;
use tauri::Emitter;

/// Render the active document buffer.
///
/// `allow_document_styles` (IPC camelCase `allowDocumentStyles`): when true,
/// apply sanitized document `<style>` for trusted HTML docs (after UI confirm).
/// Default false; ignored for untrusted / non-HTML.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command args are flat IPC parameters.
pub async fn render_cmd(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    links: tauri::State<'_, crate::preview::link_activation::LinkActivationStore>,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: u64,
    version: u64,
    markdown: String,
    allow_document_styles: Option<bool>,
) -> Result<RenderResult, String> {
    let allow_document_styles = allow_document_styles.unwrap_or(false);
    let snapshot = state.docs.preview_snapshot(doc_id)?;
    let mut allowed_roots = snapshot.allowed_roots;
    allowed_roots.extend(crate::preview::grants::active_grant_roots_for_render(
        window.label(),
        crate::doc::state::DocId(doc_id),
    )?);
    allowed_roots.sort();
    allowed_roots.dedup();
    let result = render_preview_with_options(
        snapshot.doc_id,
        version,
        snapshot.path.as_deref(),
        allowed_roots,
        &markdown,
        PreviewRenderOptions {
            allow_document_styles,
        },
    )?;
    links.record_render_links(
        result.doc_id,
        result.version,
        snapshot.path.as_deref(),
        &result.facts,
    );
    validation.observe_render(doc_id, version);
    if let Some(doc_path) = snapshot.path {
        let worker = validation.inner().clone();
        let window_for_emit = window.clone();
        let initial_diagnostics = result.diagnostics.clone();
        tauri::async_runtime::spawn(async move {
            match worker
                .validate_current(doc_id, version, doc_path, markdown, initial_diagnostics)
                .await
            {
                Ok(Some(diagnostics)) => {
                    let _ = window_for_emit.emit("pmd://diagnostics-enriched", diagnostics);
                }
                Ok(None) => {}
                Err(error) => {
                    eprintln!(
                        "[btr-md] async validation failed for doc {doc_id} v{version}: {error}"
                    );
                }
            }
        });
    }
    Ok(result)
}

#[doc(hidden)]
pub async fn render_cmd_for_test(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    markdown: String,
) -> Result<RenderResult, String> {
    render_cmd_for_test_with_options(doc_id, version, doc_path, markdown, false).await
}

#[doc(hidden)]
pub async fn render_cmd_for_test_with_options(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    markdown: String,
    allow_document_styles: bool,
) -> Result<RenderResult, String> {
    let allowed_roots = match doc_path.and_then(|path| path.parent()) {
        Some(parent) => vec![parent
            .canonicalize()
            .map_err(|e| format!("Document parent directory is unavailable: {e}"))?],
        None => Vec::new(),
    };
    render_preview_with_options(
        doc_id,
        version,
        doc_path,
        allowed_roots,
        &markdown,
        PreviewRenderOptions {
            allow_document_styles,
        },
    )
}

#[doc(hidden)]
pub async fn render_cmd_for_test_with_links(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    markdown: String,
    links: &crate::preview::link_activation::LinkActivationStore,
) -> Result<RenderResult, String> {
    let result = render_cmd_for_test(doc_id, version, doc_path, markdown).await?;
    links.record_render_links(result.doc_id, result.version, doc_path, &result.facts);
    Ok(result)
}
