use std::borrow::Cow;
use std::collections::HashSet;

/// Class tokens that JS post-sanitize passes (`markMermaidNodes` /
/// `markMathNodes`) add to flag trusted renderer targets. Stripping them here
/// means raw HTML in markdown cannot pre-flag arbitrary content as
/// Mermaid/KaTeX input; only nodes carrying the current render nonce get
/// re-flagged after sanitize.
const STRIPPED_CLASS_TOKENS: &[&str] = &["pmd-mermaid", "pmd-math", "math-inline", "math-display"];
const TRUSTED_RENDER_NONCE_CLASS_TOKENS: &[&str] =
    &["language-mermaid", "language-math", "math-block"];
const RENDER_NONCE_ATTR: &str = "data-pmd-nonce";
const BACKEND_MARKER_ATTRS: &[&str] = &[
    "data-pmd-link-id",
    "data-pmd-image-id",
    "data-pmd-resource-id",
];
const STRIPPED_ATTRS: &[&str] = &[
    "target",
    "download",
    "ping",
    "draggable",
    "data-render-nonce",
];
const RENDERER_PLACEHOLDER_CLASS: &str = "pmd-image-placeholder";

const FOOTNOTE_LINK_CLASS_TOKENS: &[&str] = &["pmd-fnref-link", "pmd-fn-backref"];

pub fn build() -> ammonia::Builder<'static> {
    build_with_nonce(None, false)
}

/// Passive SVG/MathML presentation tags emitted by the trusted Mermaid/KaTeX
/// renderers. These never appear in markdown-derived HTML; they are added only
/// for the post-render export sanitizer (see `sanitize::clean_for_export`).
const SVG_MATHML_TAGS: &[&str] = &[
    // SVG (Mermaid output).
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "marker",
    "use",
    "symbol",
    "clippath",
    "lineargradient",
    "radialgradient",
    // NOTE: `<style>` is intentionally excluded — ammonia treats it as a
    // clean-content tag (strips its body), and an exported diagram does not
    // need Mermaid's embedded stylesheet.
    "stop",
    "pattern",
    "mask",
    "title",
    "desc",
    // MathML (KaTeX output).
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "mspace",
    "msub",
    "msup",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "mstyle",
    "merror",
    "mpadded",
    "mphantom",
    "mfenced",
    "menclose",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
];

/// Build the export sanitizer: the markdown allowlist plus the passive
/// SVG/MathML presentation element families the trusted renderers emit. See
/// `sanitize::clean_for_export` for the trust rationale.
pub fn build_for_export() -> ammonia::Builder<'static> {
    build_with_nonce(None, true)
}

/// Presentation-only attributes for the SVG/MathML subtree. None of these can
/// carry script; ammonia independently strips `on*` handlers regardless of
/// this allowlist.
fn svg_mathml_presentation_attrs() -> HashSet<&'static str> {
    [
        "class",
        "id",
        "role",
        "aria-hidden",
        "aria-label",
        "viewbox",
        "width",
        "height",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "d",
        "points",
        "transform",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-dasharray",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-opacity",
        "opacity",
        "offset",
        "stop-color",
        "stop-opacity",
        "gradientunits",
        "gradienttransform",
        "marker-end",
        "marker-start",
        "markerwidth",
        "markerheight",
        "markerunits",
        "orient",
        "refx",
        "refy",
        "preserveaspectratio",
        "text-anchor",
        "dominant-baseline",
        "dy",
        "dx",
        "font-size",
        "font-family",
        "font-weight",
        "color",
        // MathML.
        "mathvariant",
        "displaystyle",
        "scriptlevel",
        "stretchy",
        "fence",
        "separator",
        "accent",
        "encoding",
        "columnalign",
        "rowalign",
        "linethickness",
        "xmlns",
    ]
    .into_iter()
    .collect()
}

/// Image `src` values permitted in an exported document: already-inlined data
/// images, or remote/asset URLs that the live preview already admitted. Any
/// other scheme (e.g. `javascript:`, raw `file:`) is refused.
fn is_safe_export_img_src(value: &str) -> bool {
    let v = trim_url_start(value);
    is_safe_data_image_url(v)
        || v.starts_with("http://")
        || v.starts_with("https://")
        || v.starts_with("asset://")
        || v.starts_with("https://asset.localhost")
}

fn is_safe_data_image_url(value: &str) -> bool {
    value.starts_with("data:image/png;base64,")
        || value.starts_with("data:image/jpeg;base64,")
        || value.starts_with("data:image/gif;base64,")
        || value.starts_with("data:image/webp;base64,")
}

fn is_safe_inline_style(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    ![
        "url(",
        "expression(",
        "@import",
        "javascript:",
        "vbscript:",
        "data:",
        "behavior:",
        "-moz-binding",
        "</",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_safe_local_svg_reference(value: &str) -> bool {
    trim_url_start(value).starts_with('#')
}

pub fn build_with_render_nonce(render_nonce: &str) -> ammonia::Builder<'static> {
    build_with_nonce(Some(render_nonce.to_string()), false)
}

fn build_with_nonce(render_nonce: Option<String>, export: bool) -> ammonia::Builder<'static> {
    let mut tags: HashSet<&str> = [
        "a",
        "p",
        "div",
        "span",
        "em",
        "strong",
        "s",
        "del",
        "ins",
        "sub",
        "sup",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "hr",
        "br",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "code",
        "pre",
        "kbd",
        "samp",
        "img",
        "figure",
        "figcaption",
        "section",
        "input",
    ]
    .into_iter()
    .collect();

    let mut allowed_attrs: std::collections::HashMap<&str, HashSet<&str>> =
        std::collections::HashMap::new();
    let global: HashSet<&str> = [
        "class",
        "id",
        "data-src-start",
        "data-src-end",
        "role",
        "tabindex",
        "aria-label",
        "title",
    ]
    .into_iter()
    .collect();
    for &t in tags.iter() {
        allowed_attrs.insert(t, global.clone());
    }
    allowed_attrs
        .get_mut("a")
        .unwrap()
        .extend(["href", "title"]);
    allowed_attrs
        .get_mut("img")
        .unwrap()
        .extend(["src", "alt", "title", "width", "height"]);
    allowed_attrs
        .get_mut("td")
        .unwrap()
        .extend(["colspan", "rowspan", "scope"]);
    allowed_attrs
        .get_mut("th")
        .unwrap()
        .extend(["colspan", "rowspan", "scope"]);
    allowed_attrs.get_mut("li").unwrap().extend(["value"]);
    allowed_attrs
        .get_mut("input")
        .unwrap()
        .extend(["type", "checked", "disabled"]);

    // Export mode additionally permits the passive SVG/MathML presentation
    // markup the trusted Mermaid/KaTeX renderers emit (see `build_for_export`).
    if export {
        tags.extend(SVG_MATHML_TAGS.iter().copied());
        let presentation = svg_mathml_presentation_attrs();
        for &t in SVG_MATHML_TAGS.iter() {
            allowed_attrs.insert(t, presentation.clone());
        }
        // `xlink:href` / `href` on <use> are presentation references, but only
        // local fragment references are allowed by the attribute filter.
        allowed_attrs
            .get_mut("use")
            .unwrap()
            .extend(["xlink:href", "href"]);
        // KaTeX positions its glyphs with inline `style` on spans; without it
        // exported math collapses. The attribute filter below applies a local
        // CSS sink policy and refuses URL-bearing or legacy executable CSS.
        for t in ["span", "div", "p", "section"] {
            if let Some(attrs) = allowed_attrs.get_mut(t) {
                attrs.insert("style");
            }
        }
    }

    let mut b = ammonia::Builder::new();
    b.link_rel(None);
    b.tags(tags);
    b.tag_attributes(allowed_attrs);
    // Schemes here are the *outer* allowlist; per-attribute policy below
    // narrows further so we never accept e.g. `data:` on anchors.
    b.url_schemes(
        ["http", "https", "mailto", "data", "asset"]
            .into_iter()
            .collect(),
    );
    b.add_generic_attribute_prefixes(["data-"]);
    match render_nonce {
        Some(allowed_nonce) => {
            b.attribute_filter(move |element, attribute, value| {
                filter_attribute(element, attribute, value, Some(&allowed_nonce))
            });
        }
        None if export => {
            // The markdown filter strips `img src` entirely (the render
            // pipeline re-inserts scoped data-URI images *after* sanitization).
            // Export sanitizes the *post-render* body, so those already-scoped
            // image URLs must survive — but only safe schemes; anything else is
            // dropped. Everything else (incl. SVG/MathML attrs) defers to the
            // base filter.
            b.attribute_filter(|element, attribute, value| {
                if element == "img" && attribute.eq_ignore_ascii_case("src") {
                    return if is_safe_export_img_src(value) {
                        Some(Cow::Borrowed(value))
                    } else {
                        None
                    };
                }
                if attribute.eq_ignore_ascii_case("style") {
                    return if is_safe_inline_style(value) {
                        Some(Cow::Borrowed(value))
                    } else {
                        None
                    };
                }
                if element == "use"
                    && (attribute.eq_ignore_ascii_case("href")
                        || attribute.eq_ignore_ascii_case("xlink:href"))
                {
                    return if is_safe_local_svg_reference(value) {
                        Some(Cow::Borrowed(value))
                    } else {
                        None
                    };
                }
                filter_attribute(element, attribute, value, None)
            });
        }
        None => {
            b.attribute_filter(|element, attribute, value| {
                filter_attribute(element, attribute, value, None)
            });
        }
    }
    b
}

fn filter_attribute<'a>(
    element: &str,
    attribute: &str,
    value: &'a str,
    render_nonce: Option<&str>,
) -> Option<Cow<'a, str>> {
    if STRIPPED_ATTRS
        .iter()
        .any(|stripped| stripped.eq_ignore_ascii_case(attribute))
    {
        return None;
    }
    // Renderer-control data attributes are JS-internal: the Rust emitter does
    // not produce source attrs, and only the post-sanitize JS pass should add
    // them. Static render markers are stripped too; trusted emitter nodes use
    // a per-render nonce, which raw HTML cannot know before sanitization.
    if attribute == "data-mermaid-source"
        || attribute == "data-math-source"
        || attribute == "data-pmd-render"
    {
        return None;
    }
    if attribute == RENDER_NONCE_ATTR {
        return match render_nonce {
            Some(nonce) if nonce == value => Some(Cow::Borrowed(value)),
            _ => None,
        };
    }
    if attribute
        .get(..9)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data-pmd-"))
    {
        if render_nonce.is_some() && is_backend_marker_attr(attribute) {
            return Some(Cow::Borrowed(value));
        }
        return None;
    }
    match (element, attribute) {
        ("a", "href") => filter_href(value, render_nonce.is_some()),
        ("img", "src") => None,
        (_, "class") => filter_class(value, render_nonce.is_some()),
        _ => Some(Cow::Borrowed(value)),
    }
}

fn is_backend_marker_attr(attribute: &str) -> bool {
    BACKEND_MARKER_ATTRS
        .iter()
        .any(|marker| marker.eq_ignore_ascii_case(attribute))
}

fn filter_class(value: &str, renderer_nonce_active: bool) -> Option<Cow<'_, str>> {
    let mut kept: Vec<&str> = Vec::new();
    let mut changed = false;
    for tok in value.split_whitespace() {
        if STRIPPED_CLASS_TOKENS
            .iter()
            .any(|s| s.eq_ignore_ascii_case(tok))
            || (!renderer_nonce_active && tok.eq_ignore_ascii_case(RENDERER_PLACEHOLDER_CLASS))
        {
            changed = true;
            continue;
        }
        kept.push(tok);
    }
    if !changed {
        return Some(Cow::Borrowed(value));
    }
    if kept.is_empty() {
        return None;
    }
    Some(Cow::Owned(kept.join(" ")))
}

fn trim_url_start(value: &str) -> &str {
    value.trim_start_matches(|c: char| c.is_ascii_whitespace() || (c as u32) < 0x20)
}

fn filter_href(value: &str, render_nonce_active: bool) -> Option<Cow<'_, str>> {
    if render_nonce_active && trim_url_start(value).starts_with('#') {
        Some(Cow::Borrowed(value))
    } else {
        None
    }
}

pub(crate) fn strip_untrusted_render_nonces(html: &str) -> String {
    if !html.contains(RENDER_NONCE_ATTR)
        && !html.contains("data-pmd-")
        && !html.contains(RENDERER_PLACEHOLDER_CLASS)
        && !html.contains("href=")
    {
        return html.to_string();
    }

    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(tag_offset) = html[cursor..].find('<') {
        let tag_start = cursor + tag_offset;
        out.push_str(&html[cursor..tag_start]);
        let Some(tag_end) = find_tag_end(html, tag_start + 1) else {
            out.push_str(&html[tag_start..]);
            return out;
        };
        out.push_str(&strip_untrusted_render_nonce_from_tag(
            &html[tag_start..=tag_end],
        ));
        cursor = tag_end + 1;
    }
    out.push_str(&html[cursor..]);
    out
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

fn strip_untrusted_render_nonce_from_tag(tag: &str) -> Cow<'_, str> {
    if (!tag.contains(RENDER_NONCE_ATTR)
        && !tag.contains("data-pmd-")
        && !tag.contains(RENDERER_PLACEHOLDER_CLASS)
        && !tag.contains("href="))
        || tag.starts_with("</")
        || tag.starts_with("<!")
    {
        return Cow::Borrowed(tag);
    }

    let Some((tag_name, attrs_start)) = parse_tag_name(tag) else {
        return Cow::Borrowed(tag);
    };
    let attrs = parse_attrs(tag, attrs_start);
    if attrs.nonce_spans.is_empty()
        && attrs.backend_marker_spans.is_empty()
        && attrs.placeholder_class_spans.is_empty()
        && attrs.href_spans.is_empty()
    {
        return Cow::Borrowed(tag);
    }

    let trusted_code_nonce = tag_name.eq_ignore_ascii_case("code") && attrs.has_trusted_class;
    let trusted_link_marker = tag_name.eq_ignore_ascii_case("a")
        && attrs.has_current_nonce()
        && attrs.has_backend_marker("data-pmd-link-id");
    let trusted_image_marker = tag_name.eq_ignore_ascii_case("span")
        && attrs.has_current_nonce()
        && attrs.has_backend_marker("data-pmd-image-id");
    let trusted_backend_marker = trusted_link_marker || trusted_image_marker;
    let trusted_footnote_href = tag_name.eq_ignore_ascii_case("a")
        && attrs.has_current_nonce()
        && attrs.has_footnote_link_class;

    let mut remove_spans = Vec::new();
    if tag_name.eq_ignore_ascii_case("a") && !trusted_footnote_href {
        remove_spans.extend(attrs.href_spans.iter().copied());
    }
    if !trusted_backend_marker {
        remove_spans.extend(
            attrs
                .backend_marker_spans
                .iter()
                .map(|marker| (marker.start, marker.end)),
        );
    }
    if !trusted_image_marker {
        remove_spans.extend(attrs.placeholder_class_spans.iter().copied());
    }
    if !trusted_code_nonce {
        remove_spans.extend(attrs.nonce_spans.iter().copied());
    }

    strip_spans(tag, &mut remove_spans)
}

fn parse_tag_name(tag: &str) -> Option<(&str, usize)> {
    if !tag.starts_with('<') {
        return None;
    }
    let name_start = 1;
    let name_end = tag[name_start..]
        .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
        .map(|idx| name_start + idx)
        .unwrap_or(tag.len() - 1);
    if name_start == name_end {
        return None;
    }
    Some((&tag[name_start..name_end], name_end))
}

struct ParsedAttrs {
    has_trusted_class: bool,
    has_footnote_link_class: bool,
    nonce_spans: Vec<(usize, usize)>,
    href_spans: Vec<(usize, usize)>,
    backend_marker_spans: Vec<MarkerAttrSpan>,
    placeholder_class_spans: Vec<(usize, usize)>,
}

impl ParsedAttrs {
    fn has_current_nonce(&self) -> bool {
        !self.nonce_spans.is_empty()
    }

    fn has_backend_marker(&self, name: &str) -> bool {
        self.backend_marker_spans
            .iter()
            .any(|marker| marker.name.eq_ignore_ascii_case(name))
    }
}

struct MarkerAttrSpan {
    name: String,
    start: usize,
    end: usize,
}

fn parse_attrs(tag: &str, start: usize) -> ParsedAttrs {
    let mut attrs = ParsedAttrs {
        has_trusted_class: false,
        has_footnote_link_class: false,
        nonce_spans: Vec::new(),
        href_spans: Vec::new(),
        backend_marker_spans: Vec::new(),
        placeholder_class_spans: Vec::new(),
    };
    let mut cursor = start;
    let end = tag.len().saturating_sub(1);

    while cursor < end {
        let attr_start = cursor;
        cursor = skip_ascii_whitespace(tag, cursor, end);
        if cursor >= end || tag.as_bytes()[cursor] == b'/' {
            break;
        }

        let name_start = cursor;
        cursor = advance_attr_name(tag, cursor, end);
        if name_start == cursor {
            cursor += 1;
            continue;
        }
        let name_end = cursor;

        cursor = skip_ascii_whitespace(tag, cursor, end);
        let mut value = None;
        if cursor < end && tag.as_bytes()[cursor] == b'=' {
            cursor += 1;
            cursor = skip_ascii_whitespace(tag, cursor, end);
            let (value_range, next_cursor) = parse_attr_value(tag, cursor, end);
            value = value_range;
            cursor = next_cursor;
        }

        let attr_name = &tag[name_start..name_end];
        if attr_name.eq_ignore_ascii_case("class") {
            if let Some((value_start, value_end)) = value {
                let class_tokens = tag[value_start..value_end].split_whitespace();
                for token in class_tokens {
                    attrs.has_trusted_class |= is_trusted_render_nonce_class(token);
                    attrs.has_footnote_link_class |= is_footnote_link_class(token);
                    if token.eq_ignore_ascii_case(RENDERER_PLACEHOLDER_CLASS) {
                        attrs.placeholder_class_spans.push((attr_start, cursor));
                    }
                }
            }
        } else if attr_name.eq_ignore_ascii_case("href") {
            attrs.href_spans.push((attr_start, cursor));
        } else if attr_name.eq_ignore_ascii_case(RENDER_NONCE_ATTR) {
            attrs.nonce_spans.push((attr_start, cursor));
        } else if is_backend_marker_attr(attr_name) {
            attrs.backend_marker_spans.push(MarkerAttrSpan {
                name: attr_name.to_string(),
                start: attr_start,
                end: cursor,
            });
        }
    }

    attrs
}

fn strip_spans<'a>(tag: &'a str, spans: &mut [(usize, usize)]) -> Cow<'a, str> {
    if spans.is_empty() {
        return Cow::Borrowed(tag);
    }

    spans.sort_unstable_by_key(|(start, _)| *start);
    let mut stripped = String::with_capacity(tag.len());
    let mut cursor = 0;

    for (start, end) in spans.iter().copied() {
        let start = start.min(tag.len());
        let end = end.min(tag.len());
        if end <= cursor {
            continue;
        }
        if start > cursor {
            stripped.push_str(&tag[cursor..start]);
        }
        cursor = end;
    }
    stripped.push_str(&tag[cursor..]);
    Cow::Owned(stripped)
}

fn skip_ascii_whitespace(value: &str, mut cursor: usize, end: usize) -> usize {
    while cursor < end && value.as_bytes()[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    cursor
}

fn advance_attr_name(value: &str, mut cursor: usize, end: usize) -> usize {
    while cursor < end {
        let byte = value.as_bytes()[cursor];
        if byte.is_ascii_whitespace() || byte == b'=' || byte == b'/' || byte == b'>' {
            break;
        }
        cursor += 1;
    }
    cursor
}

fn parse_attr_value(tag: &str, cursor: usize, end: usize) -> (Option<(usize, usize)>, usize) {
    if cursor >= end {
        return (None, cursor);
    }

    let first = tag.as_bytes()[cursor];
    if first == b'"' || first == b'\'' {
        let value_start = cursor + 1;
        let Some(close_offset) = tag[value_start..end].find(first as char) else {
            return (Some((value_start, end)), end);
        };
        let value_end = value_start + close_offset;
        return (Some((value_start, value_end)), value_end + 1);
    }

    let value_end = tag[cursor..end]
        .find(|c: char| c.is_ascii_whitespace() || c == '>')
        .map(|idx| cursor + idx)
        .unwrap_or(end);
    (Some((cursor, value_end)), value_end)
}

fn is_trusted_render_nonce_class(token: &str) -> bool {
    TRUSTED_RENDER_NONCE_CLASS_TOKENS
        .iter()
        .any(|trusted| trusted.eq_ignore_ascii_case(token))
}

fn is_footnote_link_class(token: &str) -> bool {
    FOOTNOTE_LINK_CLASS_TOKENS
        .iter()
        .any(|trusted| trusted.eq_ignore_ascii_case(token))
}
