//! Per-document file watching.
//!
//! [`WatcherSet`] holds at most one `notify` watcher per open [`DocId`], so
//! background tabs detect disk changes too (Phase 2). Each worker thread is
//! *content-aware*: on an inotify burst it coalesces, re-reads and blake3-hashes
//! the file itself, drives the [`DocRegistry`] state machine, and emits a single
//! structured `doc_state_changed` event ({ doc_id, state }). This removes the
//! old "emit a path, make the renderer re-read" round trip and makes external
//! vs self writes distinguishable by digest.
//!
//! Self-write suppression falls out of being content-aware: after our own save
//! the on-disk digest equals the document's `base`, so the `DiskModified`
//! transition collapses back to `Clean` instead of spuriously flagging an
//! external change (and mid-save self-writes are recognised in
//! [`DocRegistry::on_disk_event`]).
//!
//! Switching a slot drops the previous `RecommendedWatcher` (closing its event
//! channel); the previous worker observes the closed channel and exits, so
//! stale events cannot fire after a swap.

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::doc::registry::DiskEvent;
use crate::doc::state::{Digest, DocId, FileState};
use crate::workspace_ignore::all_paths_ignored;

/// Coalescing window for inotify bursts (atomic-replace saves fire several
/// events in quick succession; we only want to hash once).
const COALESCE_MS: u64 = 40;

/// The `doc_state_changed` event payload.
#[derive(Clone, Serialize)]
struct DocStateChanged {
    doc_id: DocId,
    state: FileState,
}

pub struct WatcherSet {
    slots: Mutex<HashMap<DocId, WatcherSlot>>,
}

struct WatcherSlot {
    _watcher: RecommendedWatcher,
    path: PathBuf,
}

impl Default for WatcherSet {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherSet {
    pub fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<DocId, WatcherSlot>> {
        self.slots.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Watch `path` on behalf of `doc`, replacing any previous slot for it.
    pub fn set_target<R: Runtime>(&self, app: AppHandle<R>, doc: DocId, path: PathBuf) {
        let mut slots = self.lock();
        slots.remove(&doc); // drop old watcher first so its worker exits
        if let Some(slot) = build_slot(app, doc, &path) {
            slots.insert(doc, slot);
        }
    }

    /// Stop watching for `doc` (e.g. it became untitled or was closed).
    pub fn clear(&self, doc: DocId) {
        self.lock().remove(&doc);
    }

    pub fn clear_all(&self) {
        self.lock().clear();
    }

    /// Path currently watched for `doc`, if any. Used by tests/diagnostics.
    pub fn watched(&self, doc: DocId) -> Option<PathBuf> {
        self.lock().get(&doc).map(|s| s.path.clone())
    }
}

/// Read and hash a file. `None` if it cannot be read as UTF-8 right now (e.g.
/// it vanished mid-rename) — the caller treats that as "no usable digest".
fn hash_file(path: &Path) -> Option<Digest> {
    std::fs::read_to_string(path).ok().map(|s| Digest::of(&s))
}

fn build_slot<R: Runtime>(app: AppHandle<R>, doc: DocId, path: &Path) -> Option<WatcherSlot> {
    let parent = path.parent()?.to_path_buf();
    let file_name = path.file_name()?.to_owned();
    let watched_path = path.to_path_buf();

    let (tx, rx) = channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .ok()?;

    watcher.watch(&parent, RecursiveMode::NonRecursive).ok()?;

    let worker_app = app.clone();
    let worker_path = watched_path.clone();

    std::thread::spawn(move || {
        // Block for the first relevant event, then coalesce the inotify burst
        // before doing a single read+hash+transition+emit.
        while let Ok(res) = rx.recv() {
            let Ok(event) = res else { continue };
            if !touches(&event, &file_name) {
                continue;
            }
            let mut saw_create = matches!(event.kind, EventKind::Create(_));
            let mut saw_remove = matches!(event.kind, EventKind::Remove(_));

            // Drain the rest of the burst.
            loop {
                match rx.recv_timeout(Duration::from_millis(COALESCE_MS)) {
                    Ok(Ok(ev)) if touches(&ev, &file_name) => {
                        if matches!(ev.kind, EventKind::Create(_)) {
                            saw_create = true;
                        }
                        if matches!(ev.kind, EventKind::Remove(_)) {
                            saw_remove = true;
                        }
                    }
                    Ok(_) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            // Decide the actual current state of the file by inspecting it.
            let disk_event = if worker_path.exists() {
                match hash_file(&worker_path) {
                    Some(digest) if saw_create && !saw_remove => DiskEvent::Created(digest),
                    Some(digest) => DiskEvent::Modified(digest),
                    None => continue, // unreadable right now; wait for the next event
                }
            } else {
                DiskEvent::Removed
            };

            if let Some(validation) =
                worker_app.try_state::<crate::preview::render_pipeline::ValidationWorker>()
            {
                validation.invalidate_for_watcher_change(worker_path.clone());
            }

            let state = worker_app.state::<crate::AppState>();
            if let Some(new_state) = state.docs.on_disk_event(doc, disk_event) {
                // Global emit is effectively window-scoped: a doc is owned by
                // exactly one window, and each frontend's `doc_state_changed`
                // handler no-ops for docs absent from its own tab store
                // (`setStateByDocId`), so only the owning window reacts. This
                // avoids needing a live window handle (which may not exist yet,
                // e.g. during startup or in tests).
                let _ = worker_app.emit(
                    "doc_state_changed",
                    DocStateChanged {
                        doc_id: doc,
                        state: new_state,
                    },
                );
            }
        }
    });

    Some(WatcherSlot {
        _watcher: watcher,
        path: watched_path,
    })
}

fn touches(event: &notify::Event, file_name: &std::ffi::OsStr) -> bool {
    event.paths.iter().any(|p| p.file_name() == Some(file_name))
}

// ---------------------------------------------------------------------------
// Workspace tree watcher (sidebar / folder browser).
//
// Separate from the per-document content watcher above: this watches the UI
// workspace root *recursively* so creates/renames/deletes of files and folders
// can invalidate the sidebar listing without a restart. Content-only writes
// (Modify::Data) are ignored — they do not change tree structure.
// ---------------------------------------------------------------------------

/// Coalescing window for directory-tree bursts (e.g. bulk create/delete).
const TREE_COALESCE_MS: u64 = 150;

/// Payload for the `workspace_tree_changed` event.
#[derive(Clone, Serialize)]
struct WorkspaceTreeChanged {
    root: PathBuf,
}

/// Recursive FS watcher for the current workspace root. At most one root is
/// watched at a time; swapping drops the previous watcher so its worker exits.
pub struct WorkspaceTreeWatcher {
    slot: Mutex<Option<WorkspaceTreeSlot>>,
}

struct WorkspaceTreeSlot {
    _watcher: RecommendedWatcher,
    root: PathBuf,
}

impl Default for WorkspaceTreeWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceTreeWatcher {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<WorkspaceTreeSlot>> {
        self.slot.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Watch `root` recursively, replacing any previous root.
    pub fn set_root<R: Runtime>(&self, app: AppHandle<R>, root: PathBuf) {
        let mut slot = self.lock();
        // Drop old watcher first so its worker observes a closed channel and exits.
        *slot = None;
        if let Some(built) = build_tree_slot(app, &root) {
            *slot = Some(built);
        }
    }

    /// Stop watching (e.g. no workspace root).
    pub fn clear(&self) {
        *self.lock() = None;
    }

    /// Root currently watched, if any. Used by tests/diagnostics.
    pub fn watched_root(&self) -> Option<PathBuf> {
        self.lock().as_ref().map(|s| s.root.clone())
    }
}

/// Whether an event can change the *structure* of a directory listing
/// (names/children), as opposed to only file contents or metadata.
fn affects_tree_structure(kind: &EventKind) -> bool {
    use notify::event::ModifyKind;
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Any => true,
        EventKind::Modify(ModifyKind::Name(_)) | EventKind::Modify(ModifyKind::Any) => true,
        // Data / Metadata / Other modifications leave the tree shape alone.
        EventKind::Modify(_) | EventKind::Access(_) | EventKind::Other => false,
    }
}

fn build_tree_slot<R: Runtime>(app: AppHandle<R>, root: &Path) -> Option<WorkspaceTreeSlot> {
    let watched_root = root.to_path_buf();

    let (tx, rx) = channel();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .ok()?;

    watcher.watch(&watched_root, RecursiveMode::Recursive).ok()?;

    let worker_root = watched_root.clone();
    std::thread::spawn(move || {
        while let Ok(res) = rx.recv() {
            let Ok(event) = res else { continue };
            if !affects_tree_structure(&event.kind) {
                continue;
            }
            // High-churn dirs (node_modules, target/, .git, …) must not refresh
            // the sidebar. Keep a flag across the coalesced burst: emit only if
            // at least one non-ignored structural path was seen.
            let mut any_relevant = !all_paths_ignored(&event.paths, &worker_root);

            // Drain the rest of the burst so a mass create/delete becomes one emit.
            loop {
                match rx.recv_timeout(Duration::from_millis(TREE_COALESCE_MS)) {
                    Ok(Ok(ev)) if affects_tree_structure(&ev.kind) => {
                        if !all_paths_ignored(&ev.paths, &worker_root) {
                            any_relevant = true;
                        }
                    }
                    Ok(_) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if !any_relevant {
                continue;
            }
            let _ = app.emit(
                "workspace_tree_changed",
                WorkspaceTreeChanged {
                    root: worker_root.clone(),
                },
            );
        }
    });

    Some(WorkspaceTreeSlot {
        _watcher: watcher,
        root: watched_root,
    })
}
