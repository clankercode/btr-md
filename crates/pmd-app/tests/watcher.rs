use pmd_app_lib::watcher::FileWatcher;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::Listener;

#[test]
fn file_watcher_emits_change_for_target_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("watched.md");
    std::fs::write(&path, "# One").expect("seed watched file");
    let path = path.canonicalize().expect("canonical watched file");

    let app = tauri::test::mock_app();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<String>();
    let _listener = handle.listen("file_changed_on_disk", move |event: tauri::Event| {
        let _ = tx.send(event.payload().to_string());
    });

    let watcher = FileWatcher::new();
    watcher.set_target(handle, path.clone());
    assert_eq!(watcher.current(), Some(path.clone()));

    let started = Instant::now();
    let mut attempt = 0;
    loop {
        attempt += 1;
        std::fs::write(&path, format!("# Two\n\nattempt {attempt}")).expect("modify watched file");
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(payload) => {
                let emitted = serde_json::from_str::<String>(&payload).unwrap_or(payload);
                assert_eq!(emitted, path.to_string_lossy().as_ref());
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < Duration::from_secs(4) => {
                continue;
            }
            Err(e) => panic!("watcher did not emit file_changed_on_disk: {e}"),
        }
    }
}
