use std::path::{Path, PathBuf};

use crate::path_scope::is_within;

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

/// Preferred sidebar workspace base for a document, in priority order:
/// 1. Git worktree / repo root (nearest `.git` directory or file marker)
/// 2. User home, if the document lives under `$HOME`
/// 3. The document's parent directory
///
/// Does not consult path grants — callers that need a *listable* root must
/// intersect this with admitted directories (see
/// [`crate::cmd::browse::resolve_document_workspace_root`]).
pub fn resolve_document_base(doc_path: &Path) -> Result<PathBuf, String> {
    let canon = doc_path.canonicalize().map_err(|err| err.to_string())?;
    let parent = canon
        .parent()
        .ok_or_else(|| "document has no parent directory".to_string())?
        .to_path_buf();

    // Priority 1–2: git worktree root (`.git` file) or repo root (`.git` dir).
    // Linked worktrees expose a `.git` *file* at the worktree root; walking up
    // finds that first, which is the correct sidebar base (not the main repo).
    if let Some(git_root) = find_git_root(&parent)? {
        return Ok(git_root);
    }

    // Priority 3: user home when the document is under it.
    if let Some(home) = user_home_dir() {
        if is_within(&home, &canon) {
            return Ok(home);
        }
    }

    // Priority 4: document's local directory.
    Ok(parent)
}

fn user_home_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    home.canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_doc(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, "# Doc\n").unwrap();
    }

    #[test]
    fn resolve_document_base_prefers_git_root_over_home_and_parent() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        let docs = repo.join("docs");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let doc = docs.join("readme.md");
        write_doc(&doc);

        let base = resolve_document_base(&doc).unwrap();
        assert_eq!(base, repo.canonicalize().unwrap());
    }

    #[test]
    fn resolve_document_base_uses_worktree_root_for_git_file_marker() {
        let temp = tempfile::tempdir().unwrap();
        let worktree = temp.path().join("wt");
        let docs = worktree.join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(worktree.join(".git"), "gitdir: ../.git/worktrees/feature\n").unwrap();
        let doc = docs.join("notes.md");
        write_doc(&doc);

        let base = resolve_document_base(&doc).unwrap();
        assert_eq!(base, worktree.canonicalize().unwrap());
    }

    #[test]
    fn resolve_document_base_falls_back_to_parent_outside_home_without_git() {
        // Prefer /var/tmp: some environments have a stray `/tmp/.git`, which would
        // make any under-/tmp path look like a git worktree.
        let temp = tempfile::TempDir::new_in("/var/tmp")
            .or_else(|_| tempfile::tempdir())
            .unwrap();
        let dir = temp.path().join("scratch");
        let doc = dir.join("solo.md");
        write_doc(&doc);

        // Skip if an ambient .git sits on an ancestor (cannot test parent-only).
        let mut cursor = dir.canonicalize().unwrap();
        let ambient_git = loop {
            if cursor.join(".git").exists() {
                break true;
            }
            if !cursor.pop() {
                break false;
            }
        };
        if ambient_git {
            return;
        }

        let base = resolve_document_base(&doc).unwrap();
        assert_eq!(base, dir.canonicalize().unwrap());
    }
}
