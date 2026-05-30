use pulldown_cmark::{Alignment, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

use crate::escape::escape_html;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
    pub render_nonce: String,
}

fn byte_to_line(md: &str) -> impl Fn(usize) -> u32 + '_ {
    let starts: Vec<usize> = std::iter::once(0)
        .chain(md.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    move |b| (starts.partition_point(|&s| s <= b)) as u32
}

struct ImageState {
    dest_url: String,
    title: String,
    alt: String,
}

fn emit_image(html: &mut String, state: &ImageState) {
    html.push_str(&format!(
        "<img src=\"{}\" alt=\"{}\"",
        escape_html(&state.dest_url),
        escape_html(&state.alt)
    ));
    if !state.title.is_empty() {
        html.push_str(&format!(" title=\"{}\"", escape_html(&state.title)));
    }
    html.push('>');
}

fn generate_render_nonce() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("secure render nonce generation failed");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn alignment_value(alignment: Alignment) -> Option<&'static str> {
    match alignment {
        Alignment::None => None,
        Alignment::Left => Some("left"),
        Alignment::Center => Some("center"),
        Alignment::Right => Some("right"),
    }
}

fn emit_open_tag(
    html: &mut String,
    tag: &Tag,
    start_line: u32,
    in_table_head: bool,
    cell_alignment: Option<Alignment>,
    render_nonce: &str,
) {
    match tag {
        Tag::Paragraph => html.push_str(&format!(
            "<p data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::Heading { level, .. } => html.push_str(&format!(
            "<h{} data-src-start=\"{}\" data-src-end=\"\">",
            *level as u8, start_line
        )),
        Tag::BlockQuote => html.push_str(&format!(
            "<blockquote data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::CodeBlock(kind) => {
            let (class, trusted_runner_target) = match kind {
                pulldown_cmark::CodeBlockKind::Fenced(info) => {
                    let language = info.split_whitespace().next().unwrap_or("text");
                    if language.is_empty() {
                        (" class=\"language-text\"".to_string(), false)
                    } else {
                        (
                            format!(" class=\"language-{}\"", language),
                            language.eq_ignore_ascii_case("mermaid")
                                || language.eq_ignore_ascii_case("math"),
                        )
                    }
                }
                pulldown_cmark::CodeBlockKind::Indented => {
                    (" class=\"language-text\"".to_string(), false)
                }
            };
            let nonce_attr = if trusted_runner_target {
                format!(" data-pmd-nonce=\"{}\"", escape_html(render_nonce))
            } else {
                String::new()
            };
            html.push_str(&format!(
                "<pre data-src-start=\"{}\" data-src-end=\"\"><code{}{}>",
                start_line, class, nonce_attr
            ));
        }
        Tag::List(ordered) => {
            if ordered.is_some() {
                html.push_str(&format!(
                    "<ol data-src-start=\"{}\" data-src-end=\"\">",
                    start_line
                ));
            } else {
                html.push_str(&format!(
                    "<ul data-src-start=\"{}\" data-src-end=\"\">",
                    start_line
                ));
            }
        }
        Tag::Item => html.push_str(&format!(
            "<li data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::Table(_) => html.push_str(&format!(
            "<table data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::TableHead => html.push_str(&format!(
            "<thead data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::TableRow => html.push_str(&format!(
            "<tr data-src-start=\"{}\" data-src-end=\"\">",
            start_line
        )),
        Tag::TableCell => {
            let tag_name = if in_table_head { "th" } else { "td" };
            html.push_str(&format!(
                "<{} data-src-start=\"{}\" data-src-end=\"\"",
                tag_name, start_line
            ));
            if let Some(alignment) = cell_alignment.and_then(alignment_value) {
                html.push_str(&format!(" data-align=\"{}\"", alignment));
            }
            html.push('>');
        }
        Tag::Emphasis => html.push_str("<em>"),
        Tag::Strong => html.push_str("<strong>"),
        Tag::Strikethrough => html.push_str("<s>"),
        Tag::Link {
            dest_url, title, ..
        } => {
            html.push_str(&format!("<a href=\"{}\"", escape_html(dest_url)));
            if !title.is_empty() {
                html.push_str(&format!(" title=\"{}\"", escape_html(title)));
            }
            html.push('>');
        }
        Tag::Image { .. } => {
            // Image markup is emitted on Tag::Image close after we have
            // accumulated alt text from child events; suppress the open here.
        }
        Tag::HtmlBlock => {}
        Tag::FootnoteDefinition(_) => {}
        Tag::MetadataBlock(_) => {}
    }
}

fn find_block_math_delimiter(text: &str) -> Option<usize> {
    text.as_bytes().windows(2).position(|pair| pair == b"$$")
}

fn find_inline_math_delimiter(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut idx = start;
    while idx < bytes.len() {
        if bytes[idx] == b'$'
            && bytes.get(idx.wrapping_sub(1)) != Some(&b'$')
            && bytes.get(idx + 1) != Some(&b'$')
        {
            return Some(idx);
        }
        idx += 1;
    }
    None
}

fn emit_inline_math_text(html: &mut String, text: &str, render_nonce: &str) {
    let mut cursor = 0;
    while let Some(open) = find_inline_math_delimiter(text, cursor) {
        let math_start = open + 1;
        let Some(close) = find_inline_math_delimiter(text, math_start) else {
            break;
        };
        html.push_str(&escape_html(&text[cursor..open]));
        html.push_str(&format!(
            "<span class=\"math-inline\"><code class=\"language-math\" data-pmd-nonce=\"{}\">",
            escape_html(render_nonce)
        ));
        html.push_str(&escape_html(&text[math_start..close]));
        html.push_str("</code></span>");
        cursor = close + 1;
    }
    html.push_str(&escape_html(&text[cursor..]));
}

fn emit_block_math(html: &mut String, math: &str, render_nonce: &str) {
    html.push_str(&format!(
        "<span class=\"math-display\"><code class=\"math-block\" data-pmd-nonce=\"{}\">",
        escape_html(render_nonce)
    ));
    html.push_str(&escape_html(math.trim()));
    html.push_str("</code></span>");
}

fn emit_text_with_math(
    html: &mut String,
    text: &str,
    block_math: &mut Option<String>,
    render_nonce: &str,
) {
    let mut remaining = text;
    loop {
        if let Some(buffer) = block_math {
            let Some(close) = find_block_math_delimiter(remaining) else {
                buffer.push_str(remaining);
                return;
            };
            buffer.push_str(&remaining[..close]);
            let math = block_math.take().unwrap();
            emit_block_math(html, &math, render_nonce);
            remaining = &remaining[close + 2..];
        } else {
            let Some(open) = find_block_math_delimiter(remaining) else {
                emit_inline_math_text(html, remaining, render_nonce);
                return;
            };
            emit_inline_math_text(html, &remaining[..open], render_nonce);
            *block_math = Some(String::new());
            remaining = &remaining[open + 2..];
        }
    }
}

fn emit_close_tag(html: &mut String, tag_end: &TagEnd, in_table_head: bool) {
    match tag_end {
        TagEnd::Paragraph => html.push_str("</p>"),
        TagEnd::Heading(level) => html.push_str(&format!("</h{}>", *level as u8)),
        TagEnd::BlockQuote => html.push_str("</blockquote>"),
        TagEnd::CodeBlock => html.push_str("</code></pre>"),
        TagEnd::List(ordered) => {
            if *ordered {
                html.push_str("</ol>");
            } else {
                html.push_str("</ul>");
            }
        }
        TagEnd::Item => html.push_str("</li>"),
        TagEnd::Table => html.push_str("</table>"),
        TagEnd::TableHead => html.push_str("</thead>"),
        TagEnd::TableRow => html.push_str("</tr>"),
        TagEnd::TableCell => {
            let tag_name = if in_table_head { "th" } else { "td" };
            html.push_str(&format!("</{}>", tag_name));
        }
        TagEnd::Emphasis => html.push_str("</em>"),
        TagEnd::Strong => html.push_str("</strong>"),
        TagEnd::Strikethrough => html.push_str("</s>"),
        TagEnd::Link => html.push_str("</a>"),
        TagEnd::Image => {}
        TagEnd::HtmlBlock => {}
        TagEnd::FootnoteDefinition => {}
        TagEnd::MetadataBlock(_) => {}
    }
}

/// The five GitHub alert kinds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum AlertKind {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

impl AlertKind {
    fn slug(self) -> &'static str {
        match self {
            AlertKind::Note => "note",
            AlertKind::Tip => "tip",
            AlertKind::Important => "important",
            AlertKind::Warning => "warning",
            AlertKind::Caution => "caution",
        }
    }
    fn label(self) -> &'static str {
        match self {
            AlertKind::Note => "Note",
            AlertKind::Tip => "Tip",
            AlertKind::Important => "Important",
            AlertKind::Warning => "Warning",
            AlertKind::Caution => "Caution",
        }
    }
}

/// Parse a GitHub-alert marker. The marker must be the *only* content on the
/// blockquote's first line (after trimming), i.e. exactly `[!TYPE]`.
fn parse_alert_marker(text: &str) -> Option<AlertKind> {
    let inner = text.trim().strip_prefix("[!")?.strip_suffix(']')?;
    match inner.to_ascii_uppercase().as_str() {
        "NOTE" => Some(AlertKind::Note),
        "TIP" => Some(AlertKind::Tip),
        "IMPORTANT" => Some(AlertKind::Important),
        "WARNING" => Some(AlertKind::Warning),
        "CAUTION" => Some(AlertKind::Caution),
        _ => None,
    }
}

/// Detection state for a GitHub alert blockquote. pulldown tokenises `[!NOTE]`
/// into several text events (`[`, `!NOTE`, `]`), so the first line's text is
/// accumulated in a buffer and the marker decision is made at the line break.
#[derive(Clone, Copy, PartialEq, Eq)]
enum AlertScan {
    None,
    /// Just opened a blockquote; awaiting its first child.
    ExpectFirstChild {
        bq_open_pos: usize,
    },
    /// First child is a paragraph; accumulating its first line into `alert_buf`.
    ScanningMarker {
        bq_open_pos: usize,
        para_open_pos: usize,
    },
}

/// Abandon an in-progress marker scan: emit whatever first-line text was
/// buffered (it was not a bare marker) and reset to `None`.
fn flush_alert_marker(
    html: &mut String,
    alert_state: &mut AlertScan,
    alert_buf: &mut String,
    block_math: &mut Option<String>,
    render_nonce: &str,
) {
    if matches!(alert_state, AlertScan::ScanningMarker { .. }) {
        if !alert_buf.is_empty() {
            emit_text_with_math(html, alert_buf, block_math, render_nonce);
            alert_buf.clear();
        }
        *alert_state = AlertScan::None;
    }
}

/// After inserting `n` bytes at `at`, shift every block_stack open position
/// that sits at or after `at` so pending `data-src-end` fills stay correct.
fn adjust_block_stack(block_stack: &mut [(u32, usize)], at: usize, n: usize) {
    for (_, pos) in block_stack.iter_mut() {
        if *pos >= at {
            *pos += n;
        }
    }
}

/// Turn an already-emitted blockquote + first paragraph into a GitHub alert:
/// add the alert class to the blockquote and inject a title paragraph before
/// the body. Stack positions are adjusted so later end-line fills are correct.
fn apply_alert(
    html: &mut String,
    block_stack: &mut [(u32, usize)],
    bq_open_pos: usize,
    para_open_pos: usize,
    kind: AlertKind,
) {
    let title = format!("<p class=\"pmd-alert-title\">{}</p>", kind.label());
    html.insert_str(para_open_pos, &title);
    adjust_block_stack(block_stack, para_open_pos, title.len());

    let class_str = format!(" class=\"pmd-alert pmd-alert-{}\"", kind.slug());
    let class_at = bq_open_pos + "<blockquote".len();
    html.insert_str(class_at, &class_str);
    adjust_block_stack(block_stack, class_at, class_str.len());
}

/// Emit the collected footnote definitions as a back-linked section.
/// `fn_ref_counts` maps footnote number → total number of in-text references,
/// so that multiple backrefs can be emitted when a footnote is cited more than once.
fn emit_footnotes_section(
    html: &mut String,
    mut footnotes: Vec<(usize, String)>,
    fn_ref_counts: &std::collections::HashMap<usize, usize>,
) {
    if footnotes.is_empty() {
        return;
    }
    footnotes.sort_by_key(|(n, _)| *n);
    html.push_str("<section class=\"pmd-footnotes\" aria-label=\"Footnotes\"><hr><ol>");
    for (n, body) in footnotes {
        html.push_str(&format!("<li id=\"fn-{n}\">"));
        html.push_str(&body);
        let count = fn_ref_counts.get(&n).copied().unwrap_or(1);
        if count == 1 {
            html.push_str(&format!(
                "<a href=\"#fnref-{n}\" class=\"pmd-fn-backref\" aria-label=\"Back to content\">↩</a>"
            ));
        } else {
            // Emit one backref per in-text occurrence: fnref-N (first), fnref-N-2, fnref-N-3 …
            for k in 1..=count {
                let id = if k == 1 {
                    format!("fnref-{n}")
                } else {
                    format!("fnref-{n}-{k}")
                };
                html.push_str(&format!(
                    "<a href=\"#{id}\" class=\"pmd-fn-backref\" aria-label=\"Back to content {k}\">↩<sup>{k}</sup></a>"
                ));
            }
        }
        html.push_str("</li>");
    }
    html.push_str("</ol></section>");
}

pub fn render_string(md: &str) -> RenderResult {
    let render_nonce = generate_render_nonce();
    let to_line = byte_to_line(md);
    let mut opts = Options::empty();
    opts.insert(
        Options::ENABLE_TABLES
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_FOOTNOTES,
    );

    let parser = Parser::new_ext(md, opts).into_offset_iter();

    let mut html = String::new();
    let mut source_map = Vec::<(u32, u32)>::new();
    let mut block_stack: Vec<(u32, usize)> = Vec::new();
    let mut in_table_head = false;
    let mut table_alignments: Vec<Alignment> = Vec::new();
    let mut table_cell_index = 0;
    let mut block_math: Option<String> = None;
    // Depth of currently-open fenced/indented code blocks. While positive,
    // Event::Text content is emitted verbatim — no math delimiter parsing —
    // because `$E=mc^2$` inside a code fence is literal source, not math.
    let mut in_code_block: u32 = 0;
    // While inside Tag::Image, collect plain text into the alt attribute and
    // suppress body emission. Image markup is emitted on close.
    let mut image_state: Option<ImageState> = None;
    // GitHub-alert detection (buffered: the blockquote open tag is rewritten in
    // place once its first paragraph's leading text is inspected).
    let mut alert_state = AlertScan::None;
    let mut alert_buf = String::new();
    // Footnotes: number ids by first reference; collect definition bodies into a
    // back-linked section emitted at the end. `fn_def_start` marks where the
    // current definition's body began in `html` so it can be split off.
    let mut fn_numbers: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut next_fn_number = 1usize;
    let mut footnotes: Vec<(usize, String)> = Vec::new();
    let mut fn_def_start: Option<(String, usize)> = None;
    // Track how many times each footnote *number* has been referenced in the text,
    // so emit_footnotes_section can generate the correct number of backrefs.
    let mut fn_ref_counts: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();

    for (event, range) in parser {
        match event {
            Event::Start(tag) => {
                let starts_image = matches!(tag, Tag::Image { .. });
                if image_state.is_some() && !starts_image {
                    continue;
                }
                // Footnote definitions are redirected: their body is captured
                // (via split_off at End) and re-emitted as a back-linked
                // section, so bypass the generic emit + block_stack push.
                if let Tag::FootnoteDefinition(id) = &tag {
                    fn_def_start = Some((id.to_string(), html.len()));
                    continue;
                }
                // A nested element while scanning a marker means the first line
                // has inline content beyond a bare marker — abandon the scan and
                // emit the buffered text before this element's open tag.
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                if matches!(tag, Tag::TableHead) {
                    in_table_head = true;
                }
                if let Tag::Table(alignments) = &tag {
                    table_alignments = alignments.clone();
                    table_cell_index = 0;
                }
                if matches!(tag, Tag::TableRow) {
                    table_cell_index = 0;
                }
                if matches!(tag, Tag::CodeBlock(_)) {
                    in_code_block += 1;
                }
                if let Tag::Image {
                    dest_url, title, ..
                } = &tag
                {
                    image_state = Some(ImageState {
                        dest_url: dest_url.to_string(),
                        title: title.to_string(),
                        alt: String::new(),
                    });
                }
                let cell_alignment = if matches!(tag, Tag::TableCell) {
                    let alignment = table_alignments.get(table_cell_index).copied();
                    table_cell_index += 1;
                    alignment
                } else {
                    None
                };
                let line = to_line(range.start);
                let open_pos = html.len();
                emit_open_tag(
                    &mut html,
                    &tag,
                    line,
                    in_table_head,
                    cell_alignment,
                    &render_nonce,
                );
                block_stack.push((line, open_pos));

                // Drive GitHub-alert detection.
                alert_state = match (alert_state, &tag) {
                    (AlertScan::None, Tag::BlockQuote) => AlertScan::ExpectFirstChild {
                        bq_open_pos: open_pos,
                    },
                    (AlertScan::ExpectFirstChild { bq_open_pos }, Tag::Paragraph) => {
                        alert_buf.clear();
                        AlertScan::ScanningMarker {
                            bq_open_pos,
                            para_open_pos: open_pos,
                        }
                    }
                    // A nested blockquote as the first child starts its own scan.
                    (AlertScan::ExpectFirstChild { .. }, Tag::BlockQuote) => {
                        AlertScan::ExpectFirstChild {
                            bq_open_pos: open_pos,
                        }
                    }
                    // Any other opening tag means this is not a (simple) alert.
                    _ => AlertScan::None,
                };
            }
            Event::End(tag_end) => {
                let ends_image = matches!(tag_end, TagEnd::Image);
                if image_state.is_some() && !ends_image {
                    continue;
                }
                // Close a footnote definition: split its rendered body out of
                // `html` and stash it (numbered) for the footnotes section.
                if matches!(tag_end, TagEnd::FootnoteDefinition) {
                    if let Some((id, def_start)) = fn_def_start.take() {
                        let body = html.split_off(def_start);
                        let n = *fn_numbers.entry(id).or_insert_with(|| {
                            let n = next_fn_number;
                            next_fn_number += 1;
                            n
                        });
                        footnotes.push((n, body));
                    }
                    continue;
                }
                if matches!(tag_end, TagEnd::Paragraph) {
                    // First line ended at the paragraph end (single-line blockquote):
                    // decide the marker, or flush the buffered text.
                    if let AlertScan::ScanningMarker {
                        bq_open_pos,
                        para_open_pos,
                    } = alert_state
                    {
                        if let Some(kind) = parse_alert_marker(&alert_buf) {
                            apply_alert(
                                &mut html,
                                &mut block_stack,
                                bq_open_pos,
                                para_open_pos,
                                kind,
                            );
                        } else if !alert_buf.is_empty() {
                            emit_text_with_math(
                                &mut html,
                                &alert_buf,
                                &mut block_math,
                                &render_nonce,
                            );
                        }
                        alert_buf.clear();
                    }
                    alert_state = AlertScan::None;
                }
                if matches!(tag_end, TagEnd::TableHead) {
                    in_table_head = false;
                }
                if matches!(tag_end, TagEnd::CodeBlock) && in_code_block > 0 {
                    in_code_block -= 1;
                }
                if let Some((start_line, open_pos)) = block_stack.pop() {
                    let end_line = to_line(range.end.saturating_sub(1));
                    let placeholder = "data-src-end=\"\"";
                    if let Some(idx) = html[open_pos..].find(placeholder) {
                        let abs = open_pos + idx + "data-src-end=\"".len();
                        html.insert_str(abs, &end_line.to_string());
                    }
                    source_map.push((start_line, end_line));
                    emit_close_tag(&mut html, &tag_end, in_table_head);
                }
                if matches!(tag_end, TagEnd::Image) {
                    if let Some(state) = image_state.take() {
                        emit_image(&mut html, &state);
                    }
                }
                if matches!(tag_end, TagEnd::Table) {
                    table_alignments.clear();
                    table_cell_index = 0;
                }
            }
            Event::Text(t) => {
                // While scanning a blockquote's first line, buffer its text so
                // the (multi-token) `[!TYPE]` marker can be reassembled.
                if matches!(alert_state, AlertScan::ScanningMarker { .. }) {
                    alert_buf.push_str(&t);
                    continue;
                }
                if let Some(state) = image_state.as_mut() {
                    state.alt.push_str(&t);
                } else if in_code_block > 0 {
                    html.push_str(&escape_html(&t));
                } else {
                    emit_text_with_math(&mut html, &t, &mut block_math, &render_nonce);
                }
            }
            Event::Code(t) => {
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                if let Some(state) = image_state.as_mut() {
                    state.alt.push_str(&t);
                } else {
                    html.push_str("<code>");
                    html.push_str(&escape_html(&t));
                    html.push_str("</code>");
                }
            }
            Event::SoftBreak => {
                // End of the blockquote's first line: decide the marker.
                if let AlertScan::ScanningMarker {
                    bq_open_pos,
                    para_open_pos,
                } = alert_state
                {
                    alert_state = AlertScan::None;
                    if let Some(kind) = parse_alert_marker(&alert_buf) {
                        apply_alert(
                            &mut html,
                            &mut block_stack,
                            bq_open_pos,
                            para_open_pos,
                            kind,
                        );
                        alert_buf.clear();
                        continue; // drop the break that followed the marker line
                    }
                    emit_text_with_math(&mut html, &alert_buf, &mut block_math, &render_nonce);
                    alert_buf.clear();
                }
                if let Some(state) = image_state.as_mut() {
                    state.alt.push(' ');
                } else if let Some(buffer) = &mut block_math {
                    buffer.push('\n');
                } else {
                    html.push(' ');
                }
            }
            Event::HardBreak => {
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                if let Some(state) = image_state.as_mut() {
                    state.alt.push(' ');
                } else if let Some(buffer) = &mut block_math {
                    buffer.push('\n');
                } else {
                    html.push_str("<br>");
                }
            }
            Event::Html(t) => {
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                if image_state.is_none() {
                    html.push_str(&t);
                }
                // Inline HTML inside alt text is dropped: alt is a plain-text
                // attribute, and we refuse to let attacker markup leak there.
            }
            Event::InlineHtml(t) => {
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                if image_state.is_none() {
                    html.push_str(&t);
                }
            }
            Event::FootnoteReference(t) => {
                flush_alert_marker(
                    &mut html,
                    &mut alert_state,
                    &mut alert_buf,
                    &mut block_math,
                    &render_nonce,
                );
                let n = *fn_numbers.entry(t.to_string()).or_insert_with(|| {
                    let n = next_fn_number;
                    next_fn_number += 1;
                    n
                });
                // Count occurrences so we can emit unique ref IDs for repeated citations.
                let occ = fn_ref_counts.entry(n).or_insert(0);
                *occ += 1;
                let ref_id = if *occ == 1 {
                    format!("fnref-{n}")
                } else {
                    format!("fnref-{n}-{occ}")
                };
                html.push_str(&format!(
                    "<sup class=\"pmd-fnref\" id=\"{ref_id}\"><a href=\"#fn-{n}\">{n}</a></sup>"
                ));
            }
            Event::Rule => {
                html.push_str("<hr>");
            }
            Event::TaskListMarker(checked) => {
                let checkbox = if checked {
                    "<input type=\"checkbox\" checked disabled>"
                } else {
                    "<input type=\"checkbox\" disabled>"
                };
                html.push_str(checkbox);
            }
        }
    }
    if let Some(math) = block_math {
        html.push_str("$$");
        html.push_str(&escape_html(&math));
    }
    emit_footnotes_section(&mut html, footnotes, &fn_ref_counts);
    let html = crate::sanitize::clean_with_render_nonce(&html, &render_nonce);
    RenderResult {
        version: 0,
        html,
        source_map,
        render_nonce,
    }
}
