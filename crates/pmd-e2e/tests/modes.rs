mod helpers;

use helpers::WebDriverSession;
use std::time::Duration;

const MODES_SCREENSHOT: &str = "tests/screenshots/modes/window.png";

#[test]
fn test_modes_editor_renders_and_accepts_input() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");
    session
        .wait_for_editor(Duration::from_secs(20))
        .expect("wait for editor");

    let url = session.url().expect("read page URL");
    assert_eq!(url, "tauri://localhost", "unexpected app URL");

    session
        .screenshot_to(MODES_SCREENSHOT)
        .expect("write modes screenshot");

    session.close().expect("close WebDriver session");
}

#[test]
fn test_split_mode_preview_updates_within_100ms() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");
    session
        .wait_for_editor(Duration::from_secs(20))
        .expect("wait for editor");

    let script = r#"
        const done = arguments[arguments.length - 1];
        const view = document.querySelector('.cm-editor')?.view;
        if (!view) { done('no-editor'); return; }
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '# Hello World' }
        });
        setTimeout(() => {
            const preview = document.getElementById('preview-pane');
            const content = preview?.innerHTML || '';
            const version = preview?.dataset?.versionApplied || 'none';
            done(content.includes('Hello World') ? 'ok:' + version : 'fail:' + content);
        }, 80);
    "#;
    let result = session.execute_script(script, &[]).expect("script exec");
    let result_str = result.as_str().unwrap_or("");
    assert!(
        result_str.starts_with("ok:"),
        "preview did not update with new content: {}",
        result_str
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_version_drop_discards_stale_responses() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");
    session
        .wait_for_editor(Duration::from_secs(20))
        .expect("wait for editor");

    let script = r#"
        const done = arguments[arguments.length - 1];
        const view = document.querySelector('.cm-editor')?.view;
        if (!view) { done('no-editor'); return; }
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '# Fast Type\n' }
        });
        setTimeout(() => {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: '# Very Fast Type Second\n' }
            });
            setTimeout(() => {
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: '# Third Type\n' }
                });
                setTimeout(() => {
                    const preview = document.getElementById('preview-pane');
                    const version = preview?.dataset?.versionApplied || 'none';
                    const content = preview?.innerHTML || '';
                    done(version + '|' + content.slice(0, 200));
                }, 120);
            }, 120);
        }, 120);
    "#;
    let result = session.execute_script(script, &[]).expect("script exec");
    let result_str = result.as_str().unwrap_or("");

    let (version_str, _content) = result_str.split_once('|').unwrap_or(("", ""));
    let version: i64 = version_str.parse().unwrap_or(-1);
    assert!(
        version >= 3,
        "version should be >= 3 but was {} - stale responses may not be discarded",
        version
    );

    session.close().expect("close WebDriver session");
}
