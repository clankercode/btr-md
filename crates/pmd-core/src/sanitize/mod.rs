pub mod allowlist;
use std::sync::OnceLock;

pub use allowlist::{is_safe_css_fragment, sanitize_document_css};

static BUILDER: OnceLock<ammonia::Builder<'static>> = OnceLock::new();

pub fn clean(html: &str) -> String {
    let b = BUILDER.get_or_init(allowlist::build);
    b.clean(html).to_string()
}

pub fn clean_with_render_nonce(html: &str, render_nonce: &str) -> String {
    let b = allowlist::build_with_render_nonce(render_nonce);
    allowlist::strip_untrusted_render_nonces(&b.clean(html).to_string())
}

/// Sanitize a *post-render* preview body for self-contained HTML export.
///
/// The live preview pipeline sanitizes the markdown-derived HTML at render
/// time, then trusted client renderers (Mermaid → inline `<svg>`, KaTeX →
/// `<math>`/styled spans) inject their output into the already-clean DOM. An
/// export captures that DOM, so re-running the strict markdown allowlist would
/// *destroy* the legitimate diagram/math markup. This builder is the markdown
/// allowlist **plus** the passive SVG/MathML presentation element families the
/// renderers emit — matching exactly what the live preview already contains.
///
/// It is strictly additive presentation markup: ammonia still strips
/// `<script>`, every `on*` event handler, and disallowed URL schemes, so the
/// export carries no more trust than the live preview.
pub fn clean_for_export(html: &str) -> String {
    let b = EXPORT_BUILDER.get_or_init(allowlist::build_for_export);
    b.clean(html).to_string()
}

static EXPORT_BUILDER: OnceLock<ammonia::Builder<'static>> = OnceLock::new();

#[cfg(test)]
mod export_tests {
    use super::clean_for_export;

    #[test]
    fn keeps_trusted_svg_and_mathml() {
        let svg = clean_for_export("<svg viewBox=\"0 0 1 1\"><path d=\"M0 0\"/></svg>");
        assert!(svg.contains("<svg"), "{svg}");
        assert!(svg.contains("<path"), "{svg}");
        let math = clean_for_export("<math><mrow><mi>x</mi></mrow></math>");
        assert!(math.contains("<math"), "{math}");
        assert!(math.contains("<mi"), "{math}");
    }

    #[test]
    fn keeps_inline_style_for_katex_spans() {
        let out = clean_for_export("<span style=\"top:-1em\">x</span>");
        assert!(out.contains("style"), "katex inline style kept: {out}");
    }

    #[test]
    fn strips_scripts_and_handlers_and_unsafe_img_src() {
        let out = clean_for_export(
            "<script>x()</script><svg onload=\"x()\"></svg>\
<img src=\"javascript:x()\"><img src=\"file:///etc/passwd\">",
        );
        assert!(!out.contains("<script"), "{out}");
        assert!(!out.contains("onload"), "{out}");
        assert!(!out.contains("javascript:"), "{out}");
        assert!(!out.contains("file:///etc/passwd"), "{out}");
    }

    #[test]
    fn strips_export_svg_active_content_and_external_references() {
        let out = clean_for_export(
            "<svg>\
<foreignObject><body onload=\"x()\"><script>x()</script></body></foreignObject>\
<use href=\"javascript:x()\"></use><use xlink:href=\"https://example.test/icon.svg#x\"></use>\
<use href=\"#local\"></use><a xlink:href=\"javascript:x()\">x</a>\
</svg>",
        );
        assert!(!out.contains("foreign"), "{out}");
        assert!(!out.contains("<script"), "{out}");
        assert!(!out.contains("onload"), "{out}");
        assert!(!out.contains("javascript:"), "{out}");
        assert!(!out.contains("https://example.test"), "{out}");
        assert!(out.contains("href=\"#local\""), "{out}");
    }

    #[test]
    fn strips_dangerous_inline_style_css() {
        for style in [
            "background:url(javascript:evil)",
            "width:expression(alert(1))",
            "@import url(https://evil.test/x.css)",
            "-moz-binding:url(xss.xml#x)",
            "color:red</style><script>x()</script>",
        ] {
            let out = clean_for_export(&format!("<span style=\"{style}\">x</span>"));
            assert!(!out.contains("style="), "{style} survived as {out}");
            assert!(!out.contains("<script"), "{style} produced script in {out}");
        }
    }

    #[test]
    fn style_and_title_breakout_payloads_stay_inert() {
        let out = clean_for_export(
            "<style></style><img src=x onerror=x()>\
<svg><title></title><script>x()</script></svg>",
        );
        assert!(!out.contains("<style"), "{out}");
        assert!(!out.contains("onerror"), "{out}");
        assert!(!out.contains("<script"), "{out}");
    }

    #[test]
    fn keeps_scoped_data_uri_images() {
        let out = clean_for_export("<img src=\"data:image/png;base64,AAAA\" alt=\"a\">");
        assert!(out.contains("data:image/png;base64,AAAA"), "{out}");
    }
}
