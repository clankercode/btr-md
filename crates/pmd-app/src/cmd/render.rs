use anyhow::Result;
use pmd_core::emit::RenderResult;
use pmd_core::incremental::render_incremental;

#[tauri::command]
pub async fn render_cmd(version: u64, markdown: String) -> Result<RenderResult, String> {
    let mut r = render_incremental(&markdown);
    r.version = version;
    Ok(r)
}
