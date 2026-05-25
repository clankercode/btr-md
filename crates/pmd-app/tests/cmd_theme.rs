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
        bundle.mermaid_vars.contains_key("primaryColor"),
        "expected mermaid vars"
    );
    // The UI needs the resolved mode so it can mirror it onto
    // `<html data-theme>`; design-system tokens key off that attribute.
    assert_eq!(
        bundle.mode, "light",
        "expected github-light to report mode=light"
    );
}

#[tokio::test]
async fn set_theme_reports_dark_mode_for_dark_theme() {
    let bundle = set_theme("github-dark".to_string()).expect("set_theme should succeed");
    assert_eq!(
        bundle.mode, "dark",
        "expected github-dark to report mode=dark"
    );
}

#[tokio::test]
async fn set_theme_emits_css_variables_used_by_stylesheets() {
    let bundle = set_theme("github-light".to_string()).expect("set_theme should succeed");
    for name in [
        "--pmd-bg-elevated",
        "--pmd-fg-muted",
        "--pmd-inline-code-bg",
        "--pmd-code-block-fg",
        "--pmd-mermaid-edge-label-bg",
    ] {
        assert!(bundle.css.contains(name), "expected CSS variable {name}");
    }
    assert!(
        !bundle.css.contains("--pmd-bg_elevated"),
        "theme CSS should use hyphenated custom property names"
    );
}

#[tokio::test]
async fn set_theme_maps_mermaid_vars_to_mermaid_api_names() {
    let bundle = set_theme("github-light".to_string()).expect("set_theme should succeed");
    for name in [
        "primaryColor",
        "primaryTextColor",
        "secondaryColor",
        "tertiaryColor",
        "lineColor",
        "background",
        "edgeLabelBackground",
        "clusterBkg",
        "noteBkgColor",
        "noteBorderColor",
        "actorBkg",
        "errorBkgColor",
    ] {
        assert!(
            bundle.mermaid_vars.contains_key(name),
            "expected Mermaid theme variable {name}"
        );
    }
}

#[tokio::test]
async fn set_theme_returns_error_for_unknown_theme() {
    let result = set_theme("nonexistent-theme".to_string());
    assert!(result.is_err(), "expected error for unknown theme");
}

#[tokio::test]
async fn set_theme_rejects_path_traversal_slug() {
    // A slug that tries to escape the theme root must be refused before any
    // filesystem lookup; otherwise an attacker-supplied manifest could be
    // loaded from outside the trusted theme directories.
    for slug in [
        "../etc",
        "..",
        ".",
        "./github-light",
        "github-light/../github-dark",
        "github light",
        "github-light\0",
    ] {
        let result = set_theme(slug.to_string());
        assert!(
            result.is_err(),
            "expected slug `{slug}` to be rejected, got: {result:?}"
        );
    }
}
