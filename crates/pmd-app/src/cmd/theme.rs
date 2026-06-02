use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};
use tauri::Manager;

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

fn push_existing_dir(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if dir.is_dir() && !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

fn user_theme_dir() -> Option<PathBuf> {
    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(config_home).join("btr-md").join("themes"));
    }
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".config")
            .join("btr-md")
            .join("themes")
    })
}

/// `$XDG_DATA_HOME/btr-md/themes` (≈ `~/.local/share/btr-md/themes`) — where a
/// user-level install (`just install`) places the bundled themes, alongside the
/// desktop files. Without this a locally-installed binary finds no themes
/// (todo #2): its resource dir has none and the `/usr/share` system dirs are
/// only populated by a system package.
fn user_data_theme_dir() -> Option<PathBuf> {
    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
        return Some(PathBuf::from(data_home).join("btr-md").join("themes"));
    }
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("btr-md")
            .join("themes")
    })
}

fn appdir_theme_dir() -> Option<PathBuf> {
    std::env::var_os("APPDIR").map(|appdir| {
        PathBuf::from(appdir)
            .join("usr")
            .join("share")
            .join("btr-md")
            .join("themes")
    })
}

pub fn find_theme_roots(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // User themes are searched before bundled themes so a user can override
    // a built-in slug. list_themes dedupes with this same first-root-wins
    // order, keeping picker entries aligned with set_theme resolution.
    if let Some(user_themes) = user_theme_dir() {
        push_existing_dir(&mut dirs, user_themes);
    }

    // Themes installed by a user-level `just install` (todo #2).
    if let Some(data_themes) = user_data_theme_dir() {
        push_existing_dir(&mut dirs, data_themes);
    }

    if let Some(resource_dir) = resource_dir {
        push_existing_dir(&mut dirs, resource_dir.join("themes"));
    }

    if let Some(appdir_themes) = appdir_theme_dir() {
        push_existing_dir(&mut dirs, appdir_themes);
    }

    for system_dir in [
        PathBuf::from("/app/share/btr-md/themes"),
        PathBuf::from("/usr/local/share/btr-md/themes"),
        PathBuf::from("/usr/share/btr-md/themes"),
    ] {
        push_existing_dir(&mut dirs, system_dir);
    }

    if let Ok(cwd) = std::env::current_dir() {
        push_existing_dir(&mut dirs, cwd.join("themes"));
    }

    #[cfg(debug_assertions)]
    if let Ok(dev_root) = std::env::var("BTR_MD_THEME_ROOT") {
        push_existing_dir(&mut dirs, PathBuf::from(dev_root));
    }

    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        push_existing_dir(&mut dirs, manifest_dir.join("../..").join("themes"));
    }

    dirs
}

#[tauri::command]
pub fn list_themes(app: tauri::AppHandle) -> Result<Vec<ThemeInfo>, String> {
    let resource_dir = app.path().resource_dir().ok();
    list_themes_from_roots(&find_theme_roots(resource_dir.as_deref()))
}

pub fn list_themes_from_roots(roots: &[PathBuf]) -> Result<Vec<ThemeInfo>, String> {
    let mut themes = Vec::new();
    let mut seen = HashSet::new();
    for base in roots {
        // Canonicalise the base so the per-entry containment check below
        // works through any symlinks in the base path itself.
        let Ok(base_canon) = base.canonicalize() else {
            continue;
        };
        if let Ok(entries) = std::fs::read_dir(base) {
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
                        if !seen.insert(slug.clone()) {
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
                                    preview_bg: theme
                                        .palette
                                        .colours
                                        .get("bg")
                                        .and_then(|v| normalize_hex_colour(v)),
                                    preview_fg: theme
                                        .palette
                                        .colours
                                        .get("fg")
                                        .and_then(|v| normalize_hex_colour(v)),
                                    preview_accent: theme
                                        .palette
                                        .colours
                                        .get("accent")
                                        .and_then(|v| normalize_hex_colour(v)),
                                    preview_bg_elevated: theme
                                        .palette
                                        .colours
                                        .get("bg_elevated")
                                        .and_then(|v| normalize_hex_colour(v)),
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
pub fn set_theme(app: tauri::AppHandle, slug: String) -> Result<ThemeBundle, String> {
    let resource_dir = app.path().resource_dir().ok();
    set_theme_from_roots(&slug, &find_theme_roots(resource_dir.as_deref()))
}

pub fn set_theme_from_roots(slug: &str, roots: &[PathBuf]) -> Result<ThemeBundle, String> {
    let (theme_dir, base_canon) =
        find_theme_dir(slug, roots).ok_or_else(|| format!("theme not found: {}", slug))?;
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
    let colours = normalize_hex_map(&theme.palette.colours, "palette")?;
    let syntax_colours = normalize_hex_map(&theme.palette.syntax, "syntax")?;

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
    for (k, v) in &colours {
        let css_key = k.replace('_', "-");
        if !safe_css_ident(&css_key) {
            warnings.push(format!("palette key `{k}` rejected (unsafe characters)"));
            continue;
        }
        css_vars.push_str(&format!("  --pmd-{css_key}: {v};\n"));
    }
    for (k, v) in &syntax_colours {
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
        if colours.contains_key(key) {
            return None;
        }
        fallback.map(|s| s.to_string())
    };

    let bg = colours.get("bg");
    let bg_elevated = colours.get("bg_elevated");
    let fg = colours.get("fg");
    let accent = colours.get("accent");

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
            if !colours.contains_key("mermaid_cluster_bg") {
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
            if !colours.contains_key("mermaid_actor_bg") {
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
    if !colours.contains_key("accent_hover") {
        if let (Some(accent), Some(fg)) = (colours.get("accent"), colours.get("fg")) {
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

    if !colours.contains_key("ring") {
        if let Some(accent) = colours.get("accent") {
            if let Some((r, g, b)) = pmd_core::theme::mix::parse_hex(accent) {
                css_vars.push_str(&format!("  --pmd-ring: rgba({}, {}, {}, 0.3);\n", r, g, b));
            }
        }
    }

    // Themes without bg_muted fall back to bg_elevated so the muted token
    // always resolves to *something* sensible.
    if !colours.contains_key("bg_muted") {
        if let Some(bg_elevated) = colours.get("bg_elevated") {
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

    // --- Mermaid node colours --------------------------------------------
    //
    // Derive a readable default set from the core palette, each value
    // overridable by an explicit `mermaid_*` palette key. The node FILL comes
    // from the elevated surface and the node TEXT from `fg`, so a label always
    // contrasts with the node it sits in. Earlier themes set both
    // `mermaid_primary` (fill) and `mermaid_primary_text` (label) to `fg`,
    // which rendered labels the same colour as their fill — invisible. Lines
    // and borders use the muted/border tokens so edges read clearly on the
    // diagram background without overpowering it.
    let fg_muted = colours.get("fg_muted");
    let border = colours.get("border");

    // Mix `t` of the way from `a` toward `b`; falls back to `a` when present
    // but unparseable, and to `None` when `a` is absent.
    let mix_toward = |a: Option<&String>, b: Option<&String>, t: f64| -> Option<String> {
        let a = a?;
        match (
            b.and_then(|b| pmd_core::theme::mix::parse_hex(b)),
            pmd_core::theme::mix::parse_hex(a),
        ) {
            (Some(rb), Some(ra)) => Some(pmd_core::theme::mix::to_hex(pmd_core::theme::mix::mix(
                ra, rb, t,
            ))),
            _ => Some(a.clone()),
        }
    };

    // Explicit `mermaid_<key>` override, else the derived default.
    let pick = |key: &str, default: Option<String>| -> Option<String> {
        colours.get(key).cloned().or(default)
    };

    let node_fill = pick("mermaid_primary", bg_elevated.cloned());
    let node_text = pick("mermaid_primary_text", fg.cloned());
    let node_border = pick("mermaid_primary_border", border.cloned());
    let line_color = pick(
        "mermaid_line",
        fg_muted.cloned().or_else(|| border.cloned()),
    );
    // Secondary/tertiary fills, when not given, slide from the elevated
    // surface toward the base background. That axis stays on the far side of
    // `fg` from the surface, so the fills keep visible hierarchy in
    // multi-kind diagrams while their contrast with `fg` text is guaranteed:
    // both `bg` and `bg_elevated` clear AA against `fg`, and contrast is
    // monotonic in luminance, so every blend of them does too. (Mixing toward
    // `accent` instead can drop below AA on low-contrast themes — sepia's
    // accent-tinted secondary measured 3.77:1.)
    let secondary_fill = pick("mermaid_secondary", mix_toward(bg_elevated, bg, 0.50));
    let tertiary_fill = pick("mermaid_tertiary", mix_toward(bg_elevated, bg, 0.82));

    {
        let mut set = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                mermaid_vars.insert(k.to_string(), v.clone());
            }
        };
        set("primaryColor", &node_fill);
        set("mainBkg", &node_fill);
        set("primaryTextColor", &node_text);
        set("primaryBorderColor", &node_border);
        set("nodeBorder", &node_border);
        set("secondaryColor", &secondary_fill);
        set("secondaryTextColor", &node_text);
        set("secondaryBorderColor", &node_border);
        set("tertiaryColor", &tertiary_fill);
        set("tertiaryTextColor", &node_text);
        set("tertiaryBorderColor", &node_border);
        set("lineColor", &line_color);
        // Labels that sit on the diagram background (edge labels, titles,
        // general node text) also track `fg` so they stay readable.
        set("textColor", &node_text);
        set("nodeTextColor", &node_text);
        set("titleColor", &node_text);
        set("labelColor", &node_text);
        // Note bodies sit on `noteBkgColor` (derived from `bg_elevated`
        // below), the same surface as nodes, so `fg` text stays readable.
        set("noteTextColor", &node_text);
    }

    if let Some(bg) = colours.get("bg") {
        mermaid_vars.insert("background".to_string(), bg.clone());
    }

    let get_or_derive_str = |key: &str, fallback: Option<&str>| -> Option<String> {
        if let Some(v) = colours.get(key) {
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
    if let Some(v) = colours.get("mermaid_cluster_bg") {
        mermaid_vars.insert("clusterBkg".to_string(), v.clone());
    }
    if !mermaid_vars.contains_key("clusterBkg") {
        // Subgraph/cluster labels are drawn with `titleColor` (= `fg`) on this
        // fill, so it must sit on the bg_elevated↔bg axis (clear of `fg`).
        // Recede it toward the canvas so a cluster reads as a container behind
        // its nodes. Mixing toward `fg` instead dropped sepia to 4.37:1.
        if let Some(v) = mix_toward(bg_elevated, bg, 0.50) {
            mermaid_vars.insert("clusterBkg".to_string(), v);
        }
    }
    if let Some(border) = border {
        mermaid_vars.insert("clusterBorder".to_string(), border.clone());
    }
    if let Some(v) = get_or_derive_str("mermaid_note_bg", bg_elevated.as_ref().map(|s| s.as_str()))
    {
        mermaid_vars.insert("noteBkgColor".to_string(), v);
    }
    if let Some(v) = get_or_derive_str("mermaid_note_border", accent.as_ref().map(|s| s.as_str())) {
        mermaid_vars.insert("noteBorderColor".to_string(), v);
    }
    // Actors (sequence diagrams) are drawn like nodes: an elevated surface
    // with `fg` text, distinguished by an accent *border* rather than an
    // accent fill. An accent-coloured fill paired with Mermaid's default
    // `actorTextColor` (which falls back to `primaryTextColor` = `fg`) drops
    // below AA on many themes, so keep the colour on the border and the text
    // on a surface that contrasts with `fg`.
    if let Some(v) = get_or_derive_str("mermaid_actor_bg", bg_elevated.as_ref().map(|s| s.as_str()))
    {
        mermaid_vars.insert("actorBkg".to_string(), v);
    }
    if let Some(accent) = accent {
        mermaid_vars.insert("actorBorder".to_string(), accent.clone());
    }
    // Sequence label boxes default their fill to `actorBkg`; pin them to the
    // elevated surface so the label text below stays readable.
    if let Some(bg_elevated) = bg_elevated {
        mermaid_vars.insert("labelBoxBkgColor".to_string(), bg_elevated.clone());
    }
    // Actor, label-box, signal and loop text sit on a surface or on the
    // diagram background, both of which clear AA against `fg`.
    if let Some(fg) = fg {
        for key in [
            "actorTextColor",
            "labelTextColor",
            "loopTextColor",
            "signalTextColor",
        ] {
            mermaid_vars.insert(key.to_string(), fg.clone());
        }
    }
    if let Some(v) = get_or_derive_str("mermaid_error", Some("#e77878")) {
        mermaid_vars.insert("errorBkgColor".to_string(), v);
    }
    // The parse-error graphic uses a fixed light-red fill; its text would
    // otherwise default through `tertiaryTextColor` (= `fg`) and vanish on
    // many themes. Pin it to a fixed near-black so the pair is readable
    // regardless of theme.
    mermaid_vars
        .entry("errorTextColor".to_string())
        .or_insert_with(|| "#1a1a1a".to_string());

    // --- Gantt status tasks ----------------------------------------------
    //
    // Mermaid's Gantt theme defaults several task fills to *literal* colours
    // (`doneTaskBkgColor = lightgrey`, `critBkgColor = red`) and renders the
    // task text through `taskTextDarkColor` (= `textColor` = `fg`). That pairs
    // `fg` against a fixed mid-tone and falls below AA on many themes. Treat
    // tasks like nodes: fills are surfaces along the `bg_elevated`↔`bg` axis
    // (guaranteed to clear AA against `fg`), the status distinction moves to
    // the border, and every task-text variable tracks `fg`.
    if let Some(bg_elevated) = bg_elevated {
        mermaid_vars.insert("taskBkgColor".to_string(), bg_elevated.clone());
        // active tasks pop slightly toward the canvas; done tasks recede
        // further. Both stay on the bg_elevated↔bg axis, so `fg` text clears
        // AA (overwriting Mermaid's literal `lightgrey` done-task default).
        if let Some(v) = mix_toward(Some(bg_elevated), bg, 0.50) {
            mermaid_vars.insert("activeTaskBkgColor".to_string(), v);
        }
        if let Some(v) = mix_toward(Some(bg_elevated), bg, 0.82) {
            mermaid_vars.insert("doneTaskBkgColor".to_string(), v);
        }
        // section bands sit behind tasks — keep them as faint surfaces.
        mermaid_vars.insert("sectionBkgColor".to_string(), bg_elevated.clone());
        if let Some(v) = mix_toward(Some(bg_elevated), bg, 0.45) {
            mermaid_vars.insert("sectionBkgColor2".to_string(), v);
        }
        // critical tasks keep their fill on a surface (overwriting Mermaid's
        // literal `red`); the alarm signal moves to a fixed red border so the
        // task text stays readable.
        mermaid_vars.insert("critBkgColor".to_string(), bg_elevated.clone());
        mermaid_vars.insert("critBorderColor".to_string(), "#e06c75".to_string());
    }
    if let Some(accent) = accent {
        mermaid_vars.insert("activeTaskBorderColor".to_string(), accent.clone());
    }
    if let Some(border) = border {
        mermaid_vars.insert("doneTaskBorderColor".to_string(), border.clone());
        mermaid_vars.insert("taskBorderColor".to_string(), border.clone());
        mermaid_vars.insert("gridColor".to_string(), border.clone());
    }
    if let Some(fg) = fg {
        for key in [
            "taskTextColor",
            "taskTextDarkColor",
            "taskTextLightColor",
            "taskTextOutsideColor",
            "sectionTextColor",
        ] {
            mermaid_vars.insert(key.to_string(), fg.clone());
        }
    }

    // --- Quadrant charts -------------------------------------------------
    //
    // Mermaid derives the four quadrant fills by brightening `primaryColor`
    // and their label colours by darkening `primaryTextColor`, which drifts
    // below AA (solarized-dark quadrant4 ≈ 3.25:1). Labels are drawn directly
    // on the quadrant fill, so give each quadrant a distinct surface on the
    // bg_elevated↔bg axis (guaranteed AA against `fg`) and pin every quadrant
    // label/axis/title colour to `fg`.
    if let Some(bg_elevated) = bg_elevated {
        let fills = [
            ("quadrant1Fill", 0.0),
            ("quadrant2Fill", 0.30),
            ("quadrant3Fill", 0.60),
            ("quadrant4Fill", 0.85),
        ];
        for (key, t) in fills {
            if let Some(v) = mix_toward(Some(bg_elevated), bg, t) {
                mermaid_vars.insert(key.to_string(), v);
            }
        }
    }
    if let Some(accent) = accent {
        mermaid_vars.insert("quadrantPointFill".to_string(), accent.clone());
    }
    if let Some(border) = border {
        for key in [
            "quadrantInternalBorderStrokeFill",
            "quadrantExternalBorderStrokeFill",
        ] {
            mermaid_vars.insert(key.to_string(), border.clone());
        }
    }
    if let Some(fg) = fg {
        for key in [
            "quadrant1TextFill",
            "quadrant2TextFill",
            "quadrant3TextFill",
            "quadrant4TextFill",
            "quadrantPointTextFill",
            "quadrantTitleFill",
            "quadrantXAxisTextFill",
            "quadrantYAxisTextFill",
        ] {
            mermaid_vars.insert(key.to_string(), fg.clone());
        }
    }

    Ok(ThemeBundle {
        css: css_vars,
        mermaid_vars,
        mode: theme.meta.mode.as_str().to_string(),
        warnings,
    })
}

fn normalize_hex_colour(value: &str) -> Option<String> {
    pmd_core::theme::mix::parse_hex(value).map(pmd_core::theme::mix::to_hex)
}

fn normalize_hex_map(
    colours: &BTreeMap<String, String>,
    label: &str,
) -> Result<BTreeMap<String, String>, String> {
    let mut normalized = BTreeMap::new();
    for (key, value) in colours {
        let colour = normalize_hex_colour(value).ok_or_else(|| {
            format!("theme validation: invalid hex colour for {label}.{key}: {value}")
        })?;
        normalized.insert(key.clone(), colour);
    }
    Ok(normalized)
}

/// Locate a theme directory by slug and return both its canonical path
/// and the canonical theme-root it belongs to. Callers need the root so
/// they can re-check containment when reading individual files inside
/// the theme (manifest.toml, theme.css) — guarding against symlinks that
/// escape the trusted root even if the directory itself is well-named.
fn find_theme_dir(slug: &str, roots: &[PathBuf]) -> Option<(PathBuf, PathBuf)> {
    if !is_safe_slug(slug) {
        return None;
    }
    for base in roots {
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
