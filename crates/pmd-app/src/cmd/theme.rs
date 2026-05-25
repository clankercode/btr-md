use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct ThemeInfo {
    pub slug: String,
    pub name: String,
    pub mode: String,
    pub inspired_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_fg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_accent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_bg_elevated: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeBundle {
    pub css: String,
    pub mermaid_vars: BTreeMap<String, String>,
    /// Theme mode (`"light"` or `"dark"`). The UI mirrors this onto
    /// `<html data-theme="…">` so design-system tokens keyed on the
    /// attribute resolve to the correct variant.
    pub mode: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Read a file at `path` only if its canonicalised location is contained
/// by `base_canon`. Returns `None` if the file does not exist, cannot be
/// canonicalised, points outside `base_canon` (i.e. is a symlink escape),
/// or cannot be read. Used to refuse symlinked `manifest.toml` /
/// `theme.css` entries inside an otherwise safe-named theme directory.
fn read_contained_file(path: &std::path::Path, base_canon: &std::path::Path) -> Option<String> {
    let canon = path.canonicalize().ok()?;
    if !canon.starts_with(base_canon) {
        return None;
    }
    std::fs::read_to_string(&canon).ok()
}

/// A theme slug is a single directory name. Reject anything that could
/// escape the theme root (path separators, parent traversal, leading dot)
/// or that isn't a small set of safe ASCII characters.
fn is_safe_slug(slug: &str) -> bool {
    if slug.is_empty() || slug.len() > 64 {
        return false;
    }
    if slug == "." || slug == ".." || slug.starts_with('.') {
        return false;
    }
    slug.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn theme_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundle = parent.parent().unwrap_or(parent);
            let themes = bundle.join("themes");
            if themes.is_dir() {
                dirs.push(themes);
            }
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = std::path::Path::new(&manifest);
        // Walk two levels up to the workspace root. A malformed env var
        // (e.g. just "/" or "themes") would have <2 parents; skip rather
        // than panic.
        if let Some(workspace_root) = manifest_path.parent().and_then(|p| p.parent()) {
            let themes = workspace_root.join("themes");
            if themes.is_dir() {
                dirs.push(themes);
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let user_theme = std::path::Path::new(&home)
            .join(".config")
            .join("preview-md")
            .join("themes");
        if user_theme.is_dir() {
            dirs.push(user_theme);
        }
    }

    dirs
}

#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemeInfo>, String> {
    let mut themes = Vec::new();
    for base in theme_dirs() {
        // Canonicalise the base so the per-entry containment check below
        // works through any symlinks in the base path itself.
        let Ok(base_canon) = base.canonicalize() else {
            continue;
        };
        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_path = path.join("manifest.toml");
                    if manifest_path.exists() {
                        let Some(slug) = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .filter(|s| is_safe_slug(s))
                            .map(|s| s.to_string())
                        else {
                            continue;
                        };

                        // Refuse symlinks that escape the trusted base — a
                        // safe-named entry could point to a manifest outside
                        // the theme root and we'd surface that as if it were
                        // a built-in theme.
                        let Ok(path_canon) = path.canonicalize() else {
                            continue;
                        };
                        if !path_canon.starts_with(&base_canon) {
                            continue;
                        }

                        // Read the manifest only if it canonicalises inside
                        // the trusted base — guards against a symlinked
                        // manifest.toml pointing outside the theme root.
                        if let Some(content) = read_contained_file(&manifest_path, &base_canon) {
                            if let Ok(theme) = pmd_core::theme::parse_manifest(&content) {
                                let inspired_by = theme.meta.inspired_by.as_ref().and_then(|i| {
                                    i.work
                                        .as_ref()
                                        .or(i.character.as_ref())
                                        .cloned()
                                        .filter(|s| !s.is_empty())
                                });
                                themes.push(ThemeInfo {
                                    slug,
                                    name: theme.meta.name,
                                    mode: theme.meta.mode.clone(),
                                    inspired_by,
                                    preview_bg: theme.palette.colours.get("bg").cloned(),
                                    preview_fg: theme.palette.colours.get("fg").cloned(),
                                    preview_accent: theme.palette.colours.get("accent").cloned(),
                                    preview_bg_elevated: theme
                                        .palette
                                        .colours
                                        .get("bg_elevated")
                                        .cloned(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(themes)
}

#[tauri::command]
pub fn set_theme(slug: String) -> Result<ThemeBundle, String> {
    let (theme_dir, base_canon) =
        find_theme_dir(&slug).ok_or_else(|| format!("theme not found: {}", slug))?;
    let manifest_path = theme_dir.join("manifest.toml");

    // Read the manifest only if it canonicalises inside the trusted base
    // (i.e. it is not a symlink escaping the theme root).
    let manifest_content = read_contained_file(&manifest_path, &base_canon).ok_or_else(|| {
        format!(
            "read manifest: {} not inside theme root",
            manifest_path.display()
        )
    })?;
    let theme = pmd_core::theme::parse_manifest(&manifest_content)
        .map_err(|e| format!("parse manifest: {}", e))?;

    let mut warnings = Vec::new();
    if let Err(e) = pmd_core::theme::validate::validate(&theme) {
        if e.is_fatal() {
            return Err(format!("theme validation: {}", e));
        }
        warnings.push(format!("WCAG contrast issue: {}", e));
    }

    let css_path = theme_dir.join("theme.css");
    // theme.css is optional. When present, it is concatenated raw into the
    // emitted CSS so it must also pass the containment check — a symlinked
    // theme.css pointing to attacker-controlled content would otherwise
    // inject arbitrary CSS.
    let extra_css = if css_path.exists() {
        match read_contained_file(&css_path, &base_canon) {
            Some(s) => s,
            None => {
                warnings
                    .push("theme.css rejected: not inside theme root or unreadable".to_string());
                String::new()
            }
        }
    } else {
        String::new()
    };

    // Palette/syntax keys come from the manifest's TOML map and are emitted
    // verbatim into `--pmd-<key>` / `--pmd-syntax-<key>`. A quoted TOML key
    // could contain `:`, `;`, `}` etc. and break out of the `:root { … }`
    // block, so restrict to a strict CSS-ident character set after the
    // underscore->hyphen rewrite.
    let safe_css_ident = |s: &str| -> bool {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };

    let mut css_vars = String::from(":root {\n");
    for (k, v) in &theme.palette.colours {
        let css_key = k.replace('_', "-");
        if !safe_css_ident(&css_key) {
            warnings.push(format!("palette key `{k}` rejected (unsafe characters)"));
            continue;
        }
        css_vars.push_str(&format!("  --pmd-{css_key}: {v};\n"));
    }
    for (k, v) in &theme.palette.syntax {
        let css_key = k.replace('_', "-");
        if !safe_css_ident(&css_key) {
            warnings.push(format!("syntax key `{k}` rejected (unsafe characters)"));
            continue;
        }
        css_vars.push_str(&format!("  --pmd-syntax-{css_key}: {v};\n"));
    }

    // Font values are user-supplied and emitted unescaped into CSS. Reject
    // anything containing characters that would let a malicious manifest
    // close the declaration / rule block and inject new CSS.
    let safe_font = |s: &str| -> bool {
        !s.chars()
            .any(|c| matches!(c, ';' | '{' | '}' | '<' | '>' | '\n' | '\r'))
    };
    let mut push_font = |key: &str, value: &Option<String>| {
        if let Some(v) = value {
            if safe_font(v) {
                css_vars.push_str(&format!("  --pmd-font-{key}: {v};\n"));
            } else {
                warnings.push(format!("font.{key} rejected (unsafe characters)"));
            }
        }
    };
    push_font("ui", &theme.fonts.ui);
    push_font("mono", &theme.fonts.mono);
    push_font("serif", &theme.fonts.serif);
    push_font("heading", &theme.fonts.heading);
    push_font("body", &theme.fonts.body);

    let derive_mermaid = |key: &str, fallback: Option<&str>| -> Option<String> {
        if theme.palette.colours.contains_key(key) {
            return None;
        }
        fallback.map(|s| s.to_string())
    };

    let bg = theme.palette.colours.get("bg");
    let bg_elevated = theme.palette.colours.get("bg_elevated");
    let fg = theme.palette.colours.get("fg");
    let accent = theme.palette.colours.get("accent");

    if let (Some(bg), Some(bg_elevated), Some(fg), Some(accent)) = (bg, bg_elevated, fg, accent) {
        if let (Some(bg_rgb), Some(bg_elevated_rgb), Some(fg_rgb), Some(accent_rgb)) = (
            pmd_core::theme::mix::parse_hex(bg),
            pmd_core::theme::mix::parse_hex(bg_elevated),
            pmd_core::theme::mix::parse_hex(fg),
            pmd_core::theme::mix::parse_hex(accent),
        ) {
            if let Some(v) = derive_mermaid("mermaid_edge_label_bg", Some(bg_elevated)) {
                css_vars.push_str(&format!("  --pmd-mermaid-edge-label-bg: {};\n", v));
            }
            if !theme.palette.colours.contains_key("mermaid_cluster_bg") {
                let mixed = pmd_core::theme::mix::mix(bg_elevated_rgb, fg_rgb, 0.04);
                css_vars.push_str(&format!(
                    "  --pmd-mermaid-cluster-bg: {};\n",
                    pmd_core::theme::mix::to_hex(mixed)
                ));
            }
            if let Some(v) = derive_mermaid("mermaid_note_bg", Some(bg_elevated)) {
                css_vars.push_str(&format!("  --pmd-mermaid-note-bg: {};\n", v));
            }
            if let Some(v) = derive_mermaid("mermaid_note_border", Some(accent)) {
                css_vars.push_str(&format!("  --pmd-mermaid-note-border: {};\n", v));
            }
            if !theme.palette.colours.contains_key("mermaid_actor_bg") {
                let mixed = pmd_core::theme::mix::mix(accent_rgb, bg_rgb, 0.30);
                css_vars.push_str(&format!(
                    "  --pmd-mermaid-actor-bg: {};\n",
                    pmd_core::theme::mix::to_hex(mixed)
                ));
            }
            if derive_mermaid("mermaid_error", Some("#e77878")).is_some() {
                css_vars.push_str("  --pmd-mermaid-error: #e77878;\n");
            }
        }
    }

    // Derive theme-aware interaction colors that themes rarely set explicitly.
    // accent_hover: shift the accent toward fg slightly (darker for light themes,
    // brighter for dark themes). ring: translucent accent for focus outlines.
    if !theme.palette.colours.contains_key("accent_hover") {
        if let (Some(accent), Some(fg)) = (
            theme.palette.colours.get("accent"),
            theme.palette.colours.get("fg"),
        ) {
            if let (Some(accent_rgb), Some(fg_rgb)) = (
                pmd_core::theme::mix::parse_hex(accent),
                pmd_core::theme::mix::parse_hex(fg),
            ) {
                let hover = pmd_core::theme::mix::mix(accent_rgb, fg_rgb, 0.18);
                css_vars.push_str(&format!(
                    "  --pmd-accent-hover: {};\n",
                    pmd_core::theme::mix::to_hex(hover)
                ));
            }
        }
    }

    if !theme.palette.colours.contains_key("ring") {
        if let Some(accent) = theme.palette.colours.get("accent") {
            if let Some((r, g, b)) = pmd_core::theme::mix::parse_hex(accent) {
                css_vars.push_str(&format!("  --pmd-ring: rgba({}, {}, {}, 0.3);\n", r, g, b));
            }
        }
    }

    // Themes without bg_muted fall back to bg_elevated so the muted token
    // always resolves to *something* sensible.
    if !theme.palette.colours.contains_key("bg_muted") {
        if let Some(bg_elevated) = theme.palette.colours.get("bg_elevated") {
            css_vars.push_str(&format!("  --pmd-bg-muted: {};\n", bg_elevated));
        }
    }

    css_vars.push_str("}\n");

    // Emit `color-scheme` so native UI (scrollbars, form controls) matches.
    // The `[data-theme="…"]` attribute used by design-system.css is set by
    // the JS layer when this bundle is applied — CSS itself cannot mutate
    // attributes.
    let mode = theme.meta.mode.as_str();
    if mode == "light" || mode == "dark" {
        css_vars.push_str(&format!("html {{ color-scheme: {}; }}\n", mode));
    }

    css_vars.push_str(&extra_css);

    let mut mermaid_vars = BTreeMap::new();

    let mermaid_map: [(&str, &str); 5] = [
        ("mermaid_primary", "primaryColor"),
        ("mermaid_primary_text", "primaryTextColor"),
        ("mermaid_secondary", "secondaryColor"),
        ("mermaid_tertiary", "tertiaryColor"),
        ("mermaid_line", "lineColor"),
    ];
    for (key, mermaid_key) in &mermaid_map {
        if let Some(v) = theme.palette.colours.get(*key) {
            mermaid_vars.insert(mermaid_key.to_string(), v.clone());
        }
    }

    if let Some(bg) = theme.palette.colours.get("bg") {
        mermaid_vars.insert("background".to_string(), bg.clone());
    }

    let get_or_derive_str = |key: &str, fallback: Option<&str>| -> Option<String> {
        if let Some(v) = theme.palette.colours.get(key) {
            Some(v.clone())
        } else {
            fallback.map(|s| s.to_string())
        }
    };

    if let Some(v) = get_or_derive_str(
        "mermaid_edge_label_bg",
        bg_elevated.as_ref().map(|s| s.as_str()),
    ) {
        mermaid_vars.insert("edgeLabelBackground".to_string(), v);
    }
    if let Some(v) = theme.palette.colours.get("mermaid_cluster_bg") {
        mermaid_vars.insert("clusterBkg".to_string(), v.clone());
    }
    if !mermaid_vars.contains_key("clusterBkg") {
        if let (Some(bg_elevated), Some(fg)) = (bg_elevated, fg) {
            if let (Some(bg_rgb), Some(fg_rgb)) = (
                pmd_core::theme::mix::parse_hex(bg_elevated),
                pmd_core::theme::mix::parse_hex(fg),
            ) {
                let mixed = pmd_core::theme::mix::mix(bg_rgb, fg_rgb, 0.04);
                mermaid_vars.insert(
                    "clusterBkg".to_string(),
                    pmd_core::theme::mix::to_hex(mixed),
                );
            }
        }
    }
    if let Some(v) = get_or_derive_str("mermaid_note_bg", bg_elevated.as_ref().map(|s| s.as_str()))
    {
        mermaid_vars.insert("noteBkgColor".to_string(), v);
    }
    if let Some(v) = get_or_derive_str("mermaid_note_border", accent.as_ref().map(|s| s.as_str())) {
        mermaid_vars.insert("noteBorderColor".to_string(), v);
    }
    if let Some(v) = theme.palette.colours.get("mermaid_actor_bg") {
        mermaid_vars.insert("actorBkg".to_string(), v.clone());
    }
    if !mermaid_vars.contains_key("actorBkg") {
        if let (Some(accent), Some(bg)) = (accent, bg) {
            if let (Some(accent_rgb), Some(bg_rgb)) = (
                pmd_core::theme::mix::parse_hex(accent),
                pmd_core::theme::mix::parse_hex(bg),
            ) {
                let mixed = pmd_core::theme::mix::mix(accent_rgb, bg_rgb, 0.30);
                mermaid_vars.insert("actorBkg".to_string(), pmd_core::theme::mix::to_hex(mixed));
            }
        }
    }
    if let Some(v) = get_or_derive_str("mermaid_error", Some("#e77878")) {
        mermaid_vars.insert("errorBkgColor".to_string(), v);
    }

    Ok(ThemeBundle {
        css: css_vars,
        mermaid_vars,
        mode: theme.meta.mode.as_str().to_string(),
        warnings,
    })
}

/// Locate a theme directory by slug and return both its canonical path
/// and the canonical theme-root it belongs to. Callers need the root so
/// they can re-check containment when reading individual files inside
/// the theme (manifest.toml, theme.css) — guarding against symlinks that
/// escape the trusted root even if the directory itself is well-named.
fn find_theme_dir(slug: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    if !is_safe_slug(slug) {
        return None;
    }
    for base in theme_dirs() {
        let path = base.join(slug);
        if !path.is_dir() || !path.join("manifest.toml").exists() {
            continue;
        }
        // Defence in depth: even though `is_safe_slug` already excludes
        // separators and parent components, confirm via canonicalisation
        // that the resolved theme path is contained by its declared base.
        let (path_canon, base_canon) = match (path.canonicalize(), base.canonicalize()) {
            (Ok(p), Ok(b)) => (p, b),
            _ => continue,
        };
        if path_canon.starts_with(&base_canon) {
            return Some((path_canon, base_canon));
        }
    }
    None
}
