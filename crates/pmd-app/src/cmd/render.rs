use std::path::Path;

use crate::preview::contracts::RenderResult;
use crate::preview::render_pipeline::render_preview;
use crate::AppState;

#[tauri::command]
pub async fn render_cmd(
    state: tauri::State<'_, AppState>,
    doc_id: u64,
    version: u64,
    markdown: String,
) -> Result<RenderResult, String> {
    let snapshot = state.docs.preview_snapshot(doc_id)?;
    render_preview(
        snapshot.doc_id,
        version,
        snapshot.path.as_deref(),
        snapshot.allowed_roots,
        &markdown,
    )
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
