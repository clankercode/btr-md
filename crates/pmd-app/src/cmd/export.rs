//! Self-contained HTML export (#7).
//!
//! # Approach: serialize the live, already-sanitized preview DOM
//!
//! The frontend gathers `previewContent.innerHTML` **after** Mermaid/KaTeX have
//! rendered and passes it here together with the active theme CSS. We chose
//! this over re-rendering in the backend for two reasons:
//!
//! 1. **Trust parity by construction.** The captured DOM is exactly what the
//!    user sees: the markdown-derived HTML was already run through the strict
//!    sanitizer at render time, local images were inlined as data URIs via the
//!    existing scoped-asset path (`preview::resource_policy`), and out-of-scope
//!    images are already blocked placeholders. We add **no** new filesystem or
//!    network access here — every byte either came from the sanitized render or
//!    from a trusted client renderer.
//! 2. **Pre-rendered diagrams/math come for free.** Re-rendering in the backend
//!    would only reproduce the `<pre><code class="language-mermaid">` source;
//!    we would then have to re-run the client renderers. Serializing the DOM
//!    captures the finished `<svg>` / KaTeX output directly.
//!
//! Sanitization is *preserved*, not weakened: the body is re-cleaned with
//! [`pmd_core::sanitize::clean_for_export`], which is the markdown allowlist
//! plus the passive SVG/MathML presentation elements the trusted renderers
//! emit. ammonia still strips `<script>`, `on*` handlers and unsafe URL
//! schemes, so the export carries no more trust than the live preview.

use serde::Deserialize;
use std::path::PathBuf;
use std::sync::OnceLock;

use crate::cmd::file::write_no_follow;
use base64::Engine;

const KATEX_CSS: &str = include_str!("../../../../ui/styles/katex.min.css");
const KATEX_FONTS: &[(&str, &[u8])] = &[
    (
        "KaTeX_AMS-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_AMS-Regular.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Bold",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Caligraphic-Bold.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Caligraphic-Regular.woff2"),
    ),
    (
        "KaTeX_Fraktur-Bold",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Fraktur-Bold.woff2"),
    ),
    (
        "KaTeX_Fraktur-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Fraktur-Regular.woff2"),
    ),
    (
        "KaTeX_Main-Bold",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Main-Bold.woff2"),
    ),
    (
        "KaTeX_Main-BoldItalic",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Main-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Main-Italic",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Main-Italic.woff2"),
    ),
    (
        "KaTeX_Main-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Main-Regular.woff2"),
    ),
    (
        "KaTeX_Math-BoldItalic",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Math-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Math-Italic",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Math-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Bold",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_SansSerif-Bold.woff2"),
    ),
    (
        "KaTeX_SansSerif-Italic",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_SansSerif-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_SansSerif-Regular.woff2"),
    ),
    (
        "KaTeX_Script-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Script-Regular.woff2"),
    ),
    (
        "KaTeX_Size1-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Size1-Regular.woff2"),
    ),
    (
        "KaTeX_Size2-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Size2-Regular.woff2"),
    ),
    (
        "KaTeX_Size3-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Size3-Regular.woff2"),
    ),
    (
        "KaTeX_Size4-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Size4-Regular.woff2"),
    ),
    (
        "KaTeX_Typewriter-Regular",
        include_bytes!("../../../../ui/styles/fonts/KaTeX_Typewriter-Regular.woff2"),
    ),
];

/// Request body for [`export_html`]. Field names are snake_case to match the
/// TypeScript `HtmlExportPayload`.
#[derive(Debug, Deserialize)]
pub struct HtmlExportPayload {
    /// `previewContent.innerHTML` — sanitized-at-render plus trusted-renderer
    /// output (Mermaid SVG, KaTeX HTML, data-URI images).
    pub body_html: String,
    /// The active theme's emitted CSS.
    pub theme_css: String,
    /// Human-facing document title.
    pub title: String,
}

/// Assemble a self-contained HTML document from a captured preview body and the
/// active theme CSS. Pure so it is unit-testable without Tauri / the dialog.
///
/// - `body_html` is re-sanitized with the export allowlist.
/// - KaTeX CSS and its WOFF2 fonts are inlined so math is styled offline.
/// - CSS is inlined inside a `<style>` block. CSS cannot break out of a
///   `<style>` element except via a literal `</style>`; we neutralise that to
///   keep stylesheet text from injecting markup.
pub fn build_export_document(payload: &HtmlExportPayload) -> String {
    let body = pmd_core::sanitize::clean_for_export(&payload.body_html);
    let css = format!(
        "{}\n{}",
        katex_css_for_export(),
        neutralise_style_close(&payload.theme_css)
    );
    let title = html_escape_text(&payload.title);
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<title>{title}</title>\n<style>\n{css}\n</style>\n</head>\n\
<body>\n<main class=\"pmd-preview\">\n{body}\n</main>\n</body>\n</html>\n"
    )
}

fn katex_css_for_export() -> &'static str {
    static CSS: OnceLock<String> = OnceLock::new();
    CSS.get_or_init(|| neutralise_style_close(&inline_katex_font_urls()))
}

fn inline_katex_font_urls() -> String {
    let mut css = KATEX_CSS.to_string();
    for (name, bytes) in KATEX_FONTS {
        let data_url = format!(
            "url(data:font/woff2;base64,{})",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        css = css.replace(&format!("url(fonts/{name}.woff2)"), &data_url);
        css = css.replace(&format!(",url(fonts/{name}.woff) format(\"woff\")"), "");
        css = css.replace(&format!(",url(fonts/{name}.ttf) format(\"truetype\")"), "");
    }
    css
}

/// Prevent a `</style>` (case-insensitive) inside theme CSS from closing the
/// inlined `<style>` element and injecting subsequent markup.
fn neutralise_style_close(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let lower = css.to_ascii_lowercase();
    let needle = "</style";
    let mut cursor = 0;
    while let Some(rel) = lower[cursor..].find(needle) {
        let at = cursor + rel;
        out.push_str(&css[cursor..at]);
        // Break the closing tag by escaping the slash; still valid CSS-noise.
        out.push_str("<\\/style");
        cursor = at + needle.len();
    }
    out.push_str(&css[cursor..]);
    out
}

/// Minimal text escaping for the `<title>` (which is RCDATA-adjacent).
fn html_escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Export the current document as one self-contained HTML file.
///
/// The destination is chosen via the OS save dialog (mirroring
/// `cmd::file::save_dialog`); the chosen path is admitted to the scope and the
/// file is written with `O_NOFOLLOW`. No image bytes are read here — they were
/// already inlined by the render pipeline through the scoped-asset path.
#[tauri::command]
pub async fn export_html(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    payload: HtmlExportPayload,
    suggested_name: String,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;

    let document = build_export_document(&payload);

    let file_path = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("HTML", &["html", "htm"])
        .blocking_save_file();

    let Some(path) = file_path else {
        return Ok(None);
    };
    let canon = path.into_path().map_err(|e| e.to_string())?;
    let canon = state.scope.allow(&canon).map_err(|e| e.to_string())?;
    write_no_follow(&canon, document.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(canon))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(body: &str, css: &str) -> HtmlExportPayload {
        HtmlExportPayload {
            body_html: body.to_string(),
            theme_css: css.to_string(),
            title: "Doc".to_string(),
        }
    }

    #[test]
    fn inlines_theme_css_and_title() {
        let doc = build_export_document(&payload("<p>hi</p>", ":root{--pmd-bg:#fff}"));
        assert!(doc.contains(":root{--pmd-bg:#fff}"));
        assert!(doc.contains("<title>Doc</title>"));
        assert!(doc.contains("<p>hi</p>"));
        assert!(doc.starts_with("<!DOCTYPE html>"));
    }

    #[test]
    fn inlines_katex_css_and_fonts_without_external_font_urls() {
        let doc = build_export_document(&payload("<span class=\"katex\">x</span>", ""));
        assert!(doc.contains(".katex{"), "KaTeX CSS must be embedded");
        assert!(
            doc.contains("url(data:font/woff2;base64,"),
            "KaTeX WOFF2 fonts must be embedded"
        );
        assert!(
            !doc.contains("url(fonts/"),
            "export must not reference sidecar font files"
        );
        assert!(
            !doc.contains("@import"),
            "vendored KaTeX CSS must not import network resources"
        );
    }

    #[test]
    fn preserves_inlined_data_uri_images_within_scope() {
        // The render pipeline already turned a scoped local image into a data
        // URI; export must keep it verbatim (no re-reading from disk).
        let img = "<img src=\"data:image/png;base64,AAAA\" alt=\"diagram\">";
        let doc = build_export_document(&payload(img, ""));
        assert!(
            doc.contains("data:image/png;base64,AAAA"),
            "data-URI image must survive: {doc}"
        );
        assert!(doc.contains("alt=\"diagram\""));
    }

    #[test]
    fn out_of_scope_images_are_dropped_not_re_read() {
        // A raw file:// image (out of scope) must not survive — it is neither a
        // safe data URI nor a remote/asset URL. No filesystem read happens.
        let img = "<img src=\"file:///etc/passwd\" alt=\"x\">";
        let doc = build_export_document(&payload(img, ""));
        assert!(
            !doc.contains("file:///etc/passwd"),
            "out-of-scope file:// src must be stripped: {doc}"
        );
    }

    #[test]
    fn sanitization_is_preserved_scripts_and_handlers_stripped() {
        let body = "<p onclick=\"steal()\">x</p><script>evil()</script>\
<a href=\"javascript:evil()\">y</a>";
        let doc = build_export_document(&payload(body, ""));
        assert!(!doc.contains("onclick"), "event handlers must be stripped");
        assert!(!doc.contains("<script"), "scripts must be stripped");
        assert!(!doc.contains("javascript:"), "js: hrefs must be stripped");
    }

    #[test]
    fn pre_rendered_mermaid_svg_survives() {
        // Trusted Mermaid output is inline SVG; the export sanitizer keeps it.
        let svg = "<pre class=\"pmd-mermaid\"><svg width=\"10\" height=\"10\">\
<g><path d=\"M0 0 L10 10\" stroke=\"#333\" fill=\"none\"></path>\
<text x=\"1\" y=\"2\">node</text></g></svg></pre>";
        let doc = build_export_document(&payload(svg, ""));
        assert!(doc.contains("<svg"), "svg root kept: {doc}");
        assert!(doc.contains("<path"), "svg path kept: {doc}");
        assert!(doc.contains("node"), "svg text kept: {doc}");
    }

    #[test]
    fn pre_rendered_katex_mathml_survives() {
        let math = "<span class=\"pmd-math\"><math><semantics><mrow>\
<mi>x</mi><mo>+</mo><mn>1</mn></mrow></semantics></math></span>";
        let doc = build_export_document(&payload(math, ""));
        assert!(doc.contains("<math"), "math kept: {doc}");
        assert!(doc.contains("<mi"), "mi kept: {doc}");
        assert!(doc.contains("x"));
    }

    #[test]
    fn neutralises_style_close_in_theme_css() {
        let doc = build_export_document(&payload(
            "<p>x</p>",
            "body{} </style><script>evil()</script>",
        ));
        // The literal closing tag inside CSS must be broken so it cannot end
        // the <style> element and smuggle executable markup. The `<script>`
        // text may still appear, but only as inert CSS text after the escaped
        // `<\/style`, never after a real `</style>`.
        assert!(!doc.contains("</style><script>"));
        assert!(
            doc.contains("<\\/style"),
            "closing tag must be escaped: {doc}"
        );
    }

    #[test]
    fn escapes_title() {
        let doc = build_export_document(&HtmlExportPayload {
            body_html: "<p>x</p>".into(),
            theme_css: String::new(),
            title: "a<b>&c".into(),
        });
        assert!(doc.contains("<title>a&lt;b&gt;&amp;c</title>"));
    }
}
