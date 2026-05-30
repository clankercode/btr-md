use std::path::Path;

use pmd_core::incremental::render_incremental;

use crate::preview::contracts::RenderResult;
use crate::preview::resource_policy::{resolve_resources, ResourcePolicyContext};

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
        rendered_html: &core.html,
        allowed_roots,
    })?;
    Ok(RenderResult::from_core_and_policy(
        doc_id, version, core, policy,
    ))
}
