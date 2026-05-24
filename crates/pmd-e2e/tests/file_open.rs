mod helpers;

use helpers::WebDriverSession;

const FILE_OPEN_SCREENSHOT: &str = "tests/screenshots/file-open/window.png";

#[test]
fn file_open_app_launches_with_cli_argv() {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])
        .expect("open WebDriver session with argv");

    let url = session.url().expect("read page URL");
    assert_eq!(url, "tauri://localhost", "unexpected app URL");

    let title = session.title().expect("read page title");
    assert_eq!(title, "preview-md", "unexpected page title");

    session
        .screenshot_to(FILE_OPEN_SCREENSHOT)
        .expect("write file-open screenshot");

    session.close().expect("close WebDriver session");
}
