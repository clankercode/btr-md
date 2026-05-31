use std::path::Path;

use crate::preview::contracts::RenderResult;
use crate::preview::render_pipeline::render_preview;
use crate::AppState;

#[tauri::command]
pub async fn render_cmd(
    state: tauri::State<'_, AppState>,
    links: tauri::State<'_, crate::preview::link_activation::LinkActivationStore>,
    doc_id: u64,
    version: u64,
    markdown: String,
) -> Result<RenderResult, String> {
    let snapshot = state.docs.preview_snapshot(doc_id)?;
    let result = render_preview(
        snapshot.doc_id,
        version,
        snapshot.path.as_deref(),
        snapshot.allowed_roots,
        &markdown,
    )?;
    links.record_render_links(
        result.doc_id,
        result.version,
        snapshot.path.as_deref(),
        &result.facts,
    );
    Ok(result)
}

#[doc(hidden)]
pub async fn render_cmd_for_test(
    doc_id: u64,
    version: u64,
    doc_path: Option<&Path>,
    markdown: String,
) -> Result<RenderResult, String> {
    let allowed_roots = match doc_path.and_then(|path| path.parent()) {
        Some(parent) => vec![parent
            .canonicalize()
            .map_err(|e| format!("Document parent directory is unavailable: {e}"))?],
        None => Vec::new(),
    };
    render_preview(doc_id, version, doc_path, allowed_roots, &markdown)
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
