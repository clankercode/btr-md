use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Manages an at-most-one `notify` watcher for the currently active file.
///
/// Watching is centralised here so every file-open code path (CLI, dialog,
/// `request_open_file`, save-as) can call `set_target` and pick up watcher
/// events for the right file. The previous design only started a watcher
/// for the initial CLI path, and the UI had no way to swap it on a normal
/// open, so disk watching was silently broken outside CLI startup.
///
/// Watcher events emit the canonical path as the payload so the UI can
/// confirm the event applies to its `currentFilePath` (race-safe against
/// rapid switches).
///
/// Switching watchers works by dropping the previous `RecommendedWatcher`
/// (which closes its event channel) before installing a new one. The
/// previous worker thread observes the closed channel and exits, so stale
/// events cannot fire after a swap.
pub struct FileWatcher {
    inner: Mutex<Option<WatcherSlot>>,
}

struct WatcherSlot {
    _watcher: RecommendedWatcher,
    path: PathBuf,
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Stop watching the previous file (if any) and start watching `path`.
    ///
    /// The watcher tracks the parent directory and filters events by file
    /// name, since `notify`'s recommended backend on Linux is inotify which
    /// has trouble re-arming on a single file when editors rename-and-replace.
    pub fn set_target(&self, app: AppHandle, path: PathBuf) {
        // Recover from a poisoned lock — `inner` is a single Option<WatcherSlot>
        // with no multi-step invariants. Drop the previous slot before building
        // the new one so the old worker thread can exit cleanly.
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *inner = None;

        let Some(slot) = build_slot(app, &path) else {
            return;
        };
        *inner = Some(slot);
    }

    /// Stop watching whatever (if anything) is currently active. Called on
    /// "new file" (untitled buffer) and after a successful close.
    pub fn clear(&self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *inner = None;
    }

    /// Path currently being watched, if any. Used by tests and diagnostics.
    pub fn current(&self) -> Option<PathBuf> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.as_ref().map(|s| s.path.clone())
    }
}

fn build_slot(app: AppHandle, path: &Path) -> Option<WatcherSlot> {
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

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .ok()?;

    let worker_app = app.clone();
    let worker_path = watched_path.clone();

    std::thread::spawn(move || {
        // When the slot is replaced (or cleared), the `RecommendedWatcher`
        // owning `tx` drops; `rx.recv()` then returns `Err` and we exit.
        while let Ok(res) = rx.recv() {
            let Ok(event) = res else { continue };
            let touches_target = event
                .paths
                .iter()
                .any(|p| p.file_name() == Some(&file_name));
            if !touches_target {
                continue;
            }
            let payload = worker_path.to_string_lossy().to_string();
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    if worker_path.exists() {
                        let _ = worker_app.emit("file_changed_on_disk", payload);
                    }
                }
                EventKind::Remove(_) => {
                    let _ = worker_app.emit("file_removed_from_disk", payload);
                }
                _ => {}
            }
        }
    });

    Some(WatcherSlot {
        _watcher: watcher,
        path: watched_path,
    })
}
