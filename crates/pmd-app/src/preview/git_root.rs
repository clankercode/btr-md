use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DocumentTrustContext {
    pub doc_dir: PathBuf,
    pub git_root: Option<PathBuf>,
}

pub fn discover_document_trust_context(doc_path: &Path) -> Result<DocumentTrustContext, String> {
    let canonical_doc = doc_path.canonicalize().map_err(|err| err.to_string())?;
    let doc_dir = canonical_doc
        .parent()
        .ok_or_else(|| "Markdown file has no parent directory".to_string())?
        .to_path_buf();
    let git_root = find_git_root(&doc_dir)?;
    Ok(DocumentTrustContext { doc_dir, git_root })
}

pub fn find_git_root(start: &Path) -> Result<Option<PathBuf>, String> {
    let mut cursor = start.canonicalize().map_err(|err| err.to_string())?;
    loop {
        let marker = cursor.join(".git");
        if marker.is_dir() || marker.is_file() {
            return Ok(Some(cursor));
        }
        if !cursor.pop() {
            return Ok(None);
        }
    }
}
