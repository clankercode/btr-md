//! HTML document preview path.
//!
//! Pure `.html`/`.htm` sources are **not** run through the markdown pipeline.
//! Instead we extract a body fragment, rewrite links/images to the same inert
//! backend markers the markdown emitter uses, sanitize with the ammonia
//! allowlist, and emit a [`crate::emit::RenderResult`].

use crate::emit::{generate_render_nonce, RenderResult};
use crate::escape::escape_html;
use crate::facts::counts::{add_word_count, finalize_counts};
use crate::facts::links::classify_target;
use crate::facts::slug::Slugger;
use crate::facts::{AnchorFact, AnchorSource, CoreDocumentFacts, HeadingFact, ImageFact, LinkFact};
use crate::sanitize::sanitize_document_css;

/// Options for [`render_html_document_with_options`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HtmlRenderOptions {
    /// When true, extract document `<style>` blocks, run them through
    /// [`sanitize_document_css`], and inject a single safe `<style>` element
    /// into the preview HTML. Callers must only set this after a trust gate
    /// (and usually a user prompt).
    pub allow_styles: bool,
}

/// Extra signals returned alongside the core [`RenderResult`] for HTML docs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HtmlRenderExtras {
    /// Source contained at least one non-empty `<style>` block (head or body).
    pub styles_available: bool,
    /// Sanitized document styles were applied to `result.html`.
    pub styles_applied: bool,
}

/// Render a pure HTML document for the live preview (styles stripped).
///
/// Security:
/// - Scripts, event handlers, and disallowed tags/attrs are stripped by
///   [`crate::sanitize::clean_with_render_nonce`].
/// - `<a href>` / `<img src>` are rewritten to inert backend markers before
///   sanitize so resource policy and link activation can apply the same rules
///   as markdown (no free navigation, no out-of-scope image loads).
pub fn render_html_document(source: &str) -> RenderResult {
    render_html_document_with_options(source, HtmlRenderOptions::default()).0
}

/// Render HTML with optional trusted document styles. See [`HtmlRenderOptions`].
pub fn render_html_document_with_options(
    source: &str,
    opts: HtmlRenderOptions,
) -> (RenderResult, HtmlRenderExtras) {
    let render_nonce = generate_render_nonce();
    let style_blocks = extract_style_block_contents(source);
    let styles_available = style_blocks.iter().any(|s| !s.trim().is_empty());
    let applied_css = if opts.allow_styles {
        style_blocks
            .iter()
            .filter_map(|s| sanitize_document_css(s))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };
    let styles_applied = !applied_css.is_empty();

    // Drop head chrome, then opaque blocks (`script`/`style`/comments) *before*
    // resource rewriting so markup hidden inside those blocks cannot become
    // trusted link/image markers. Document styles are re-injected (sanitized)
    // only when `allow_styles` is set.
    let body = extract_body_fragment(source);
    let body = strip_opaque_blocks(body);
    let mut facts = CoreDocumentFacts::empty();
    facts.counts.bytes = source.len().try_into().unwrap_or(u32::MAX);

    let rewritten = rewrite_resources(&body, &render_nonce, &mut facts);
    let mut html = crate::sanitize::clean_with_render_nonce(&rewritten, &render_nonce);
    if styles_applied {
        // Inject *after* ammonia: the allowlist excludes `<style>` (clean-content
        // tags would drop the body). Content is CSS-sanitized; `</` is refused.
        html = format!(
            "<style type=\"text/css\" data-pmd-doc-style=\"1\">{applied_css}</style>{html}"
        );
    }

    collect_structure_facts(&html, &mut facts);
    let plain = strip_tags_for_text(&html);
    add_word_count(&mut facts, &plain);
    facts.counts.paragraphs = count_tag_opens(&html, "p");
    facts.counts.sentences = count_sentences(&plain);
    finalize_counts(&mut facts);

    let result = RenderResult {
        version: 0,
        html,
        source_map: Vec::new(),
        render_nonce,
        // HTML docs are full-document paints; block incremental reconcile is a
        // markdown concern.
        blocks: Vec::new(),
        facts,
    };
    (
        result,
        HtmlRenderExtras {
            styles_available,
            styles_applied,
        },
    )
}

/// Collect inner text of every `<style…>…</style>` in `html` (case-insensitive).
pub fn extract_style_block_contents(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let open = "<style";
    let close = "</style";
    let mut out = Vec::new();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find(open) {
        let start = cursor + rel;
        let after = start + open.len();
        let boundary = lower.as_bytes().get(after).copied().unwrap_or(b'>');
        if !(boundary == b'>' || boundary == b'/' || boundary.is_ascii_whitespace()) {
            cursor = after;
            continue;
        }
        let Some(open_end_rel) = lower[after..].find('>') else {
            break;
        };
        let content_start = after + open_end_rel + 1;
        let Some(close_rel) = lower[content_start..].find(close) else {
            break;
        };
        let content_end = content_start + close_rel;
        out.push(html[content_start..content_end].to_string());
        if let Some(close_end_rel) = lower[content_end..].find('>') {
            cursor = content_end + close_end_rel + 1;
        } else {
            break;
        }
    }
    out
}

/// Pull the previewable fragment from a full HTML document.
///
/// If a `<body…>…</body>` pair is present (case-insensitive), return the body
/// inner HTML so chrome from `<head>` (scripts, style links, meta) never
/// surfaces as preview text. Otherwise return the whole source (fragment HTML).
pub fn extract_body_fragment(source: &str) -> &str {
    let lower = source.to_ascii_lowercase();
    let Some(body_idx) = lower.find("<body") else {
        return source;
    };
    let after_name = body_idx + "<body".len();
    let Some(open_end_rel) = lower[after_name..].find('>') else {
        return source;
    };
    let content_start = after_name + open_end_rel + 1;
    let Some(close_rel) = lower[content_start..].find("</body") else {
        return source.get(content_start..).unwrap_or(source);
    };
    source
        .get(content_start..content_start + close_rel)
        .unwrap_or(source)
}

/// Remove `<script>`, `<style>`, and HTML comments so later passes never treat
/// their contents as live document structure.
fn strip_opaque_blocks(html: &str) -> String {
    let mut out = html.to_string();
    for tag in ["script", "style"] {
        out = strip_element_blocks(&out, tag).into_owned();
    }
    strip_html_comments(&out).into_owned()
}

fn strip_element_blocks<'a>(html: &'a str, tag: &str) -> std::borrow::Cow<'a, str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}");
    if !lower.contains(&open) {
        return std::borrow::Cow::Borrowed(html);
    }
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find(&open) {
        let start = cursor + rel;
        // Require a tag boundary after the name (space, `/`, or `>`).
        let after = start + open.len();
        let boundary = lower.as_bytes().get(after).copied().unwrap_or(b'>');
        if !(boundary == b'>' || boundary == b'/' || boundary.is_ascii_whitespace()) {
            out.push_str(&html[cursor..after]);
            cursor = after;
            continue;
        }
        out.push_str(&html[cursor..start]);
        let Some(open_end_rel) = lower[after..].find('>') else {
            // Unclosed opener: drop the rest.
            return std::borrow::Cow::Owned(out);
        };
        let content_start = after + open_end_rel + 1;
        if let Some(close_rel) = lower[content_start..].find(&close) {
            let close_start = content_start + close_rel;
            if let Some(close_end_rel) = lower[close_start..].find('>') {
                cursor = close_start + close_end_rel + 1;
                continue;
            }
        }
        // No close tag: drop from opener to end.
        return std::borrow::Cow::Owned(out);
    }
    out.push_str(&html[cursor..]);
    std::borrow::Cow::Owned(out)
}

fn strip_html_comments(html: &str) -> std::borrow::Cow<'_, str> {
    let Some(mut start) = html.find("<!--") else {
        return std::borrow::Cow::Borrowed(html);
    };
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0usize;
    loop {
        out.push_str(&html[cursor..start]);
        let body = start + 4;
        match html[body..].find("-->") {
            Some(end_rel) => {
                cursor = body + end_rel + 3;
            }
            None => {
                // Unterminated comment: drop the rest.
                return std::borrow::Cow::Owned(out);
            }
        }
        match html[cursor..].find("<!--") {
            Some(rel) => start = cursor + rel,
            None => {
                out.push_str(&html[cursor..]);
                return std::borrow::Cow::Owned(out);
            }
        }
    }
}

/// Rewrite `<a href>` and `<img>` into inert backend markers and record facts.
fn rewrite_resources(html: &str, render_nonce: &str, facts: &mut CoreDocumentFacts) -> String {
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    let mut link_id = 0usize;
    let mut image_id = 0usize;
    let bytes = html.as_bytes();

    while cursor < html.len() {
        let Some(rel) = html[cursor..].find('<') else {
            out.push_str(&html[cursor..]);
            break;
        };
        let tag_start = cursor + rel;
        out.push_str(&html[cursor..tag_start]);
        if tag_start + 1 >= html.len() {
            out.push('<');
            break;
        }
        // Comments / doctype / closing tags: pass through.
        let next = bytes[tag_start + 1];
        if next == b'/' || next == b'!' || next == b'?' {
            let end = find_tag_end(html, tag_start + 1).unwrap_or(html.len() - 1);
            out.push_str(&html[tag_start..=end]);
            cursor = end + 1;
            continue;
        }
        let Some(tag_end) = find_tag_end(html, tag_start + 1) else {
            out.push_str(&html[tag_start..]);
            break;
        };
        let tag = &html[tag_start..=tag_end];
        let Some((name, attrs_start)) = parse_tag_name(tag) else {
            out.push_str(tag);
            cursor = tag_end + 1;
            continue;
        };

        if name.eq_ignore_ascii_case("a") {
            let attrs = parse_simple_attrs(tag, attrs_start);
            let href = attrs.get("href").map(String::as_str);
            let title = attrs.get("title").map(String::as_str).unwrap_or("");
            let line = line_at(html, tag_start);
            // Label text is filled later when we see the closing tag region is
            // hard; use empty here and refine from title/href for activation.
            let label = attrs
                .get("aria-label")
                .cloned()
                .or_else(|| href.filter(|h| h.starts_with('#')).map(|h| h.to_string()))
                .unwrap_or_default();
            facts.links.push(LinkFact {
                target: href.map(str::to_string),
                title: if title.is_empty() {
                    None
                } else {
                    Some(title.to_string())
                },
                label_text: label,
                reference_label: None,
                definition_id: None,
                line_start: line,
                line_end: line,
                kind: classify_target(href, false),
            });
            out.push_str(&format!(
                "<a data-pmd-link-id=\"link-{link_id}\" role=\"link\" tabindex=\"0\" data-pmd-nonce=\"{}\"",
                escape_html(render_nonce)
            ));
            if !title.is_empty() {
                out.push_str(&format!(" title=\"{}\"", escape_html(title)));
            }
            out.push('>');
            link_id += 1;
            cursor = tag_end + 1;
            continue;
        }

        if name.eq_ignore_ascii_case("img") {
            let attrs = parse_simple_attrs(tag, attrs_start);
            let src = attrs.get("src").map(String::as_str);
            let alt = attrs.get("alt").map(String::as_str).unwrap_or("");
            let title = attrs.get("title").map(String::as_str).unwrap_or("");
            let line = line_at(html, tag_start);
            facts.images.push(ImageFact {
                target: src.map(str::to_string),
                alt_text: alt.to_string(),
                title: if title.is_empty() {
                    None
                } else {
                    Some(title.to_string())
                },
                reference_label: None,
                definition_id: None,
                line_start: line,
                line_end: line,
            });
            let label = if alt.is_empty() { title } else { alt };
            out.push_str(&format!(
                "<span data-pmd-image-id=\"image-{image_id}\" class=\"pmd-image-placeholder\" data-pmd-nonce=\"{}\">",
                escape_html(render_nonce)
            ));
            if !label.is_empty() {
                out.push_str(&escape_html(label));
            }
            out.push_str("</span>");
            image_id += 1;
            cursor = tag_end + 1;
            continue;
        }

        out.push_str(tag);
        cursor = tag_end + 1;
    }

    out
}

fn collect_structure_facts(html: &str, facts: &mut CoreDocumentFacts) {
    let mut slugger = slugger_from_html(html);
    let mut cursor = 0;
    while let Some(rel) = html[cursor..].find('<') {
        let tag_start = cursor + rel;
        let Some(tag_end) = find_tag_end(html, tag_start + 1) else {
            break;
        };
        let tag = &html[tag_start..=tag_end];
        if let Some((name, attrs_start)) = parse_tag_name(tag) {
            if let Some(level) = heading_level(name) {
                let content_start = tag_end + 1;
                let close = format!("</{name}");
                let close_lower = close.to_ascii_lowercase();
                let rest_lower = html[content_start..].to_ascii_lowercase();
                if let Some(close_rel) = rest_lower.find(&close_lower) {
                    let inner = &html[content_start..content_start + close_rel];
                    let text = strip_tags_for_text(inner);
                    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
                    let attrs = parse_simple_attrs(tag, attrs_start);
                    let (slug, duplicate_index) = if let Some(id) = attrs.get("id") {
                        slugger.slug_explicit(id.clone())
                    } else {
                        slugger.slug_for(&text)
                    };
                    let line = line_at(html, tag_start);
                    let block_id = format!("heading-{}", facts.headings.len());
                    facts.headings.push(HeadingFact {
                        level,
                        text: text.clone(),
                        slug: slug.clone(),
                        duplicate_index,
                        line_start: line,
                        line_end: line,
                        block_id: block_id.clone(),
                    });
                    facts.anchors.push(AnchorFact {
                        slug,
                        line_start: line,
                        line_end: line,
                        block_id,
                        source: AnchorSource::Heading,
                    });
                    cursor = content_start + close_rel;
                    continue;
                }
            } else if name.eq_ignore_ascii_case("a") || (!name.is_empty() && !tag.starts_with("</"))
            {
                // Explicit id anchors on non-heading elements.
                let attrs = parse_simple_attrs(tag, attrs_start);
                if let Some(id) = attrs.get("id") {
                    if !id.is_empty() && !facts.anchors.iter().any(|a| a.slug == *id) {
                        let line = line_at(html, tag_start);
                        let (slug, _) = slugger.slug_explicit(id.clone());
                        facts.anchors.push(AnchorFact {
                            slug,
                            line_start: line,
                            line_end: line,
                            block_id: format!("anchor-{}", facts.anchors.len()),
                            source: AnchorSource::ExplicitId,
                        });
                    }
                }
            }
        }
        cursor = tag_end + 1;
    }
}

fn slugger_from_html(_html: &str) -> Slugger {
    Slugger::default()
}

fn heading_level(name: &str) -> Option<u8> {
    match name.to_ascii_lowercase().as_str() {
        "h1" => Some(1),
        "h2" => Some(2),
        "h3" => Some(3),
        "h4" => Some(4),
        "h5" => Some(5),
        "h6" => Some(6),
        _ => None,
    }
}

fn count_tag_opens(html: &str, tag: &str) -> u32 {
    let needle = format!("<{tag}");
    let lower = html.to_ascii_lowercase();
    let needle = needle.to_ascii_lowercase();
    let mut count = 0u32;
    let mut start = 0;
    while let Some(pos) = lower[start..].find(&needle) {
        let abs = start + pos + needle.len();
        let next = lower.as_bytes().get(abs).copied().unwrap_or(b'>');
        if next == b'>' || next.is_ascii_whitespace() || next == b'/' {
            count = count.saturating_add(1);
        }
        start = abs;
    }
    count
}

fn count_sentences(text: &str) -> u32 {
    text.chars()
        .filter(|c| matches!(c, '.' | '!' | '?'))
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

fn strip_tags_for_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(rel) = html[cursor..].find('<') {
        let tag_start = cursor + rel;
        out.push_str(&html[cursor..tag_start]);
        out.push(' ');
        match find_tag_end(html, tag_start + 1) {
            Some(end) => cursor = end + 1,
            None => {
                cursor = html.len();
                break;
            }
        }
    }
    out.push_str(&html[cursor..]);
    out
}

fn line_at(source: &str, byte: usize) -> u32 {
    let byte = byte.min(source.len());
    (source[..byte].bytes().filter(|&b| b == b'\n').count() + 1) as u32
}

fn find_tag_end(html: &str, start: usize) -> Option<usize> {
    let mut quote = None;
    for (offset, c) in html[start..].char_indices() {
        match (quote, c) {
            (Some(q), _) if q == c => quote = None,
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(start + offset),
            _ => {}
        }
    }
    None
}

fn parse_tag_name(tag: &str) -> Option<(&str, usize)> {
    if !tag.starts_with('<') {
        return None;
    }
    let name_start = 1;
    let name_end = tag[name_start..]
        .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
        .map(|idx| name_start + idx)
        .unwrap_or(tag.len().saturating_sub(1));
    if name_start == name_end {
        return None;
    }
    Some((&tag[name_start..name_end], name_end))
}

fn parse_simple_attrs(tag: &str, start: usize) -> std::collections::BTreeMap<String, String> {
    let mut map = std::collections::BTreeMap::new();
    let mut cursor = start;
    let end = tag.len().saturating_sub(1);
    while cursor < end {
        cursor = skip_ws(tag, cursor, end);
        if cursor >= end || tag.as_bytes()[cursor] == b'/' {
            break;
        }
        let name_start = cursor;
        while cursor < end {
            let b = tag.as_bytes()[cursor];
            if b.is_ascii_whitespace() || b == b'=' || b == b'/' || b == b'>' {
                break;
            }
            cursor += 1;
        }
        if name_start == cursor {
            cursor += 1;
            continue;
        }
        let name = tag[name_start..cursor].to_ascii_lowercase();
        cursor = skip_ws(tag, cursor, end);
        let value = if cursor < end && tag.as_bytes()[cursor] == b'=' {
            cursor += 1;
            cursor = skip_ws(tag, cursor, end);
            if cursor >= end {
                String::new()
            } else {
                let first = tag.as_bytes()[cursor];
                if first == b'"' || first == b'\'' {
                    cursor += 1;
                    let value_start = cursor;
                    while cursor < end && tag.as_bytes()[cursor] != first {
                        cursor += 1;
                    }
                    let v = tag[value_start..cursor].to_string();
                    if cursor < end {
                        cursor += 1;
                    }
                    v
                } else {
                    let value_start = cursor;
                    while cursor < end {
                        let b = tag.as_bytes()[cursor];
                        if b.is_ascii_whitespace() || b == b'>' {
                            break;
                        }
                        cursor += 1;
                    }
                    tag[value_start..cursor].to_string()
                }
            }
        } else {
            String::new()
        };
        map.insert(name, decode_basic_entities(&value));
    }
    map
}

fn skip_ws(s: &str, mut cursor: usize, end: usize) -> usize {
    while cursor < end && s.as_bytes()[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    cursor
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::LinkKind;

    #[test]
    fn extract_body_inner_html() {
        let src = "<!DOCTYPE html><html><head><title>t</title><script>x()</script></head>\
<body class=\"x\"><h1>Hi</h1><p>Body</p></body></html>";
        let body = extract_body_fragment(src);
        assert!(body.contains("<h1>Hi</h1>"), "{body}");
        assert!(!body.contains("<script>"), "{body}");
        assert!(!body.contains("<title>"), "{body}");
    }

    #[test]
    fn fragment_without_body_is_returned_as_is() {
        let src = "<nav><a href=\"#a\">A</a></nav><h1 id=\"a\">A</h1>";
        assert_eq!(extract_body_fragment(src), src);
    }

    #[test]
    fn render_preserves_structure_and_strips_scripts() {
        // Use r## so fragment ids like #s1 do not terminate the raw string.
        let src = r##"<!DOCTYPE html><html><body>
<nav class="toc"><a href="#s1">One</a></nav>
<h1 id="s1">Title</h1>
<p style="color:red">Hello <strong>world</strong></p>
<script>alert(1)</script>
<img src="./x.png" alt="diagram">
</body></html>"##;
        let r = render_html_document(src);
        assert!(r.html.contains("<nav"), "nav kept: {}", r.html);
        assert!(r.html.contains(r#"class="toc""#), "{}", r.html);
        assert!(r.html.contains("<h1"), "{}", r.html);
        assert!(r.html.contains("Hello"), "{}", r.html);
        assert!(r.html.contains("<strong>world</strong>"), "{}", r.html);
        assert!(
            r.html.contains("style="),
            "safe inline style kept: {}",
            r.html
        );
        assert!(!r.html.contains("<script"), "script stripped: {}", r.html);
        assert!(!r.html.contains("alert"), "script body gone: {}", r.html);
        // Images become placeholders for resource policy.
        assert!(
            r.html.contains("data-pmd-image-id=\"image-0\""),
            "{}",
            r.html
        );
        assert_eq!(r.facts.images.len(), 1);
        assert_eq!(r.facts.images[0].target.as_deref(), Some("./x.png"));
        // Links become inert markers for activation.
        assert!(r.html.contains("data-pmd-link-id=\"link-0\""), "{}", r.html);
        assert!(
            !r.html.contains("href="),
            "raw href must not survive: {}",
            r.html
        );
        assert_eq!(r.facts.links.len(), 1);
        assert_eq!(r.facts.links[0].kind, LinkKind::Fragment);
        assert!(r.facts.headings.iter().any(|h| h.text == "Title"));
        assert!(r.blocks.is_empty(), "HTML path is non-incremental");
    }

    #[test]
    fn markdown_pipeline_not_applied_to_underscores_and_hashes() {
        // These would be mangled if run through markdown (emphasis / headings).
        let src = "<p>use_snake_case and #not-a-heading</p>";
        let r = render_html_document(src);
        assert!(r.html.contains("use_snake_case"), "{}", r.html);
        assert!(r.html.contains("#not-a-heading"), "{}", r.html);
        assert!(!r.html.contains("<em>"), "no md emphasis: {}", r.html);
        assert!(!r.html.contains("<h1"), "no md heading: {}", r.html);
    }

    #[test]
    fn dangerous_inline_style_is_stripped() {
        let src = r#"<p style="background:url(javascript:evil)">x</p>"#;
        let r = render_html_document(src);
        assert!(!r.html.contains("style="), "{}", r.html);
        assert!(!r.html.contains("javascript:"), "{}", r.html);
    }

    #[test]
    fn markup_inside_script_style_comments_does_not_become_markers() {
        let src = r##"<p>safe</p>
<script>var x = '<a href="https://evil.test">x</a><img src="./pwn.png">';</script>
<style>.x { content: '<a href="#nope">'; }</style>
<!-- <a href="https://evil.test/comment">c</a> -->
<a href="#ok">ok</a>"##;
        let r = render_html_document(src);
        assert_eq!(
            r.facts.links.len(),
            1,
            "only the live link: {:?}",
            r.facts.links
        );
        assert_eq!(r.facts.links[0].target.as_deref(), Some("#ok"));
        assert!(
            r.facts.images.is_empty(),
            "script img not a fact: {:?}",
            r.facts.images
        );
        assert!(!r.html.contains("evil.test"), "{}", r.html);
        assert!(!r.html.contains("pwn.png"), "{}", r.html);
        assert!(r.html.contains("data-pmd-link-id=\"link-0\""), "{}", r.html);
    }

    #[test]
    fn styles_stripped_by_default_but_flagged_available() {
        let src = r#"<!DOCTYPE html><html><head>
<style>h1 { color: blue; }</style>
</head><body><h1>Hi</h1></body></html>"#;
        let (r, extras) = render_html_document_with_options(src, HtmlRenderOptions::default());
        assert!(extras.styles_available);
        assert!(!extras.styles_applied);
        assert!(!r.html.contains("data-pmd-doc-style"), "{}", r.html);
        assert!(!r.html.contains("color: blue"), "{}", r.html);
        assert!(r.html.contains("Hi"), "{}", r.html);
    }

    #[test]
    fn allow_styles_injects_sanitized_stylesheet() {
        let src = r#"<!DOCTYPE html><html><head>
<style>h1 { color: blue; }</style>
<style>p { font-weight: bold; }</style>
</head><body><h1>Hi</h1><p>x</p></body></html>"#;
        let (r, extras) =
            render_html_document_with_options(src, HtmlRenderOptions { allow_styles: true });
        assert!(extras.styles_available);
        assert!(extras.styles_applied);
        assert!(r.html.contains("data-pmd-doc-style=\"1\""), "{}", r.html);
        assert!(r.html.contains("color: blue"), "{}", r.html);
        assert!(r.html.contains("font-weight: bold"), "{}", r.html);
    }

    #[test]
    fn dangerous_document_styles_are_dropped_even_when_allowed() {
        let src = r#"<html><head>
<style>@import url(https://evil.test/x.css); h1{color:red}</style>
<style>body{background:url(javascript:evil)}</style>
<style>h1{color:green}</style>
</head><body><h1>x</h1></body></html>"#;
        let (r, extras) =
            render_html_document_with_options(src, HtmlRenderOptions { allow_styles: true });
        assert!(extras.styles_available);
        // Only the safe third block survives.
        assert!(extras.styles_applied);
        assert!(
            r.html.contains("color:green") || r.html.contains("color: green"),
            "{}",
            r.html
        );
        assert!(!r.html.contains("@import"), "{}", r.html);
        assert!(!r.html.contains("evil.test"), "{}", r.html);
        assert!(!r.html.contains("javascript:"), "{}", r.html);
    }

    #[test]
    fn style_breakout_payload_is_refused() {
        let src = r#"<html><head>
<style>h1{color:red}</style></style><script>alert(1)</script><style>
</head><body><h1>x</h1></body></html>"#;
        // Malformed nesting still must not emit script. Extraction stops at first
        // `</style>`; remaining markup is not treated as CSS when allow_styles.
        let (r, _) =
            render_html_document_with_options(src, HtmlRenderOptions { allow_styles: true });
        assert!(!r.html.contains("<script"), "{}", r.html);
        assert!(!r.html.contains("alert"), "{}", r.html);
    }
}
