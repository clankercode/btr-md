//! The per-document registry: the in-process source of truth for every open
//! document's [`FileState`], merge ancestor (`base_content`), and path.
//!
//! This replaces the old single `AppState::current_path`. It is keyed by
//! [`DocId`] so Phase 2 (multi-tab) can hold many documents at once; Phase 1
//! uses it for one active document at a time.
//!
//! # Save authority
//!
//! Exactly one document is the *active* one ([`DocRegistry::active`]). The save
//! command authorises writes against `active` (plus path + scope checks) — a
//! background document can never be written. `set_active` is called on every
//! tab activation. This is the single, type-backed expression of the old
//! "write only to the active file" invariant.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::doc::race::{self, RaceEvent};
use crate::doc::state::{Digest, DocEvent, DocId, FileState};

/// One open document's bookkeeping. `base_content` is the last-loaded /
/// last-saved text — the merge ancestor. We deliberately do **not** store the
/// live buffer text here; commands that need it (save, merge) carry it in their
/// payload, and edit tracking only needs the digest.
#[derive(Clone, Debug)]
pub struct DocEntry {
    pub state: FileState,
    pub base_content: String,
    pub path: Option<PathBuf>,
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
    active: Mutex<Option<DocId>>,
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
            active: Mutex::new(None),
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
    pub fn register(&self, path: Option<PathBuf>, contents: String) -> (DocId, FileState) {
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
        };
        self.lock().insert(id, entry);
        (id, state)
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
        if matches!(entry.state, crate::doc::state::FileState::DiskChangedClean { .. }) {
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
        // If we dropped the active doc, clear the active slot.
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        if *active == Some(doc) {
            *active = None;
        }
        removed
    }

    // --- active-doc save authority ---

    pub fn set_active(&self, doc: DocId) {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        *active = Some(doc);
    }

    pub fn clear_active(&self) {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        *active = None;
    }

    pub fn active(&self) -> Option<DocId> {
        *self.active.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn is_active(&self, doc: DocId) -> bool {
        self.active() == Some(doc)
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
}
