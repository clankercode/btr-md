use std::borrow::Cow;
use std::collections::HashSet;

/// Class tokens that JS post-sanitize passes (`markMermaidNodes` /
/// `markMathNodes`) add to flag trusted renderer targets. Stripping them here
/// means raw HTML in markdown cannot pre-flag arbitrary content as
/// Mermaid/KaTeX input; only nodes carrying the current render nonce get
/// re-flagged after sanitize.
const STRIPPED_CLASS_TOKENS: &[&str] = &["pmd-mermaid", "pmd-math", "math-inline", "math-display"];

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
    if attribute == "data-pmd-nonce" {
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
    // norms; if no `:` precedes a `/`, `?`, or `#`, treat as relative.
    let trimmed = value.trim_start_matches(|c: char| c.is_ascii_whitespace() || (c as u32) < 0x20);
    if trimmed.starts_with("//") {
        return Some(String::new());
    }
    let mut scheme = String::new();
    for c in trimmed.chars() {
        if c == ':' {
            return Some(scheme.to_ascii_lowercase());
        }
        if c == '/' || c == '?' || c == '#' {
            return None;
        }
        scheme.push(c);
    }
    None
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
    let trimmed = value.trim_start_matches(|c: char| c.is_ascii_whitespace() || (c as u32) < 0x20);
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
