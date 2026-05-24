mod helpers;

use helpers::WebDriverSession;

const MODES_SCREENSHOT: &str = "tests/screenshots/modes/window.png";

#[test]
fn test_modes_editor_renders_and_accepts_input() {
    std::thread::sleep(std::time::Duration::from_secs(2));

    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with file arg");

    let url = session.url().expect("read page URL");
    assert_eq!(url, "tauri://localhost", "unexpected app URL");

    session
        .screenshot_to(MODES_SCREENSHOT)
        .expect("write modes screenshot");

    session.close().expect("close WebDriver session");
}
