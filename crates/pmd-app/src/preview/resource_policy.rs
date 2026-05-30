use std::path::PathBuf;

use crate::preview::contracts::{DocumentIssue, ResourcePolicyReport};

pub struct ResourcePolicyContext<'a> {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: Option<&'a std::path::Path>,
    pub markdown: &'a str,
    pub rendered_html: &'a str,
    pub allowed_roots: Vec<PathBuf>,
}

pub struct ResourcePolicyResolution {
    pub safe_html: String,
    pub report: ResourcePolicyReport,
    pub issues: Vec<DocumentIssue>,
}

pub fn resolve_resources(
    context: ResourcePolicyContext<'_>,
) -> Result<ResourcePolicyResolution, String> {
    let _ = context.doc_path;
    let _ = context.markdown;
    let mut report = ResourcePolicyReport::empty(context.doc_id, context.version);
    report.allowed_roots = context
        .allowed_roots
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    Ok(ResourcePolicyResolution {
        safe_html: context.rendered_html.to_string(),
        report,
        issues: Vec::new(),
    })
}
