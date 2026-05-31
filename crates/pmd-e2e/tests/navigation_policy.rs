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
    assert!(app.external_open_log().await.is_empty());

    app.confirm_external_link()
        .await
        .expect("confirm external link");
    assert!(app
        .external_open_log()
        .await
        .iter()
        .any(|url| url == "https://example.com/path"));
}
