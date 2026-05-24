use pmd_app_lib::cmd::theme::{list_themes, set_theme};

#[tokio::test]
async fn list_themes_returns_at_least_github_light_and_dark() {
    let themes = list_themes().expect("list_themes should succeed");
    assert!(!themes.is_empty(), "expected at least one theme");

    let slugs: Vec<_> = themes.iter().map(|t| t.slug.as_str()).collect();
    assert!(
        slugs.contains(&"github-light"),
        "expected github-light in themes: {slugs:?}"
    );
    assert!(
        slugs.contains(&"github-dark"),
        "expected github-dark in themes: {slugs:?}"
    );
}

#[tokio::test]
async fn set_theme_returns_css_bundle_for_github_light() {
    let bundle = set_theme("github-light".to_string()).expect("set_theme should succeed");
    assert!(!bundle.css.is_empty(), "expected non-empty CSS");
    assert!(
        bundle.css.contains("--pmd-bg"),
        "expected CSS variables in bundle"
    );
    assert!(
        bundle.mermaid_vars.contains_key("primary"),
        "expected mermaid vars"
    );
}

#[tokio::test]
async fn set_theme_returns_error_for_unknown_theme() {
    let result = set_theme("nonexistent-theme".to_string());
    assert!(result.is_err(), "expected error for unknown theme");
}
