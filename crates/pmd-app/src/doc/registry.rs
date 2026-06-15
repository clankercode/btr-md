//! The per-document registry: the in-process source of truth for every open
//! document's [`FileState`], merge ancestor (`base_content`), and path.
//!
//! This replaces the old single `AppState::current_path`. It is keyed by
//! [`DocId`] so Phase 2 (multi-tab) can hold many documents at once; Phase 1
//! uses it for one active document at a time.
//!
//! # Save authority
//!
//! Each document is *owned* by exactly one window (`owner_window`), and each
//! window has its own *active* document (the `active` map, keyed by window
//! label). The save command authorises writes against the calling window's
//! active slot — `is_active(window.label(), doc)` — plus path + scope checks.
//! It does not call `owns` directly; it relies on the load-bearing invariant
//! **active ⊆ owns**: a window's active slot is only ever set to a doc it owns,
//! because every `set_active(window, doc)` call site passes the owning window's
//! label (and `set_active_doc` rejects non-owners). So "active for this window"
//! implies "owned by this window", and a background doc — or one owned by
//! another window — can never be written. The other doc-mutating commands
//! (`set_active_doc`, `doc_edited`, `pull_from_disk`, `resolve_disk_change`,
//! `drop_doc`) gate on `owns` explicitly. This is the type-backed expression of
//! the per-window "write only to the active file you own" invariant.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::doc::race::{self, RaceEvent};
use crate::doc::state::{Digest, DocEvent, DocId, FileState};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewDocumentSnapshot {
    pub doc_id: u64,
    pub path: Option<PathBuf>,
    pub allowed_roots: Vec<PathBuf>,
}

/// One open document's bookkeeping. `base_content` is the last-loaded /
/// last-saved text — the merge ancestor. We deliberately do **not** store the
/// live buffer text here; commands that need it (save, merge) carry it in their
/// payload, and edit tracking only needs the digest.
#[derive(Clone, Debug)]
pub struct DocEntry {
    pub state: FileState,
    pub base_content: String,
    pub path: Option<PathBuf>,
    pub owner_window: String,
}

/// A disk change observed by the watcher.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DiskEvent {
    Modified(Digest),
    Created(Digest),
    Removed,
}

pub struct DocRegistry {
    docs: Mutex<HashMap<DocId, DocEntry>>,
    next_id: AtomicU64,
    active: Mutex<HashMap<String, DocId>>,
}

impl Default for DocRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl DocRegistry {
    pub fn new() -> Self {
        Self {
            docs: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<DocId, DocEntry>> {
        self.docs.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn mint_id(&self) -> DocId {
        DocId(self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    /// Register a freshly-opened (`path = Some`) or brand-new (`path = None`,
    /// untitled) document. Returns its id and initial state.
    pub fn register(
        &self,
        owner: &str,
        path: Option<PathBuf>,
        contents: String,
    ) -> (DocId, FileState) {
        let id = self.mint_id();
        let state = match &path {
            Some(_) => FileState::Clean {
                base: Digest::of(&contents),
            },
            None => FileState::Untitled,
        };
        let entry = DocEntry {
            state: state.clone(),
            base_content: contents,
            path,
            owner_window: owner.to_string(),
        };
        self.lock().insert(id, entry);
        (id, state)
    }

    /// Register a document being restored from a persisted session with an
    /// **explicit** state and merge-ancestor text. Unlike [`register`] (which
    /// only ever yields `Clean`/`Untitled`), this admits a doc already in a
    /// `Dirty` / `DiskChangedDirty` state so a saved-dirty session entry can be
    /// reconstructed authoritatively — `base_content` is the ancestor text the
    /// 3-way merge needs, not a hash. The only restore-specific registry API.
    pub fn register_restored(
        &self,
        owner: &str,
        path: PathBuf,
        base_content: String,
        state: FileState,
    ) -> DocId {
        let id = self.mint_id();
        let entry = DocEntry {
            state,
            base_content,
            path: Some(path),
            owner_window: owner.to_string(),
        };
        self.lock().insert(id, entry);
        id
    }

    /// Mutate one document's state via `f`, returning the new state (cloned).
    /// `None` if the document is not registered.
    fn transition<F>(&self, doc: DocId, f: F) -> Option<FileState>
    where
        F: FnOnce(&mut DocEntry),
    {
        let mut docs = self.lock();
        let entry = docs.get_mut(&doc)?;
        f(entry);
        Some(entry.state.clone())
    }

    /// Apply an edit: the buffer is now `contents`. Base is unchanged.
    pub fn edited(&self, doc: DocId, contents: &str) -> Option<FileState> {
        let mem = Digest::of(contents);
        self.transition(doc, |e| {
            e.state = e.state.clone().apply(DocEvent::Edited { mem });
        })
    }

    /// Record that a save of `contents` has begun.
    pub fn save_started(&self, doc: DocId, contents: &str) -> Option<FileState> {
        let target = Digest::of(contents);
        self.transition(doc, |e| {
            e.state = e.state.clone().apply(DocEvent::SaveStarted { target });
        })
    }

    /// Atomically check that the document state permits a save, then record
    /// the save-in-progress transition. Returns `Err` (with the current state)
    /// if the document is in `DiskChangedClean` (an unacknowledged disk change
    /// that would be silently overwritten), or `None` if the document does not
    /// exist. The check-and-transition are done under the same lock acquisition,
    /// so a concurrent watcher event cannot slip between them.
    pub fn begin_save_if_permitted(
        &self,
        doc: DocId,
        contents: &str,
    ) -> Option<Result<FileState, FileState>> {
        let target = Digest::of(contents);
        let mut docs = self.lock();
        let entry = docs.get_mut(&doc)?;
        if matches!(
            entry.state,
            crate::doc::state::FileState::DiskChangedClean { .. }
        ) {
            return Some(Err(entry.state.clone()));
        }
        entry.state = entry.state.clone().apply(DocEvent::SaveStarted { target });
        Some(Ok(entry.state.clone()))
    }

    /// Record a successful save. `base_content` advances to the saved text.
    pub fn save_succeeded(&self, doc: DocId, contents: String) -> Option<FileState> {
        self.transition(doc, |e| {
            e.base_content = contents;
            e.state = e.state.clone().apply(DocEvent::SaveSucceeded);
        })
    }

    /// Record a failed save (the buffer/base are unchanged on disk).
    pub fn save_failed(&self, doc: DocId) -> Option<FileState> {
        self.transition(doc, |e| {
            e.state = e.state.clone().apply(DocEvent::SaveFailed);
        })
    }

    /// Set the document's path (after a save-as picked a target).
    pub fn set_path(&self, doc: DocId, path: PathBuf) -> Option<()> {
        let mut docs = self.lock();
        let entry = docs.get_mut(&doc)?;
        entry.path = Some(path);
        Some(())
    }

    /// Apply a watcher-observed disk event. Mid-save disk events are routed
    /// through the race seam (logged); the state machine waits for the save to
    /// resolve. Self-writes (disk digest == in-flight target) are recognised
    /// and not treated as external races.
    pub fn on_disk_event(&self, doc: DocId, ev: DiskEvent) -> Option<FileState> {
        self.transition(doc, |e| {
            // Race detection while a save is outstanding.
            if let FileState::SaveInProgress { target, .. } = e.state {
                match ev {
                    DiskEvent::Modified(disk) | DiskEvent::Created(disk) if disk != target => {
                        let _ = race::handle(
                            crate::doc::modes::RacePolicy::Defer,
                            RaceEvent::ExternalWriteDuringSave { doc, disk },
                        );
                    }
                    DiskEvent::Removed => {
                        let _ = race::handle(
                            crate::doc::modes::RacePolicy::Defer,
                            RaceEvent::ExternalRemoveDuringSave { doc },
                        );
                    }
                    // Self-write (disk == target): not a race.
                    DiskEvent::Modified(_) | DiskEvent::Created(_) => {}
                }
            }
            let event = match ev {
                DiskEvent::Modified(disk) => DocEvent::DiskModified { disk },
                DiskEvent::Created(disk) => DocEvent::DiskCreated { disk },
                DiskEvent::Removed => DocEvent::DiskRemoved,
            };
            e.state = e.state.clone().apply(event);
        })
    }

    /// Apply a reconciliation with disk (reload or merge-apply): the ancestor
    /// advances to `disk_content`; the buffer becomes `mem`.
    pub fn synced_from_disk(
        &self,
        doc: DocId,
        disk_content: String,
        mem: &str,
    ) -> Option<FileState> {
        let disk = Digest::of(&disk_content);
        let mem = Digest::of(mem);
        self.transition(doc, |e| {
            e.base_content = disk_content;
            e.state = e
                .state
                .clone()
                .apply(DocEvent::SyncedFromDisk { disk, mem });
        })
    }

    pub fn drop_doc(&self, doc: DocId) -> Option<DocEntry> {
        let removed = self.lock().remove(&doc);
        // Clear the dropped doc from every window's active slot.
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        active.retain(|_, &mut d| d != doc);
        removed
    }

    // --- per-window active-doc save authority ---

    pub fn set_active(&self, window: &str, doc: DocId) {
        self.active
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(window.to_string(), doc);
    }

    pub fn clear_active(&self, window: &str) {
        self.active
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(window);
    }

    pub fn active_for(&self, window: &str) -> Option<DocId> {
        self.active
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(window)
            .copied()
    }

    pub fn is_active(&self, window: &str, doc: DocId) -> bool {
        self.active_for(window) == Some(doc)
    }

    // --- per-window ownership ---

    pub fn owner_of(&self, doc: DocId) -> Option<String> {
        self.lock().get(&doc).map(|e| e.owner_window.clone())
    }

    pub fn owns(&self, window: &str, doc: DocId) -> bool {
        self.owner_of(doc).as_deref() == Some(window)
    }

    pub fn find_by_path(&self, path: &std::path::Path) -> Option<(DocId, String)> {
        self.lock()
            .iter()
            .find(|(_, e)| e.path.as_deref() == Some(path))
            .map(|(id, e)| (*id, e.owner_window.clone()))
    }

    // --- snapshot accessors for the command layer ---

    pub fn path_of(&self, doc: DocId) -> Option<PathBuf> {
        self.lock().get(&doc).and_then(|e| e.path.clone())
    }

    pub fn base_content_of(&self, doc: DocId) -> Option<String> {
        self.lock().get(&doc).map(|e| e.base_content.clone())
    }

    pub fn state_of(&self, doc: DocId) -> Option<FileState> {
        self.lock().get(&doc).map(|e| e.state.clone())
    }

    pub fn contains(&self, doc: DocId) -> bool {
        self.lock().contains_key(&doc)
    }

    pub fn preview_snapshot(&self, doc_id: u64) -> Result<PreviewDocumentSnapshot, String> {
        let doc_id = DocId(doc_id);
        let docs = self.lock();
        let doc = docs
            .get(&doc_id)
            .ok_or_else(|| "Unknown document".to_string())?;
        let path = doc.path.clone();
        let allowed_roots = match path.as_ref().and_then(|path| path.parent()) {
            Some(parent) => vec![parent
                .canonicalize()
                .map_err(|e| format!("Document parent directory is unavailable: {e}"))?],
            None => Vec::new(),
        };
        Ok(PreviewDocumentSnapshot {
            doc_id: doc_id.0,
            path,
            allowed_roots,
        })
    }
}

#[cfg(test)]
mod ownership_tests {
    use super::*;

    #[test]
    fn registered_doc_records_owner_and_per_window_active() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        let (b, _) = reg.register("w-2", None, "b".into());
        assert_eq!(reg.owner_of(a).as_deref(), Some("main"));
        assert_eq!(reg.owner_of(b).as_deref(), Some("w-2"));
        reg.set_active("main", a);
        reg.set_active("w-2", b);
        assert!(reg.is_active("main", a));
        assert!(reg.is_active("w-2", b));
        assert!(!reg.is_active("main", b));
        assert!(!reg.is_active("w-2", a));
    }

    #[test]
    fn owns_gates_cross_window_mutation() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        assert!(reg.owns("main", a));
        assert!(!reg.owns("w-2", a));
    }

    #[test]
    fn drop_clears_active_for_owning_window_only() {
        let reg = DocRegistry::new();
        let (a, _) = reg.register("main", None, "a".into());
        reg.set_active("main", a);
        reg.drop_doc(a);
        assert!(!reg.is_active("main", a));
        assert!(reg.active_for("main").is_none());
    }

    #[test]
    fn find_by_path_returns_doc_and_owner() {
        let reg = DocRegistry::new();
        let p = std::path::PathBuf::from("/tmp/x.md");
        let id = reg.register_restored(
            "w-2",
            p.clone(),
            "base".into(),
            FileState::Clean {
                base: Digest::of("base"),
            },
        );
        assert_eq!(reg.find_by_path(&p), Some((id, "w-2".to_string())));
        assert_eq!(reg.find_by_path(std::path::Path::new("/tmp/none.md")), None);
    }
}
