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

/// Image `src` MIME types we will allow as `data:` URLs. Mirrors what a local
/// markdown previewer reasonably needs (inline raster + SVG) while excluding
/// `data:text/html` and other active payloads.
const ALLOWED_IMG_DATA_MIME: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
];

pub fn build() -> ammonia::Builder<'static> {
    build_with_nonce(None)
}

pub fn build_with_render_nonce(render_nonce: &str) -> ammonia::Builder<'static> {
    build_with_nonce(Some(render_nonce.to_string()))
}

fn build_with_nonce(render_nonce: Option<String>) -> ammonia::Builder<'static> {
    let tags: HashSet<&str> = [
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
    let global: HashSet<&str> = ["class", "id", "data-src-start", "data-src-end"]
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

    let mut b = ammonia::Builder::new();
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
    match (element, attribute) {
        ("a", "href") => filter_href(value),
        ("img", "src") => filter_img_src(value),
        (_, "class") => filter_class(value),
        _ => Some(Cow::Borrowed(value)),
    }
}

fn filter_class(value: &str) -> Option<Cow<'_, str>> {
    let mut kept: Vec<&str> = Vec::new();
    let mut changed = false;
    for tok in value.split_whitespace() {
        if STRIPPED_CLASS_TOKENS
            .iter()
            .any(|s| s.eq_ignore_ascii_case(tok))
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

fn url_scheme(value: &str) -> Option<String> {
    // Strip leading ASCII whitespace and control chars per HTML URL parsing
    // norms; if no `:` precedes a path/query/fragment delimiter, treat as relative.
    let trimmed = trim_url_start(value);
    if starts_with_network_path(trimmed) || trimmed.starts_with('\\') {
        return Some(String::new());
    }
    let mut scheme = String::new();
    for c in trimmed.chars() {
        if c == ':' {
            return Some(scheme.to_ascii_lowercase());
        }
        if c == '/' || c == '\\' || c == '?' || c == '#' {
            return None;
        }
        scheme.push(c);
    }
    None
}

fn trim_url_start(value: &str) -> &str {
    value.trim_start_matches(|c: char| c.is_ascii_whitespace() || (c as u32) < 0x20)
}

fn starts_with_network_path(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(
        (chars.next(), chars.next()),
        (Some('/' | '\\'), Some('/' | '\\'))
    )
}

fn filter_href(value: &str) -> Option<Cow<'_, str>> {
    match url_scheme(value) {
        None => Some(Cow::Borrowed(value)),
        Some(s) => match s.as_str() {
            "http" | "https" | "mailto" => Some(Cow::Borrowed(value)),
            // Explicitly deny data:, asset:, javascript:, file:, etc. on
            // anchors — clickable navigation to these schemes is the entire
            // attack surface for stored-XSS-via-link.
            _ => None,
        },
    }
}

fn filter_img_src(value: &str) -> Option<Cow<'_, str>> {
    if starts_with_network_path(trim_url_start(value)) {
        return None;
    }
    match url_scheme(value) {
        // Relative path — allowed.
        None => Some(Cow::Borrowed(value)),
        Some(s) => match s.as_str() {
            "asset" => Some(Cow::Borrowed(value)),
            "data" => {
                if is_safe_image_data_url(value) {
                    Some(Cow::Borrowed(value))
                } else {
                    None
                }
            }
            // CSP img-src is `'self' data: asset:`; remote http(s) is denied
            // there too. Drop here so the sanitizer agrees.
            _ => None,
        },
    }
}

fn is_safe_image_data_url(value: &str) -> bool {
    let trimmed = trim_url_start(value);
    let Some(rest) = trimmed.get(0..5).and_then(|p| {
        if p.eq_ignore_ascii_case("data:") {
            Some(&trimmed[5..])
        } else {
            None
        }
    }) else {
        return false;
    };
    // MIME is everything up to the first `;` or `,`.
    let mime_end = rest.find([';', ',']).unwrap_or(rest.len());
    let mime = rest[..mime_end].trim().to_ascii_lowercase();
    ALLOWED_IMG_DATA_MIME.iter().any(|m| *m == mime)
}

pub(crate) fn strip_untrusted_render_nonces(html: &str) -> String {
    if !html.contains(RENDER_NONCE_ATTR) {
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
    if !tag.contains(RENDER_NONCE_ATTR) || tag.starts_with("</") || tag.starts_with("<!") {
        return Cow::Borrowed(tag);
    }

    let Some((tag_name, attrs_start)) = parse_tag_name(tag) else {
        return Cow::Borrowed(tag);
    };
    let attrs = parse_attrs(tag, attrs_start);
    if attrs.nonce_spans.is_empty() {
        return Cow::Borrowed(tag);
    }
    if tag_name.eq_ignore_ascii_case("code") && attrs.has_trusted_class {
        return Cow::Borrowed(tag);
    }

    let mut stripped = String::with_capacity(tag.len());
    let mut cursor = 0;
    for (start, end) in attrs.nonce_spans {
        stripped.push_str(&tag[cursor..start]);
        cursor = end;
    }
    stripped.push_str(&tag[cursor..]);
    Cow::Owned(stripped)
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
    nonce_spans: Vec<(usize, usize)>,
}

fn parse_attrs(tag: &str, start: usize) -> ParsedAttrs {
    let mut attrs = ParsedAttrs {
        has_trusted_class: false,
        nonce_spans: Vec::new(),
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
                attrs.has_trusted_class |= tag[value_start..value_end]
                    .split_whitespace()
                    .any(is_trusted_render_nonce_class);
            }
        } else if attr_name.eq_ignore_ascii_case(RENDER_NONCE_ATTR) {
            attrs.nonce_spans.push((attr_start, cursor));
        }
    }

    attrs
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
