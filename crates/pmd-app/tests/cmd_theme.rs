use pmd_app_lib::cmd::theme::{find_theme_roots, list_themes_from_roots, set_theme_from_roots};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

fn process_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

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

#[test]
fn find_theme_roots_includes_appimage_appdir_share_path() {
    let _guard = process_env_lock();
    let temp = tempfile::tempdir().expect("appdir");
    let appdir_theme_root = temp.path().join("usr/share/btr-md/themes");
    std::fs::create_dir_all(&appdir_theme_root).expect("create appdir theme root");
    let previous = std::env::var_os("APPDIR");
    std::env::set_var("APPDIR", temp.path());

    let roots = find_theme_roots(None);

    if let Some(previous) = previous {
        std::env::set_var("APPDIR", previous);
    } else {
        std::env::remove_var("APPDIR");
    }
    assert!(
        roots.iter().any(|root| root == &appdir_theme_root),
        "expected APPDIR theme root in {roots:?}"
    );
}

#[test]
fn find_theme_roots_includes_xdg_data_home_install_path() {
    let _guard = process_env_lock();
    let temp = tempfile::tempdir().expect("data home");
    let data_theme_root = temp.path().join("btr-md/themes");
    std::fs::create_dir_all(&data_theme_root).expect("create data theme root");
    let previous = std::env::var_os("XDG_DATA_HOME");
    std::env::set_var("XDG_DATA_HOME", temp.path());

    let roots = find_theme_roots(None);

    if let Some(previous) = previous {
        std::env::set_var("XDG_DATA_HOME", previous);
    } else {
        std::env::remove_var("XDG_DATA_HOME");
    }
    assert!(
        roots.iter().any(|root| root == &data_theme_root),
        "expected XDG_DATA_HOME theme root in {roots:?}"
    );
}

#[test]
fn find_theme_roots_discovers_workspace_themes_from_crate_dir() {
    let _guard = process_env_lock();
    let previous_cwd = std::env::current_dir().expect("current dir");
    let previous_theme_root = std::env::var_os("BTR_MD_THEME_ROOT");
    std::env::remove_var("BTR_MD_THEME_ROOT");
    std::env::set_current_dir(env!("CARGO_MANIFEST_DIR")).expect("enter app crate dir");

    let roots = find_theme_roots(None);

    std::env::set_current_dir(previous_cwd).expect("restore cwd");
    if let Some(previous_theme_root) = previous_theme_root {
        std::env::set_var("BTR_MD_THEME_ROOT", previous_theme_root);
    }
    let workspace_themes = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("themes");
    assert!(
        roots.iter().any(|root| root == &workspace_themes),
        "expected workspace theme root in {roots:?}"
    );
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
        // The folder sidebar paints its panel with `--pmd-surface`; the bundle
        // must emit it (derived from bg_elevated when the palette omits it) so
        // the sidebar re-themes with the active theme instead of keeping the
        // static design-system value keyed only on [data-theme].
        "--pmd-surface",
        // Menu hover uses --pmd-bg-muted against elevated panels; must be emitted.
        "--pmd-bg-muted",
        "--pmd-inline-code-bg",
        "--pmd-code-block-fg",
        "--pmd-mermaid-edge-label-bg",
        "--pmd-selection-bg",
        "--pmd-selection-fg",
    ] {
        assert!(bundle.css.contains(name), "expected CSS variable {name}");
    }
    assert!(
        !bundle.css.contains("--pmd-bg_elevated"),
        "theme CSS should use hyphenated custom property names"
    );
}

/// Menu/dropdown hover paints with `--pmd-bg-muted` on an elevated panel. When
/// a theme omits `bg_muted`, emission must derive a colour distinct from
/// `bg_elevated` — otherwise hover is invisible.
#[tokio::test]
async fn set_theme_derives_bg_muted_distinct_from_bg_elevated() {
    for slug in ["github-light", "github-dark", "grok-night", "grok-day"] {
        let bundle =
            set_theme_from_roots(slug, &workspace_theme_roots()).expect("set_theme should succeed");
        let elevated = extract_css_var(&bundle.css, "--pmd-bg-elevated")
            .unwrap_or_else(|| panic!("{slug}: missing --pmd-bg-elevated"));
        let muted = extract_css_var(&bundle.css, "--pmd-bg-muted")
            .unwrap_or_else(|| panic!("{slug}: missing --pmd-bg-muted"));
        assert_ne!(
            muted, elevated,
            "{slug}: --pmd-bg-muted ({muted}) must differ from --pmd-bg-elevated ({elevated}) for visible menu hover"
        );
    }
}

fn extract_css_var(css: &str, name: &str) -> Option<String> {
    for line in css.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(name) {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix(':') {
                let value = rest.trim().trim_end_matches(';').trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Preview selection relies on native `::selection`. Theme palettes use solid
/// selection_bg + inverted selection_fg; the bundle must emit those as
/// concrete colours (not only CSS variables) so WebKitGTK cannot fall back to
/// its washed default while leaving text on the unselected colour.
#[tokio::test]
async fn set_theme_emits_concrete_selection_highlight_rule() {
    let light = set_theme_from_roots("github-light", &workspace_theme_roots())
        .expect("set_theme github-light");
    // github-light: selection_bg = #1f2328, selection_fg = #ffffff
    assert!(
        light.css.contains("::selection"),
        "expected ::selection rule in theme CSS"
    );
    assert!(
        light.css.contains("html[data-theme=\"dark\"] ::selection")
            || light.css.contains("html[data-theme=\"light\"] ::selection"),
        "expected data-theme-scoped ::selection so design-system dark fallbacks are overridden"
    );
    assert!(
        light.css.contains("background-color: #1f2328;"),
        "expected concrete selection_bg hex in ::selection, got:\n{}",
        light.css
    );
    assert!(
        light.css.contains("color: #ffffff;"),
        "expected concrete selection_fg hex in ::selection"
    );
    assert!(
        light.css.contains("-webkit-text-fill-color: #ffffff;"),
        "expected -webkit-text-fill-color so fill-color tricks do not keep unselected ink"
    );

    let dark = set_theme_from_roots("github-dark", &workspace_theme_roots())
        .expect("set_theme github-dark");
    // github-dark: selection_bg = #f0f3f6, selection_fg = #0d1117
    assert!(
        dark.css.contains("background-color: #f0f3f6;"),
        "expected github-dark selection_bg in ::selection, got:\n{}",
        dark.css
    );
    assert!(
        dark.css.contains("color: #0d1117;"),
        "expected github-dark selection_fg in ::selection"
    );
    // Must not rely solely on var() inside the highlight rule (WebKitGTK).
    let selection_block = dark
        .css
        .split("/* Selection highlight")
        .nth(1)
        .expect("selection comment marker");
    assert!(
        !selection_block.contains("var(--pmd-selection"),
        "selection highlight rule must use concrete hex, not var()"
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

// --- Mermaid contrast regression -----------------------------------------
//
// Every theme previously set `mermaid_primary` (node fill) equal to
// `mermaid_primary_text` (node label), both = `fg`, so labels rendered the
// same colour as their fill and were invisible. set_theme now derives the
// fill from `bg_elevated` and the text from `fg`. Pin that every bundled
// theme produces a node fill / label pair that clears WCAG AA (4.5:1), so a
// future theme or refactor cannot silently reintroduce unreadable diagrams.

fn relative_luminance(hex: &str) -> f64 {
    let h = hex.strip_prefix('#').unwrap_or(hex);
    let parse = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
    let (r, g, b) = (parse(0), parse(2), parse(4));
    let ch = |v: u8| {
        let s = (v as f64) / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

fn contrast_ratio(a: &str, b: &str) -> f64 {
    let (la, lb) = (relative_luminance(a), relative_luminance(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

#[test]
fn every_bundled_theme_has_readable_mermaid_nodes() {
    let roots = workspace_theme_roots();
    let themes = list_themes_from_roots(&roots).expect("list themes");
    assert!(!themes.is_empty(), "expected bundled themes");
    // Every filled surface a mermaid label sits on, paired with the label
    // colour the derivation assigns to it. All must clear WCAG AA so no
    // node tier (primary/secondary/tertiary) or note reintroduces the
    // same-colour-as-fill bug — including via a retained palette override.
    let pairs = [
        ("primaryColor", "primaryTextColor"),
        ("secondaryColor", "secondaryTextColor"),
        ("tertiaryColor", "tertiaryTextColor"),
        ("noteBkgColor", "noteTextColor"),
        ("actorBkg", "actorTextColor"),
        ("labelBoxBkgColor", "labelTextColor"),
        ("errorBkgColor", "errorTextColor"),
        ("taskBkgColor", "taskTextColor"),
        ("activeTaskBkgColor", "taskTextColor"),
        ("doneTaskBkgColor", "taskTextColor"),
        ("critBkgColor", "taskTextColor"),
        ("sectionBkgColor", "sectionTextColor"),
        ("clusterBkg", "titleColor"),
        ("quadrant1Fill", "quadrant1TextFill"),
        ("quadrant2Fill", "quadrant2TextFill"),
        ("quadrant3Fill", "quadrant3TextFill"),
        ("quadrant4Fill", "quadrant4TextFill"),
    ];
    for theme in &themes {
        let bundle = set_theme_from_roots(&theme.slug, &roots)
            .unwrap_or_else(|e| panic!("set_theme {} failed: {e}", theme.slug));
        for (fill_key, text_key) in pairs {
            let fill = bundle
                .mermaid_vars
                .get(fill_key)
                .unwrap_or_else(|| panic!("{} missing {fill_key}", theme.slug));
            let text = bundle
                .mermaid_vars
                .get(text_key)
                .unwrap_or_else(|| panic!("{} missing {text_key}", theme.slug));
            let ratio = contrast_ratio(fill, text);
            assert!(
                ratio >= 4.5,
                "{}: mermaid {fill_key} {fill} vs {text_key} {text} is {ratio:.2}:1, below AA 4.5:1",
                theme.slug
            );
        }
    }
}
