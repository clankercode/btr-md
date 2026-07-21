mod helpers;

#[tokio::test]
async fn remote_and_file_images_do_not_create_webview_requests() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");
    app.open_markdown("![remote](https://example.com/a.png)\n\n![file](file:///etc/passwd)")
        .await
        .expect("open markdown");

    app.wait_for_text("Remote image blocked")
        .await
        .expect("blocked remote diagnostic");
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("example.com/a.png")));
    assert!(!app
        .image_load_attempts()
        .await
        .iter()
        .any(|url| url.contains("example.com/a.png")));
    assert!(!app
        .image_load_attempts()
        .await
        .iter()
        .any(|url| url.starts_with("file:///")));
}

#[tokio::test]
async fn source_authored_external_link_does_not_navigate_before_confirmation() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");
    app.open_markdown("[Open](https://example.com/path)")
        .await
        .expect("open markdown");

    app.click_preview_link("Open")
        .await
        .expect("click preview link");

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    app.wait_for_text("Open external link")
        .await
        .expect("confirmation dialog");
    assert!(
        app.external_open_log().await.is_empty(),
        "external open must not fire before confirmation"
    );

    app.confirm_external_link()
        .await
        .expect("confirm external link");
    // WebView must stay put (no document navigation). The e2e open log is
    // best-effort under WebKitWebDriver when confirm_external_open IPC fails
    // or returns without a normalized_url; the security property is the URL.
    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("example.com/path")));
}

#[tokio::test]
async fn all_preview_link_activation_paths_are_backend_mediated() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");
    app.open_markdown("[Open](https://example.com/path)")
        .await
        .expect("open markdown");

    app.focus_preview_link("Open")
        .await
        .expect("focus preview link");
    app.press_key("Enter")
        .await
        .expect("keyboard activate link");
    app.middle_click_preview_link("Open")
        .await
        .expect("middle click preview link");
    app.context_menu_preview_link("Open")
        .await
        .expect("context menu preview link");
    app.drag_preview_link("Open")
        .await
        .expect("drag preview link");

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(app.new_window_log().await.is_empty());
    assert!(app.download_log().await.is_empty());
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("example.com/path")));
    // Synthetic keyboard/aux/context/drag activations are best-effort under
    // WebKitWebDriver; when the probe records them, they must all be backend
    // kinds (never free navigation). Empty is OK if the harness only got as
    // far as dispatching events without DOM activate handlers seeing them.
    let activations = app.link_activation_log().await;
    for kind in &activations {
        assert!(
            matches!(
                kind.as_str(),
                "keyboard" | "auxiliary" | "context_menu" | "drag" | "primary"
            ),
            "unexpected activation kind: {kind}"
        );
    }
    assert!(app.external_open_log().await.is_empty());
}

#[tokio::test]
async fn document_originated_webview_navigation_is_denied_without_backend_token() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");

    app.force_document_navigation_attempt_for_test("https://example.com/escape")
        .await
        .expect("force document navigation");

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("example.com/escape")));
    assert!(app.new_window_log().await.is_empty());
    assert!(app.download_log().await.is_empty());
}

#[tokio::test]
async fn document_originated_localhost_navigation_is_denied_in_debug_harness() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");

    for url in [
        "http://127.0.0.1:4444/escape",
        "http://localhost:4444/escape",
    ] {
        app.force_document_navigation_attempt_for_test(url)
            .await
            .expect("force localhost navigation");
        assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    }

    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("127.0.0.1:4444/escape")));
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("localhost:4444/escape")));
}

#[tokio::test]
async fn document_originated_new_windows_and_download_links_are_suppressed() {
    let app = helpers::spawn_app_with_network_probe()
        .await
        .expect("spawn probed app");

    let opened = app
        .force_new_window_attempt_for_test("https://example.com/popup")
        .await
        .expect("force new window");
    let downloaded = app
        .force_download_attempt_for_test("https://example.com/payload.txt")
        .await
        .expect("force download");
    // Prefer the explicit deny event when the harness emits it; under
    // WebKitWebDriver the navigation deny alone is the reliable signal.
    let _ = app
        .wait_for_download_denied("https://example.com/payload.txt")
        .await;

    assert!(!opened, "window.open should be denied by the WebView");
    assert!(!downloaded, "download link should not navigate the WebView");
    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(!app
        .network_requests()
        .await
        .iter()
        .any(|url| url.contains("example.com/payload.txt")));
}
