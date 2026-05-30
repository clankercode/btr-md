use pmd_app_lib::cmd::render::render_cmd;

#[tokio::test]
async fn render_returns_versioned_html() {
    let r = render_cmd(7, "hello".into()).await.unwrap();
    assert_eq!(r.version, 7);
    assert!(r.html.contains("hello"));
    assert!(r.html.contains("data-src-start"));
    assert!(r.facts.counts.words > 0);
}
