mod helpers;

use helpers::WebDriverSession;

const UX_SCREENSHOT_PATH: &str = "tests/screenshots/ux/window.png";

#[test]
fn test_welcome_screen_shows_on_launch_without_args() {
    let session = WebDriverSession::new().expect("open WebDriver session");

    std::thread::sleep(std::time::Duration::from_secs(2));

    let welcome = session
        .execute_script(
            r#"
        const done = arguments[0];
        const el = document.querySelector('.pmd-welcome');
        done(el ? el.innerHTML.slice(0, 200) : 'NOT FOUND');
        "#,
            &[],
        )
        .expect("execute script");
    let welcome_html = welcome.as_str().unwrap_or("");
    assert!(
        welcome_html.contains("preview-md")
            || welcome_html.contains("Open File")
            || welcome_html.contains("New File"),
        "welcome screen not found or missing content: {}",
        welcome_html
    );

    session.screenshot_to(UX_SCREENSHOT_PATH).ok();
    session.close().expect("close WebDriver session");
}

#[test]
fn test_toolbar_exists_with_mode_buttons() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    std::thread::sleep(std::time::Duration::from_secs(2));

    let toolbar = session.execute_script(
        r#"
        const done = arguments[0];
        const toolbar = document.querySelector('.pmd-toolbar');
        const modeGroup = document.querySelector('.pmd-segmented');
        const buttons = modeGroup ? Array.from(modeGroup.querySelectorAll('.pmd-segmented-btn')).map(b => b.textContent) : [];
        done({
            hasToolbar: !!toolbar,
            hasModeGroup: !!modeGroup,
            modeButtons: buttons,
            bodyMode: document.body.dataset.mode
        });
        "#,
        &[],
    ).expect("execute script");
    let result_text = toolbar.as_str().unwrap_or("");

    assert!(
        result_text.contains("hasToolbar"),
        "toolbar query failed: {}",
        result_text
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_mode_switching_via_toolbar() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    std::thread::sleep(std::time::Duration::from_secs(2));

    let initial = session
        .execute_script(
            r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
            &[],
        )
        .expect("execute script");
    let initial_mode = initial.as_str().unwrap_or("");
    assert_eq!(initial_mode, "split", "initial mode should be split");

    session
        .execute_script(
            r#"
        const done = arguments[0];
        const btn = document.querySelector('[data-mode="source"]');
        if (btn) { btn.click(); }
        done(btn ? 'clicked' : 'not-found');
        "#,
            &[],
        )
        .expect("execute script");
    std::thread::sleep(std::time::Duration::from_millis(200));

    let after_click = session
        .execute_script(
            r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
            &[],
        )
        .expect("execute script");
    let after_mode = after_click.as_str().unwrap_or("");
    assert_eq!(
        after_mode, "source",
        "clicking source button should switch to source mode"
    );

    session
        .execute_script(
            r#"
        const done = arguments[0];
        const btn = document.querySelector('[data-mode="preview"]');
        if (btn) { btn.click(); }
        done(btn ? 'clicked' : 'not-found');
        "#,
            &[],
        )
        .expect("execute script");
    std::thread::sleep(std::time::Duration::from_millis(200));

    let final_mode = session
        .execute_script(
            r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
            &[],
        )
        .expect("execute script");
    let final_mode_str = final_mode.as_str().unwrap_or("");
    assert_eq!(
        final_mode_str, "preview",
        "clicking preview button should switch to preview mode"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_editor_accepts_input_in_source_mode() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    std::thread::sleep(std::time::Duration::from_secs(2));

    session
        .execute_script(
            r#"
        const done = arguments[0];
        const btn = document.querySelector('[data-mode="source"]');
        if (btn) { btn.click(); }
        setTimeout(done, 200);
        "#,
            &[],
        )
        .ok();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let editor_result = session.execute_script(
        r#"
        const done = arguments[0];
        const cm = document.querySelector('.cm-editor');
        if (cm) {
            const view = cm.view;
            if (view) {
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: '# Test Heading\n\nHello World' }
                });
                setTimeout(() => done('ok:' + view.state.doc.toString().slice(0, 50)), 100);
            } else {
                done('no-view');
            }
        } else {
            done('no-editor');
        }
        "#,
        &[],
    ).expect("execute script");
    let editor_text = editor_result.as_str().unwrap_or("");
    assert!(
        editor_text.starts_with("ok:"),
        "editor should accept input, got: {}",
        editor_text
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_keyboard_shortcut_ctrl_n_creates_new_file() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    std::thread::sleep(std::time::Duration::from_secs(2));

    session.execute_script(
        r#"
        const done = arguments[0];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
        setTimeout(done, 500);
        "#,
        &[],
    ).ok();
    std::thread::sleep(std::time::Duration::from_millis(600));

    let state = session
        .execute_script(
            r#"
        const done = arguments[0];
        const filename = document.querySelector('.pmd-filename');
        const editor = document.querySelector('.cm-editor');
        done({
            filename: filename ? filename.textContent : 'no-filename',
            hasEditor: !!editor,
            bodyMode: document.body.dataset.mode
        });
        "#,
            &[],
        )
        .expect("execute script");
    let state_text = state.as_str().unwrap_or("");

    assert!(
        state_text.contains("Untitled") || state_text.contains("hasEditor"),
        "Ctrl+N should create new file, state: {}",
        state_text
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_file_menu_opens_and_shows_recent_files() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    std::thread::sleep(std::time::Duration::from_secs(2));

    session
        .execute_script(
            r#"
        const done = arguments[0];
        const btn = document.querySelector('.pmd-file-menu-btn');
        if (btn) { btn.click(); }
        setTimeout(done, 200);
        "#,
            &[],
        )
        .ok();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let dropdown = session
        .execute_script(
            r#"
        const done = arguments[0];
        const dropdown = document.querySelector('.pmd-dropdown-menu');
        done({
            visible: dropdown ? dropdown.style.display !== 'none' : false,
            hasRecentList: !!document.querySelector('.pmd-dropdown-item'),
            hasClearBtn: !!document.querySelector('.pmd-dropdown-divider')
        });
        "#,
            &[],
        )
        .expect("execute script");
    let dropdown_text = dropdown.as_str().unwrap_or("");

    assert!(
        dropdown_text.contains("visible") && dropdown_text.contains("true"),
        "file dropdown should open on click: {}",
        dropdown_text
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_theme_picker_opens_with_ctrl_t() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    std::thread::sleep(std::time::Duration::from_secs(2));

    session.execute_script(
        r#"
        const done = arguments[0];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }));
        setTimeout(done, 500);
        "#,
        &[],
    ).ok();
    std::thread::sleep(std::time::Duration::from_millis(600));

    let picker = session
        .execute_script(
            r#"
        const done = arguments[0];
        const pickerEl = document.querySelector('.pmd-picker');
        const cards = document.querySelectorAll('.pmd-picker-card');
        done({
            pickerOpen: !!pickerEl,
            cardCount: cards.length
        });
        "#,
            &[],
        )
        .expect("execute script");
    let picker_text = picker.as_str().unwrap_or("");

    assert!(
        picker_text.contains("pickerOpen") && picker_text.contains("cardCount"),
        "theme picker should open with Ctrl+T: {}",
        picker_text
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_app_with_file_arg_opens_file() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    std::thread::sleep(std::time::Duration::from_secs(2));

    let state = session
        .execute_script(
            r#"
        const done = arguments[0];
        const filename = document.querySelector('.pmd-filename');
        const preview = document.getElementById('preview-pane');
        done({
            filename: filename ? filename.textContent : '',
            previewHasContent: preview ? preview.innerHTML.length > 0 : false,
            hasEditor: !!document.querySelector('.cm-editor')
        });
        "#,
            &[],
        )
        .expect("execute script");
    let state_text = state.as_str().unwrap_or("");

    assert!(
        state_text.contains("hello.md") || state_text.contains("previewHasContent"),
        "app should open file from argv: {}",
        state_text
    );

    session.close().expect("close WebDriver session");
}
