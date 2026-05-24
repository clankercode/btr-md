use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use tauri::{AppHandle, Emitter};

#[allow(dead_code)]
pub struct FileWatcher {
    watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new(app: AppHandle, path: PathBuf) -> Result<Self, notify::Error> {
        let (tx, rx) = channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                let _ = tx.send(res);
            },
            Config::default(),
        )?;

        watcher.watch(&path, RecursiveMode::NonRecursive)?;

        let app_clone = app.clone();
        std::thread::spawn(move || {
            while let Ok(event) = rx.recv() {
                if let Ok(event) = event {
                    if event.kind.is_modify() {
                        let _ = app_clone.emit("file_changed_on_disk", ());
                    }
                }
            }
        });

        Ok(Self { watcher })
    }
}
