use anyhow::Result;
use pmd_core::emit::{render_string, RenderResult};

#[tauri::command]
pub async fn render_cmd(version: u64, markdown: String) -> Result<RenderResult, String> {
    let mut r = render_string(&markdown);
    r.version = version;
    Ok(r)
}
