use pulldown_cmark::{Alignment, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

use crate::escape::escape_html;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}

fn byte_to_line(md: &str) -> impl Fn(usize) -> u32 + '_ {
    let starts: Vec<usize> = std::iter::once(0)
        .chain(md.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    move |b| (starts.partition_point(|&s| s <= b)) as u32
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
            let class = match kind {
                pulldown_cmark::CodeBlockKind::Fenced(info) => {
                    if info.is_empty() {
                        " class=\"language-text\"".to_string()
                    } else {
                        format!(
                            " class=\"language-{}\"",
                            info.split_whitespace().next().unwrap_or("text")
                        )
                    }
                }
                pulldown_cmark::CodeBlockKind::Indented => " class=\"language-text\"".to_string(),
            };
            html.push_str(&format!(
                "<pre data-src-start=\"{}\" data-src-end=\"\"><code{}>",
                start_line, class
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
        Tag::Image {
            dest_url, title, ..
        } => {
            html.push_str(&format!("<img src=\"{}\"", escape_html(dest_url)));
            if !title.is_empty() {
                html.push_str(&format!(" title=\"{}\"", escape_html(title)));
            }
            html.push('>');
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

fn emit_inline_math_text(html: &mut String, text: &str) {
    let mut cursor = 0;
    while let Some(open) = find_inline_math_delimiter(text, cursor) {
        let math_start = open + 1;
        let Some(close) = find_inline_math_delimiter(text, math_start) else {
            break;
        };
        html.push_str(&escape_html(&text[cursor..open]));
        html.push_str("<span class=\"math-inline\"><code class=\"language-math\">");
        html.push_str(&escape_html(&text[math_start..close]));
        html.push_str("</code></span>");
        cursor = close + 1;
    }
    html.push_str(&escape_html(&text[cursor..]));
}

fn emit_block_math(html: &mut String, math: &str) {
    html.push_str("<span class=\"math-display\"><code class=\"math-block\">");
    html.push_str(&escape_html(math.trim()));
    html.push_str("</code></span>");
}

fn emit_text_with_math(html: &mut String, text: &str, block_math: &mut Option<String>) {
    let mut remaining = text;
    loop {
        if let Some(buffer) = block_math {
            let Some(close) = find_block_math_delimiter(remaining) else {
                buffer.push_str(remaining);
                return;
            };
            buffer.push_str(&remaining[..close]);
            let math = block_math.take().unwrap();
            emit_block_math(html, &math);
            remaining = &remaining[close + 2..];
        } else {
            let Some(open) = find_block_math_delimiter(remaining) else {
                emit_inline_math_text(html, remaining);
                return;
            };
            emit_inline_math_text(html, &remaining[..open]);
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

pub fn render_string(md: &str) -> RenderResult {
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

    for (event, range) in parser {
        match event {
            Event::Start(tag) => {
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
                let cell_alignment = if matches!(tag, Tag::TableCell) {
                    let alignment = table_alignments.get(table_cell_index).copied();
                    table_cell_index += 1;
                    alignment
                } else {
                    None
                };
                let line = to_line(range.start);
                let open_pos = html.len();
                emit_open_tag(&mut html, &tag, line, in_table_head, cell_alignment);
                block_stack.push((line, open_pos));
            }
            Event::End(tag_end) => {
                if matches!(tag_end, TagEnd::TableHead) {
                    in_table_head = false;
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
                if matches!(tag_end, TagEnd::Table) {
                    table_alignments.clear();
                    table_cell_index = 0;
                }
            }
            Event::Text(t) => {
                emit_text_with_math(&mut html, &t, &mut block_math);
            }
            Event::Code(t) => {
                html.push_str("<code>");
                html.push_str(&escape_html(&t));
                html.push_str("</code>");
            }
            Event::SoftBreak => {
                if let Some(buffer) = &mut block_math {
                    buffer.push('\n');
                } else {
                    html.push(' ');
                }
            }
            Event::HardBreak => {
                if let Some(buffer) = &mut block_math {
                    buffer.push('\n');
                } else {
                    html.push_str("<br>");
                }
            }
            Event::Html(t) => {
                html.push_str(&t);
            }
            Event::InlineHtml(t) => {
                html.push_str(&t);
            }
            Event::FootnoteReference(t) => {
                html.push_str(&format!("<sup>{}</sup>", escape_html(&t)));
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
    let html = crate::sanitize::clean(&html);
    RenderResult {
        version: 0,
        html,
        source_map,
    }
}
