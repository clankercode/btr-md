//! Session persistence commands: the backend is the source of truth for the
//! full editing session (open files, untitled docs, and unsaved buffers).
//!
//! # Ownership split (see the design spec)
//!
//! The registry holds the merge-ancestor text (`base_content`) but **not** the
//! live buffer; the frontend holds the live buffer but **not** the ancestor. So
//! `save_session` takes the live `content` for every open doc and the backend
//! enriches each entry by `doc_id` lookup (`path` + `base_content`), deciding
//! clean-vs-dirty by **comparing the supplied content to `base_content`** —
//! never by reading the registry `FileState`, which only flips to `Dirty` after
//! the debounced `doc_edited` IPC lands and would race the edit pipeline.
//!
//! `restore_dirty_doc` is the inverse: it reconstructs a saved-dirty doc in the
//! registry with the correct ancestor text and the authoritative `FileState`.

use std::path::PathBuf;

use serde::Deserialize;

use crate::cmd::file::{admit_open_path, try_push_recent, OpenedDoc};
use crate::doc::state::{Digest, FileState};
use crate::state::session::{ActiveTab, Session, SessionDoc, UnsavedBuffer, SESSION_VERSION};

/// Per-doc input the frontend sends for `save_session`: the backend `doc_id`,
/// the editor `mode`, and the live buffer `content` for **every** open doc.
///
/// `rename_all = "camelCase"` is required because Tauri only camelCases the
/// top-level command arguments — fields of a *nested* struct like this are
/// deserialized as-is, so the frontend's `docId` would not map to `doc_id`
/// without it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocInput {
    pub doc_id: u64,
    pub mode: String,
    pub content: String,
}

/// Build a [`SessionDoc`] for one input by enriching it from the registry.
/// Returns `None` for unknown `doc_id`s (tab closed mid-flush) so they are
/// skipped.
fn build_session_doc(state: &crate::AppState, input: SaveDocInput) -> Option<SessionDoc> {
    let doc = crate::doc::state::DocId(input.doc_id);
    if !state.docs.contains(doc) {
        return None;
    }
    let path = state.docs.path_of(doc);
    let base_content = state.docs.base_content_of(doc)?;

    let unsaved = match &path {
        // Untitled: always persist the whole buffer, no baseline.
        None => Some(UnsavedBuffer {
            content: input.content,
            baseline_content: None,
        }),
        // Saved: dirty iff the live buffer differs from the merge ancestor.
        Some(_) => {
            if input.content == base_content {
                None // clean -> reopened from disk on restore
            } else {
                Some(UnsavedBuffer {
                    content: input.content,
                    baseline_content: Some(base_content),
                })
            }
        }
    };

    Some(SessionDoc {
        path: path.map(|p| p.to_string_lossy().into_owned()),
        mode: input.mode,
        unsaved,
    })
}

/// Persist the full session. Enriches each input by `doc_id` lookup, decides
/// clean/dirty by content comparison, and writes atomically under lock.
#[tauri::command]
pub async fn save_session(
    state: tauri::State<'_, crate::AppState>,
    docs: Vec<SaveDocInput>,
    active: Option<ActiveTab>,
    browser_tab: bool,
) -> Result<(), String> {
    let docs = docs
        .into_iter()
        .filter_map(|input| build_session_doc(&state, input))
        .collect();
    let session = Session {
        version: SESSION_VERSION,
        docs,
        active,
        browser_tab,
    };
    crate::state::session::save_session(&session).map_err(|e| e.to_string())
}

/// Read the persisted session. Missing/corrupt input yields an empty default.
#[tauri::command]
pub fn load_session() -> Session {
    crate::state::session::load_session()
}

/// Reconstruct a saved-dirty / conflict doc authoritatively from a persisted
/// session entry. Applies the same admission gates as `request_open_file`,
/// reads current disk content, recomputes the `FileState` from the three
/// digests, and registers the doc with the correct ancestor text.
#[tauri::command]
pub async fn restore_dirty_doc(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    path: PathBuf,
    content: String,
    baseline_content: String,
    background: bool,
) -> Result<OpenedDoc, String> {
    let canon = admit_open_path(&state, &path)?;
    let disk_text = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;

    let base = Digest::of(&baseline_content);
    let mem = Digest::of(&content);
    let disk = Digest::of(&disk_text);

    // disk == baseline -> only local edits (Dirty); else a true conflict.
    let fstate = if disk == base {
        FileState::Dirty { base, mem }
    } else {
        FileState::DiskChangedDirty { base, mem, disk }
    };

    let doc_id = state
        .docs
        .register_restored(canon.clone(), baseline_content, fstate.clone());

    // Honor save authority exactly like `register_opened`: a background restore
    // starts the watcher but does NOT steal active-doc save authority.
    if !background {
        state.docs.set_active(doc_id);
    }
    state.watcher.set_target(app.clone(), doc_id, canon.clone());
    try_push_recent(&canon);
    let applied = crate::preview::trust_roots::apply_remembered_trust_for_document_global(
        window.label(),
        doc_id,
        &canon,
    )?;

    Ok(OpenedDoc {
        doc_id,
        path: canon,
        // Seed the editor with the live unsaved buffer, not the disk text.
        contents: content,
        state: fstate,
        trust_context: applied.trust_context,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::config_env_lock;

    /// Build the FileState the way `restore_dirty_doc` does, for direct
    /// reconstruction assertions without spinning up a Tauri AppHandle.
    fn reconstruct(baseline: &str, content: &str, disk_text: &str) -> FileState {
        let base = Digest::of(baseline);
        let mem = Digest::of(content);
        let disk = Digest::of(disk_text);
        if disk == base {
            FileState::Dirty { base, mem }
        } else {
            FileState::DiskChangedDirty { base, mem, disk }
        }
    }

    #[test]
    fn save_doc_input_deserializes_camelcase_from_frontend() {
        // The frontend sends `docId` (Tauri does NOT camelCase nested struct
        // fields); SaveDocInput must accept it. Locks the IPC contract.
        let json = r#"{ "docId": 7, "mode": "preview", "content": "hi" }"#;
        let input: SaveDocInput = serde_json::from_str(json).expect("must accept camelCase docId");
        assert_eq!(input.doc_id, 7);
        assert_eq!(input.mode, "preview");
        assert_eq!(input.content, "hi");
        // snake_case `doc_id` must NOT be accepted (catches an accidental revert).
        assert!(serde_json::from_str::<SaveDocInput>(
            r#"{ "doc_id": 7, "mode": "p", "content": "" }"#
        )
        .is_err());
    }

    #[test]
    fn disk_equals_baseline_reconstructs_dirty() {
        let baseline = "ancestor";
        let content = "my edits";
        let st = reconstruct(baseline, content, baseline);
        assert_eq!(
            st,
            FileState::Dirty {
                base: Digest::of(baseline),
                mem: Digest::of(content),
            }
        );
    }

    #[test]
    fn disk_differs_reconstructs_disk_changed_dirty_with_correct_digests() {
        let baseline = "ancestor";
        let content = "my edits";
        let disk_text = "external change";
        let st = reconstruct(baseline, content, disk_text);
        assert_eq!(
            st,
            FileState::DiskChangedDirty {
                base: Digest::of(baseline),
                mem: Digest::of(content),
                disk: Digest::of(disk_text),
            }
        );
    }

    /// Register a restored doc into a fresh registry and confirm the ancestor
    /// text is stored verbatim (so a later 3-way merge uses the right base).
    #[test]
    fn register_restored_keeps_baseline_as_base_content() {
        let reg = crate::doc::DocRegistry::new();
        let baseline = "ancestor body".to_string();
        let st = reconstruct(&baseline, "edits", "external");
        let id = reg.register_restored(PathBuf::from("/tmp/x.md"), baseline.clone(), st.clone());
        assert_eq!(reg.base_content_of(id).as_deref(), Some(baseline.as_str()));
        assert_eq!(reg.state_of(id), Some(st));
    }

    #[test]
    fn non_admissible_path_is_rejected_and_registers_nothing() {
        let _lock = config_env_lock();
        // Fresh empty scope + a temp config home so recents is empty too.
        let dir = tempfile::tempdir().expect("temp dir");
        let prev = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", dir.path());

        let md = dir.path().join("orphan.md");
        std::fs::write(&md, "hello").expect("write md");

        let state = crate::AppState::new(None);
        // Path is not scoped, not in recents, not under an allowed dir.
        let result = admit_open_path(&state, &md);
        assert!(result.is_err(), "non-admissible path must be rejected");
        // No doc was registered (admission runs before register_restored).
        let probe = crate::doc::state::DocId(1);
        assert!(!state.docs.contains(probe));

        if let Some(prev) = prev {
            std::env::set_var("XDG_CONFIG_HOME", prev);
        } else {
            std::env::remove_var("XDG_CONFIG_HOME");
        }
    }
}
