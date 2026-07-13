//! Content-aware watcher behaviour: the worker re-reads + hashes the file and
//! drives the registry, emitting a single structured `doc_state_changed`.
//! Also covers the recursive workspace-tree watcher used by the sidebar.

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

#[test]
fn workspace_tree_create_emits_workspace_tree_changed() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().canonicalize().expect("canonical root");

    let app = mock_app();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<String>();
    let _listener = handle.listen("workspace_tree_changed", move |event: tauri::Event| {
        let _ = tx.send(event.payload().to_string());
    });

    let st = app.state::<AppState>();
    st.workspace_watcher.set_root(handle.clone(), root.clone());
    assert_eq!(st.workspace_watcher.watched_root(), Some(root.clone()));

    let started = Instant::now();
    let mut attempt = 0;
    loop {
        attempt += 1;
        let path = root.join(format!("created-{attempt}.md"));
        std::fs::write(&path, "# hi\n").expect("create file");
        match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(payload) => {
                let v: serde_json::Value =
                    serde_json::from_str(&payload).expect("workspace_tree_changed JSON");
                let got = v
                    .get("root")
                    .and_then(|r| r.as_str())
                    .expect("root field");
                assert_eq!(
                    std::path::Path::new(got),
                    root.as_path(),
                    "payload root must match watched root"
                );
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < Duration::from_secs(5) => {
                continue;
            }
            Err(e) => panic!("workspace watcher did not emit workspace_tree_changed: {e}"),
        }
    }
}

#[test]
fn workspace_tree_content_only_write_is_suppressed() {
    // A pure content rewrite must not fire workspace_tree_changed — that would
    // thrash the sidebar on every autosave of an open file under the root.
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().canonicalize().expect("canonical root");
    let file = root.join("notes.md");
    std::fs::write(&file, "# one\n").expect("seed");

    let app = mock_app();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<String>();
    let _listener = handle.listen("workspace_tree_changed", move |event: tauri::Event| {
        let _ = tx.send(event.payload().to_string());
    });

    let st = app.state::<AppState>();
    st.workspace_watcher.set_root(handle.clone(), root.clone());

    // Give the watcher a moment to settle, then rewrite content only.
    std::thread::sleep(Duration::from_millis(50));
    // Drain any startup noise.
    while rx.try_recv().is_ok() {}

    std::fs::write(&file, "# two\n").expect("content rewrite");
    // Wait longer than the coalesce window; a correct implementation stays quiet.
    match rx.recv_timeout(Duration::from_millis(500)) {
        Ok(payload) => panic!(
            "content-only rewrite must not emit workspace_tree_changed, got {payload}"
        ),
        Err(mpsc::RecvTimeoutError::Timeout) => {}
        Err(e) => panic!("unexpected recv error: {e}"),
    }
}

#[test]
fn workspace_tree_set_root_replaces_previous() {
    let a = tempfile::tempdir().expect("tempdir a");
    let b = tempfile::tempdir().expect("tempdir b");
    let root_a = a.path().canonicalize().expect("canon a");
    let root_b = b.path().canonicalize().expect("canon b");

    let app = mock_app();
    let handle = app.handle().clone();
    let st = app.state::<AppState>();

    st.workspace_watcher.set_root(handle.clone(), root_a.clone());
    assert_eq!(st.workspace_watcher.watched_root(), Some(root_a));
    st.workspace_watcher.set_root(handle.clone(), root_b.clone());
    assert_eq!(st.workspace_watcher.watched_root(), Some(root_b));
    st.workspace_watcher.clear();
    assert_eq!(st.workspace_watcher.watched_root(), None);
}
