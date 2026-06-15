//! Document-lifecycle commands (Phase 1).
//!
//! These drive the [`crate::doc::registry::DocRegistry`] state machine:
//! registering documents, recording edits, saving (with `active`-doc authority),
//! reloading, and 3-way merging. The merge/reload commands carry full text
//! (digests alone are insufficient to reconstruct a buffer), per the review
//! finding folded into the plan.

use serde::Serialize;
use std::path::PathBuf;

use crate::doc::merge::three_way;
use crate::doc::state::{Digest, DocId, FileState};
use crate::preview::trust_roots::DocumentTrustContextForUi;
use crate::state::settings;

#[derive(Serialize)]
pub struct RegisteredDoc {
    pub doc_id: DocId,
    pub state: FileState,
    pub trust_context: DocumentTrustContextForUi,
}

/// Register a brand-new (untitled, `path = None`) or content-supplied document.
/// Untitled buffers need no scope admission; a `Some(path)` must already be
/// scope-admitted (it came from a trusted open). Makes the new doc active.
#[tauri::command]
pub fn register_doc(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    path: Option<PathBuf>,
    contents: String,
) -> Result<RegisteredDoc, String> {
    let canon = match path {
        None => None,
        Some(p) => {
            let canon =
                crate::path_scope::PathScope::canonicalise(&p).map_err(|e| e.to_string())?;
            if !state.scope.check_canonical(&canon) {
                return Err(format!(
                    "register_doc: path not in scope: {}",
                    canon.display()
                ));
            }
            Some(canon)
        }
    };

    let (doc_id, fstate) = state.docs.register(window.label(), canon.clone(), contents);
    state.docs.set_active(window.label(), doc_id);
    let trust_context = if let Some(canon) = canon {
        state.watcher.set_target(app.clone(), doc_id, canon.clone());
        crate::preview::trust_roots::apply_remembered_trust_for_document_global(
            window.label(),
            doc_id,
            &canon,
        )?
        .trust_context
    } else {
        DocumentTrustContextForUi::default()
    };
    Ok(RegisteredDoc {
        doc_id,
        state: fstate,
        trust_context,
    })
}

/// Mark a document active (the save-authority target). Called on every tab
/// activation (Phase 2) and after opening/creating a document (Phase 1).
#[tauri::command]
pub fn set_active_doc(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    doc_id: DocId,
) -> Result<(), String> {
    if !state.docs.contains(doc_id) {
        return Err(format!("set_active_doc: unknown doc {}", doc_id.0));
    }
    if !state.docs.owns(window.label(), doc_id) {
        return Err(format!(
            "set_active_doc: doc {} not owned by {}",
            doc_id.0,
            window.label()
        ));
    }
    state.docs.set_active(window.label(), doc_id);
    Ok(())
}

/// Record an edit. Carries the buffer text (the backend is the single source of
/// truth for digests; debounced full-text IPC is negligible for markdown).
/// Returns the new state so the UI can update the Save button etc.
#[tauri::command]
pub fn doc_edited(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    doc_id: DocId,
    contents: String,
) -> Result<FileState, String> {
    if !state.docs.owns(window.label(), doc_id) {
        return Err(format!(
            "doc_edited: doc {} not owned by {}",
            doc_id.0,
            window.label()
        ));
    }
    state
        .docs
        .edited(doc_id, &contents)
        .ok_or_else(|| format!("doc_edited: unknown doc {}", doc_id.0))
}

/// Save a document. `path` is set only for save-as (a target just admitted via
/// `save_dialog`). Authorises against the **active** doc + scope, reuses
/// `write_no_follow` (O_NOFOLLOW + fsync), and reconciles the state machine.
#[tauri::command]
pub async fn save_doc(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: DocId,
    contents: String,
    path: Option<PathBuf>,
) -> Result<FileState, String> {
    // Save authority: only the owning window's active document may be written.
    if !state.docs.is_active(window.label(), doc_id) {
        return Err(format!(
            "save_doc refuses doc {}: not the active document for {}",
            doc_id.0,
            window.label()
        ));
    }

    // Resolve (and, for save-as, bind) the target path.
    let canon = match path {
        Some(p) => {
            let canon =
                crate::path_scope::PathScope::canonicalise(&p).map_err(|e| e.to_string())?;
            if !state.scope.check_canonical(&canon) {
                return Err("save_doc: save-as target not in scope".into());
            }
            state.docs.set_path(doc_id, canon.clone());
            state.watcher.set_target(app.clone(), doc_id, canon.clone());
            canon
        }
        None => state
            .docs
            .path_of(doc_id)
            .ok_or("save_doc: document has no path (use save-as)")?,
    };

    if !state.scope.check_canonical(&canon) {
        return Err("save_doc: path not in active scope".into());
    }

    // Atomically guard + begin the save transition under one registry lock.
    // Refuses `DiskChangedClean` (unacknowledged external change that would
    // be silently overwritten); the check and the `SaveStarted` transition are
    // indivisible so a concurrent watcher event cannot slip between them.
    // `DiskChangedDirty` is intentionally permitted — the user has local edits
    // they want to keep, and the backend is aware of the disk conflict.
    state
        .docs
        .begin_save_if_permitted(doc_id, &contents)
        .ok_or_else(|| format!("save_doc: doc {} vanished", doc_id.0))?
        .map_err(|_| {
            "save_doc: disk has changed since last load — reload or merge before saving".to_string()
        })?;

    match crate::cmd::file::write_no_follow(&canon, contents.as_bytes()) {
        Ok(()) => {
            let new_state = state
                .docs
                .save_succeeded(doc_id, contents)
                .ok_or_else(|| format!("save_doc: doc {} vanished mid-save", doc_id.0))?;
            // Ensure we're watching the (possibly newly-bound) target.
            state.watcher.set_target(app.clone(), doc_id, canon.clone());
            validation.invalidate_for_save(&canon).await;
            Ok(new_state)
        }
        Err(e) => {
            let _ = state.docs.save_failed(doc_id);
            Err(e.to_string())
        }
    }
}

#[derive(Serialize)]
pub struct PullResult {
    pub contents: String,
    pub state: FileState,
}

/// Reload the document from disk (Reload button / take-disk). Discards local
/// edits: buffer := disk, base := disk -> Clean.
#[tauri::command]
pub async fn pull_from_disk(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: DocId,
) -> Result<PullResult, String> {
    if !state.docs.owns(window.label(), doc_id) {
        return Err(format!(
            "pull_from_disk: doc {} not owned by {}",
            doc_id.0,
            window.label()
        ));
    }
    let canon = doc_path_in_scope(&state, doc_id)?;
    let disk = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    let new_state = state
        .docs
        .synced_from_disk(doc_id, disk.clone(), &disk)
        .ok_or_else(|| format!("pull_from_disk: unknown doc {}", doc_id.0))?;
    validation.invalidate_for_reload(doc_id.0).await;
    Ok(PullResult {
        contents: disk,
        state: new_state,
    })
}

#[derive(Serialize)]
pub struct ResolveResult {
    pub merged: String,
    pub state: FileState,
    pub conflicted: bool,
}

/// Run a 3-way merge of the buffer against the current disk version using the
/// configured [`crate::doc::modes::MergeStrategy`]. **Applies to memory only —
/// never writes.** `disk_digest_seen` is the digest the UI observed in its
/// DiskChanged* state; if the disk has moved again the race seam (Defer) lets
/// us proceed against the current disk content.
#[tauri::command]
pub fn resolve_disk_change(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    doc_id: DocId,
    ours_text: String,
    disk_digest_seen: String,
) -> Result<ResolveResult, String> {
    if !state.docs.owns(window.label(), doc_id) {
        return Err(format!(
            "resolve_disk_change: doc {} not owned by {}",
            doc_id.0,
            window.label()
        ));
    }
    let canon = doc_path_in_scope(&state, doc_id)?;
    let disk = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;

    if Digest::of(&disk).to_hex() != disk_digest_seen {
        eprintln!(
            "[btr-md] resolve_disk_change: disk moved since the UI observed it (doc {}); \
             merging against current disk (race: defer)",
            doc_id.0
        );
    }

    let base = state
        .docs
        .base_content_of(doc_id)
        .ok_or_else(|| format!("resolve_disk_change: unknown doc {}", doc_id.0))?;

    let strat = settings::load().merge_strategy;
    let outcome = three_way(&base, &ours_text, &disk, strat);
    let merged = outcome.text().to_string();
    let conflicted = outcome.is_conflicted();

    let new_state = state
        .docs
        .synced_from_disk(doc_id, disk, &merged)
        .ok_or_else(|| format!("resolve_disk_change: doc {} vanished", doc_id.0))?;

    Ok(ResolveResult {
        merged,
        state: new_state,
        conflicted,
    })
}

/// Close a document: drop its registry entry and stop watching it.
#[tauri::command]
pub fn drop_doc(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    doc_id: DocId,
) -> Result<(), String> {
    if !state.docs.owns(window.label(), doc_id) {
        return Err(format!(
            "drop_doc: doc {} not owned by {}",
            doc_id.0,
            window.label()
        ));
    }
    crate::preview::grants::revoke_grants_for_doc(doc_id)?;
    state.watcher.clear(doc_id);
    state.docs.drop_doc(doc_id);
    Ok(())
}

/// Resolve a document's canonical path and verify it is still in scope.
fn doc_path_in_scope(state: &crate::AppState, doc_id: DocId) -> Result<PathBuf, String> {
    let path = state
        .docs
        .path_of(doc_id)
        .ok_or_else(|| format!("doc {} has no path", doc_id.0))?;
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    if !state.scope.check_canonical(&canon) {
        return Err(format!("doc {} path not in scope", doc_id.0));
    }
    Ok(canon)
}
