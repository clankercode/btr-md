use std::collections::HashSet;

pub fn build() -> ammonia::Builder<'static> {
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
    b.url_schemes(
        ["http", "https", "mailto", "data", "asset"]
            .into_iter()
            .collect(),
    );
    b.add_generic_attribute_prefixes(["data-"]);
    b
}
