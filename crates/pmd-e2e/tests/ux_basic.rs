mod helpers;

use helpers::WebDriverSession;
use std::time::Duration;

const UX_SCREENSHOT_PATH: &str = "tests/screenshots/ux/window.png";

#[test]
fn test_welcome_screen_shows_on_launch_without_args() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    session
        .wait_for_selector(".pmd-chrome", Duration::from_secs(5))
        .expect("wait for app chrome");

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
    session
        .wait_for_selector(".pmd-chrome", Duration::from_secs(5))
        .expect("wait for app chrome");

    let toolbar = session.js_object(
        r#"
        const done = arguments[0];
        const toolbar = document.querySelector('.pmd-toolbar');
        const modeGroup = document.querySelector('.pmd-segmented');
        const buttons = modeGroup
            ? Array.from(modeGroup.querySelectorAll('.pmd-segmented-btn')).map(b => b.textContent.trim())
            : [];
        done({
            hasToolbar: !!toolbar,
            hasModeGroup: !!modeGroup,
            modeButtons: buttons,
            bodyMode: document.body.dataset.mode
        });
        "#,
        &[],
    ).expect("execute script");

    assert_eq!(
        toolbar["hasToolbar"].as_bool(),
        Some(true),
        "toolbar should exist: {toolbar}"
    );
    assert_eq!(
        toolbar["hasModeGroup"].as_bool(),
        Some(true),
        "mode button group should exist: {toolbar}"
    );
    let mode_button_count = toolbar["modeButtons"].as_array().map_or(0, Vec::len);
    assert!(
        mode_button_count >= 3,
        "mode group should include source/split/preview buttons: {toolbar}"
    );
    assert_eq!(
        toolbar["bodyMode"].as_str(),
        Some("split"),
        "initial toolbar mode should be split: {toolbar}"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_mode_switching_via_toolbar() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    session
        .wait_for_selector(".cm-editor", Duration::from_secs(5))
        .expect("wait for editor");

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

    let source_click = session
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
    assert_eq!(
        source_click.as_str(),
        Some("clicked"),
        "source mode button should be clickable"
    );
    session
        .wait_for_condition(
            "source mode after toolbar click",
            Duration::from_secs(2),
            || {
                let mode = session.execute_script(
                    r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
                    &[],
                )?;
                Ok(mode.as_str() == Some("source"))
            },
        )
        .expect("wait for source mode");

    let after_mode = session
        .execute_script(
            r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
            &[],
        )
        .expect("execute script");
    assert_eq!(
        after_mode.as_str(),
        Some("source"),
        "clicking source button should switch to source mode"
    );

    let preview_click = session
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
    assert_eq!(
        preview_click.as_str(),
        Some("clicked"),
        "preview mode button should be clickable"
    );
    session
        .wait_for_condition(
            "preview mode after toolbar click",
            Duration::from_secs(2),
            || {
                let mode = session.execute_script(
                    r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
                    &[],
                )?;
                Ok(mode.as_str() == Some("preview"))
            },
        )
        .expect("wait for preview mode");

    let final_mode = session
        .execute_script(
            r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
            &[],
        )
        .expect("execute script");
    assert_eq!(
        final_mode.as_str(),
        Some("preview"),
        "clicking preview button should switch to preview mode"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_editor_accepts_input_in_source_mode() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    session
        .wait_for_selector(".cm-editor", Duration::from_secs(5))
        .expect("wait for editor");

    let source_click = session
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
    assert_eq!(
        source_click.as_str(),
        Some("clicked"),
        "source mode button should be clickable"
    );
    session
        .wait_for_condition(
            "source mode before editor input",
            Duration::from_secs(2),
            || {
                let mode = session.execute_script(
                    r#"
        const done = arguments[0];
        done(document.body.dataset.mode);
        "#,
                    &[],
                )?;
                Ok(mode.as_str() == Some("source"))
            },
        )
        .expect("wait for source mode");

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
    session
        .wait_for_selector(".pmd-chrome", Duration::from_secs(5))
        .expect("wait for app chrome");

    session.execute_script(
        r#"
        const done = arguments[0];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
        done('dispatched');
        "#,
        &[],
    ).expect("dispatch Ctrl+N");

    let new_file_state_script = r#"
        const done = arguments[0];
        const filename = document.querySelector('.pmd-filename');
        const editor = document.querySelector('.cm-editor');
        done({
            filename: filename ? filename.textContent : 'no-filename',
            hasEditor: !!editor,
            bodyMode: document.body.dataset.mode
        });
        "#;
    session
        .wait_for_condition(
            "Ctrl+N to create a new editor",
            Duration::from_secs(2),
            || {
                let state = session.js_object(new_file_state_script, &[])?;
                let filename = state["filename"].as_str().unwrap_or("");
                Ok(filename.contains("Untitled") && state["hasEditor"].as_bool() == Some(true))
            },
        )
        .expect("wait for new file state");

    let state = session
        .js_object(new_file_state_script, &[])
        .expect("execute script");
    assert!(
        state["filename"]
            .as_str()
            .unwrap_or("")
            .contains("Untitled"),
        "Ctrl+N should create an Untitled file: {state}"
    );
    assert_eq!(
        state["hasEditor"].as_bool(),
        Some(true),
        "Ctrl+N should show an editor: {state}"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_file_menu_opens_and_shows_recent_files() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    session
        .wait_for_selector(".pmd-dropdown > button", Duration::from_secs(5))
        .expect("wait for file menu button");

    let menu_click = session
        .execute_script(
            r#"
        const done = arguments[0];
        const btn = document.querySelector('.pmd-dropdown > button');
        if (btn) { btn.click(); }
        done(btn ? 'clicked' : 'not-found');
        "#,
            &[],
        )
        .expect("execute script");
    assert_eq!(
        menu_click.as_str(),
        Some("clicked"),
        "file menu button should be clickable"
    );

    let dropdown_state_script = r#"
        const done = arguments[0];
        const dropdown = document.querySelector('.pmd-dropdown-menu');
        done({
            visible: dropdown ? getComputedStyle(dropdown).display !== 'none' : false,
            hasRecentList: !!document.querySelector('.pmd-dropdown-item'),
            hasClearBtn: !!document.querySelector('.pmd-dropdown-divider')
        });
        "#;
    session
        .wait_for_condition("file dropdown to open", Duration::from_secs(2), || {
            let dropdown = session.js_object(dropdown_state_script, &[])?;
            Ok(dropdown["visible"].as_bool() == Some(true))
        })
        .expect("wait for file dropdown");

    let dropdown = session
        .js_object(dropdown_state_script, &[])
        .expect("execute script");
    assert_eq!(
        dropdown["visible"].as_bool(),
        Some(true),
        "file dropdown should open on click: {dropdown}"
    );
    assert_eq!(
        dropdown["hasRecentList"].as_bool(),
        Some(true),
        "file dropdown should show menu items: {dropdown}"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_theme_picker_opens_with_ctrl_t() {
    let session = WebDriverSession::new().expect("open WebDriver session");
    session
        .wait_for_selector(".pmd-chrome", Duration::from_secs(5))
        .expect("wait for app chrome");

    session.execute_script(
        r#"
        const done = arguments[0];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }));
        done('dispatched');
        "#,
        &[],
    ).expect("dispatch Ctrl+T");

    let picker_state_script = r#"
        const done = arguments[0];
        const pickerEl = document.querySelector('#theme-picker-overlay, .pmd-picker-overlay');
        const cards = document.querySelectorAll('.pmd-picker-card');
        done({
            pickerOpen: !!pickerEl,
            cardCount: cards.length
        });
        "#;
    session
        .wait_for_condition("theme picker to open", Duration::from_secs(2), || {
            let picker = session.js_object(picker_state_script, &[])?;
            Ok(picker["pickerOpen"].as_bool() == Some(true)
                && picker["cardCount"].as_u64().unwrap_or(0) > 0)
        })
        .expect("wait for theme picker");

    let picker = session
        .js_object(picker_state_script, &[])
        .expect("execute script");
    assert_eq!(
        picker["pickerOpen"].as_bool(),
        Some(true),
        "theme picker should open with Ctrl+T: {picker}"
    );
    assert!(
        picker["cardCount"].as_u64().unwrap_or(0) > 0,
        "theme picker should render theme cards: {picker}"
    );

    session.close().expect("close WebDriver session");
}

#[test]
fn test_app_with_file_arg_opens_file() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file");
    session
        .wait_for_selector(".cm-editor", Duration::from_secs(5))
        .expect("wait for editor");

    let state = session
        .js_object(
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

    assert!(
        state["filename"]
            .as_str()
            .unwrap_or("")
            .contains("hello.md"),
        "app should show opened filename: {state}"
    );
    assert_eq!(
        state["previewHasContent"].as_bool(),
        Some(true),
        "app should render opened file preview: {state}"
    );
    assert_eq!(
        state["hasEditor"].as_bool(),
        Some(true),
        "app should open editor for file argv: {state}"
    );

    session.close().expect("close WebDriver session");
}
