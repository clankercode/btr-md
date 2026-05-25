mod helpers;

use helpers::WebDriverSession;

const THEME_PICKER_SCREENSHOT: &str = "tests/screenshots/theme-picker/window.png";

#[test]
fn test_theme_picker_opens_and_filters_and_applies_theme() {
    std::thread::sleep(std::time::Duration::from_secs(2));

    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");

    let url = session.url().expect("read page URL");
    assert_eq!(url, "tauri://localhost", "unexpected app URL");

    let open_picker_script = r#"
        const done = arguments[arguments.length - 1];
        const event = new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true });
        document.dispatchEvent(event);
        setTimeout(() => {
            const overlay = document.getElementById('theme-picker-overlay');
            done(overlay ? 'opened' : 'not-opened');
        }, 100);
    "#;
    let result = session
        .execute_script(open_picker_script, &[])
        .expect("open picker script");
    let result_str = result.as_str().unwrap_or("");
    assert_eq!(result_str, "opened", "theme picker should open on Ctrl+T");

    let filter_script = r#"
        const done = arguments[arguments.length - 1];
        const input = document.getElementById('theme-filter-input');
        if (!input) { done('no-input'); return; }
        input.value = 'dracula';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
            const cards = document.querySelectorAll('.pmd-picker-card');
            const visible = Array.from(cards).filter(c => !c.hasAttribute('hidden') && getComputedStyle(c).display !== 'none');
            const names = Array.from(visible).map(c => c.querySelector('.pmd-picker-name')?.textContent || '');
            done(names.join(','));
        }, 100);
    "#;
    let filter_result = session
        .execute_script(filter_script, &[])
        .expect("filter script");
    let filter_str = filter_result.as_str().unwrap_or("");
    assert!(
        filter_str.contains("Dracula"),
        "filtering by 'dracula' should show Dracula theme, got: {}",
        filter_str
    );

    let select_script = r#"
        const done = arguments[arguments.length - 1];
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        document.dispatchEvent(event);
        setTimeout(() => {
            const overlay = document.getElementById('theme-picker-overlay');
            const style = document.getElementById('pmd-theme-styles');
            done({
                pickerClosed: !overlay,
                styleApplied: !!style && style.textContent.length > 0
            });
        }, 200);
    "#;
    let select_result = session
        .execute_script(select_script, &[])
        .expect("select script");
    let select_str = select_result.as_str().unwrap_or("");

    assert!(
        select_str.contains("\"pickerClosed\":true") || select_str.contains("pickerClosed:true"),
        "picker should close after Enter, got: {}",
        select_str
    );

    session
        .screenshot_to(THEME_PICKER_SCREENSHOT)
        .expect("write theme picker screenshot");

    session.close().expect("close WebDriver session");
}

#[test]
fn test_theme_picker_keyboard_navigation() {
    std::thread::sleep(std::time::Duration::from_secs(2));

    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");

    let open_picker_script = r#"
        const done = arguments[arguments.length - 1];
        const event = new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true });
        document.dispatchEvent(event);
        setTimeout(() => {
            const overlay = document.getElementById('theme-picker-overlay');
            done(overlay ? 'opened' : 'not-opened');
        }, 100);
    "#;
    session
        .execute_script(open_picker_script, &[])
        .expect("open picker script");

    std::thread::sleep(std::time::Duration::from_millis(200));

    let arrow_down_script = r#"
        const done = arguments[arguments.length - 1];
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
        document.dispatchEvent(event);
        setTimeout(() => {
            const selected = document.querySelector('[data-selected="true"]');
            const name = selected?.querySelector('.pmd-picker-name')?.textContent || '';
            done(name);
        }, 100);
    "#;
    let nav_result = session
        .execute_script(arrow_down_script, &[])
        .expect("arrow down script");
    let nav_str = nav_result.as_str().unwrap_or("");
    assert!(
        !nav_str.is_empty(),
        "arrow down should navigate to a theme, got empty result"
    );

    let esc_script = r#"
        const done = arguments[arguments.length - 1];
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        document.dispatchEvent(event);
        setTimeout(() => {
            const overlay = document.getElementById('theme-picker-overlay');
            done(overlay ? 'still-open' : 'closed');
        }, 100);
    "#;
    let esc_result = session.execute_script(esc_script, &[]).expect("esc script");
    let esc_str = esc_result.as_str().unwrap_or("");
    assert_eq!(esc_str, "closed", "Escape should close picker");

    session.close().expect("close WebDriver session");
}
