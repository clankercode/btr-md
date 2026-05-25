use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct FileWatcher {
    inner: Mutex<Option<RecommendedWatcher>>,
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

    pub fn watch(&self, app: AppHandle, path: PathBuf) {
        let parent = path.parent().unwrap_or(&path).to_path_buf();
        let Some(file_name) = path.file_name().map(|n| n.to_owned()) else {
            return;
        };

        let (tx, rx) = channel();

        let mut watcher = match RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                let _ = tx.send(res);
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(_) => return,
        };

        if watcher.watch(&parent, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        let app_clone = app.clone();
        let watched_path = path.clone();

        std::thread::spawn(move || {
            while let Ok(res) = rx.recv() {
                if let Ok(event) = res {
                    let dominated = event
                        .paths
                        .iter()
                        .any(|p| p.file_name() == Some(&file_name));
                    if !dominated {
                        continue;
                    }
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {
                            if watched_path.exists() {
                                let _ = app_clone.emit("file_changed_on_disk", ());
                            }
                        }
                        EventKind::Remove(_) => {
                            let _ = app_clone.emit("file_removed_from_disk", ());
                        }
                        _ => {}
                    }
                }
            }
        });

        // Recover from a poisoned lock — `inner` is a single Option<Watcher>
        // with no multi-step invariants.
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *inner = Some(watcher);
    }
}
