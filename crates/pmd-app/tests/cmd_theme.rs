use pmd_app_lib::cmd::theme::{list_themes_from_roots, set_theme_from_roots};
use std::path::PathBuf;

fn workspace_theme_roots() -> Vec<PathBuf> {
    vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("themes")]
}

fn github_light_manifest_for(slug: &str, name: &str) -> String {
    include_str!("../../../themes/github-light/manifest.toml")
        .replace("name = \"GitHub Light\"", &format!("name = \"{name}\""))
        .replace("slug = \"github-light\"", &format!("slug = \"{slug}\""))
}

fn write_theme(root: &std::path::Path, slug: &str, name: &str, extra_css: &str) {
    let theme_dir = root.join(slug);
    std::fs::create_dir_all(&theme_dir).expect("create theme dir");
    std::fs::write(
        theme_dir.join("manifest.toml"),
        github_light_manifest_for(slug, name),
    )
    .expect("write manifest");
    std::fs::write(theme_dir.join("theme.css"), extra_css).expect("write theme css");
}

#[tokio::test]
async fn list_themes_returns_at_least_github_light_and_dark() {
    let themes =
        list_themes_from_roots(&workspace_theme_roots()).expect("list_themes should succeed");
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
    let bundle = set_theme_from_roots("github-light", &workspace_theme_roots())
        .expect("set_theme should succeed");
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
    let bundle = set_theme_from_roots("github-dark", &workspace_theme_roots())
        .expect("set_theme should succeed");
    assert_eq!(
        bundle.mode, "dark",
        "expected github-dark to report mode=dark"
    );
}

#[tokio::test]
async fn set_theme_emits_css_variables_used_by_stylesheets() {
    let bundle = set_theme_from_roots("github-light", &workspace_theme_roots())
        .expect("set_theme should succeed");
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
    let bundle = set_theme_from_roots("github-light", &workspace_theme_roots())
        .expect("set_theme should succeed");
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
    let result = set_theme_from_roots("nonexistent-theme", &workspace_theme_roots());
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
        let result = set_theme_from_roots(slug, &workspace_theme_roots());
        assert!(
            result.is_err(),
            "expected slug `{slug}` to be rejected, got: {result:?}"
        );
    }
}

#[tokio::test]
async fn list_and_apply_theme_dedupe_by_first_root() {
    let first = tempfile::tempdir().expect("first root");
    let second = tempfile::tempdir().expect("second root");
    let first_root = first.path().join("themes");
    let second_root = second.path().join("themes");
    write_theme(
        &first_root,
        "duplicate-theme",
        "First Root",
        "/* first-root-theme */\n",
    );
    write_theme(
        &second_root,
        "duplicate-theme",
        "Second Root",
        "/* second-root-theme */\n",
    );
    let roots = vec![first_root, second_root];

    let themes = list_themes_from_roots(&roots).expect("list themes");
    let duplicates: Vec<_> = themes
        .iter()
        .filter(|theme| theme.slug == "duplicate-theme")
        .collect();

    assert_eq!(duplicates.len(), 1, "expected duplicate slug to be deduped");
    assert_eq!(duplicates[0].name, "First Root");

    let bundle = set_theme_from_roots("duplicate-theme", &roots).expect("set theme");
    assert!(bundle.css.contains("first-root-theme"));
    assert!(!bundle.css.contains("second-root-theme"));
}

#[tokio::test]
async fn set_theme_normalizes_bare_hex_values_before_emitting_css() {
    let temp = tempfile::tempdir().expect("theme root");
    let root = temp.path().join("themes");
    let slug = "bare-hex";
    let theme_dir = root.join(slug);
    std::fs::create_dir_all(&theme_dir).expect("create theme dir");
    let manifest = github_light_manifest_for(slug, "Bare Hex").replace("\"#", "\"");
    std::fs::write(theme_dir.join("manifest.toml"), manifest).expect("write manifest");

    let bundle = set_theme_from_roots(slug, &[root]).expect("set theme");

    assert!(bundle.css.contains("--pmd-bg: #ffffff;"));
    assert!(bundle.css.contains("--pmd-syntax-keyword: #cf222e;"));
    assert_eq!(
        bundle.mermaid_vars.get("background").map(String::as_str),
        Some("#ffffff")
    );
    assert!(
        !bundle.css.contains("--pmd-bg: ffffff;"),
        "bare hex must not be emitted into CSS"
    );
}
