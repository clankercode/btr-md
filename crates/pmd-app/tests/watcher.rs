//! Content-aware watcher behaviour: the worker re-reads + hashes the file and
//! drives the registry, emitting a single structured `doc_state_changed`.

use pmd_app_lib::AppState;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{Listener, Manager};

/// Build a mock Tauri app with a managed `AppState`.
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(AppState::new(None))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// Extract the `state.kind` discriminant from a `doc_state_changed` payload.
fn state_kind(payload: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    v.get("state")?.get("kind")?.as_str().map(|s| s.to_string())
}

#[test]
fn external_modification_emits_disk_changed_clean() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("watched.md");
    std::fs::write(&path, "# One\n").expect("seed");
    let canon = path.canonicalize().expect("canonical");

    let app = mock_app();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<String>();
    let _listener = handle.listen("doc_state_changed", move |event: tauri::Event| {
        let _ = tx.send(event.payload().to_string());
    });

    // Register the doc as Clean (base == current disk) and watch it.
    let st = app.state::<AppState>();
    let (doc_id, _) = st
        .docs
        .register("main", Some(canon.clone()), "# One\n".to_string());
    st.watcher.set_target(handle.clone(), doc_id, canon.clone());
    assert_eq!(st.watcher.watched(doc_id), Some(canon.clone()));

    let started = Instant::now();
    let mut attempt = 0;
    loop {
        attempt += 1;
        std::fs::write(&canon, format!("# Two\n\nexternal {attempt}\n")).expect("modify");
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(payload) => {
                let kind = state_kind(&payload).expect("state.kind present");
                assert_eq!(
                    kind, "disk_changed_clean",
                    "external change over a clean buffer must flag DiskChangedClean (got {kind})"
                );
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < Duration::from_secs(5) => {
                continue;
            }
            Err(e) => panic!("watcher did not emit doc_state_changed: {e}"),
        }
    }
}

#[test]
fn identical_rewrite_is_suppressed_as_clean() {
    // Writing identical content (the self-write case) must NOT flag an external
    // change: the on-disk digest equals base, so the transition collapses to
    // Clean. This is the content-aware self-write suppression.
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("watched.md");
    let body = "# Stable\n\nunchanged body\n";
    std::fs::write(&path, body).expect("seed");
    let canon = path.canonicalize().expect("canonical");

    let app = mock_app();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<String>();
    let _listener = handle.listen("doc_state_changed", move |event: tauri::Event| {
        let _ = tx.send(event.payload().to_string());
    });

    let st = app.state::<AppState>();
    let (doc_id, _) = st
        .docs
        .register("main", Some(canon.clone()), body.to_string());
    st.watcher.set_target(handle.clone(), doc_id, canon.clone());

    let started = Instant::now();
    loop {
        std::fs::write(&canon, body).expect("rewrite identical");
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(payload) => {
                let kind = state_kind(&payload).expect("state.kind present");
                assert_eq!(
                    kind, "clean",
                    "identical rewrite must stay Clean (got {kind})"
                );
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < Duration::from_secs(5) => {
                continue;
            }
            Err(e) => panic!("watcher did not emit doc_state_changed: {e}"),
        }
    }
}
