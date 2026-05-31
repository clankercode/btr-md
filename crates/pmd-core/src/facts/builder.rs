use std::collections::BTreeMap;
use std::ops::{Range, RangeInclusive};

use pulldown_cmark::{CodeBlockKind, Event, LinkType, Tag, TagEnd};

use crate::facts::counts::{add_word_count, finalize_counts};
use crate::facts::frontmatter::parse_frontmatter;
use crate::facts::links::{
    classify_target, first_definition_lookup, normalize_reference_label,
    scan_reference_definitions, scan_unresolved_reference_links,
};
use crate::facts::slug::{github_style_base_slug, Slugger};
use crate::facts::{
    AnchorFact, AnchorSource, BlockFact, BlockKind, CoreDocumentFacts, EmbeddedSpan, HeadingFact,
    ImageFact, LinkFact, ReferenceDefinitionFact,
};
use crate::source_map::LineIndex;

pub struct FactBuilder {
    line_index: LineIndex,
    facts: CoreDocumentFacts,
    slugger: Slugger,
    blocks: BlockBuilder,
    heading: Option<HeadingCapture>,
    link: Option<LinkCapture>,
    image: Option<ImageCapture>,
    code_block: Option<CodeBlockCapture>,
    link_facts: Vec<(usize, LinkFact)>,
    unresolved_link_starts: Vec<usize>,
    unresolved_link_facts: Vec<(usize, LinkFact)>,
    reference_definitions: BTreeMap<String, ReferenceDefinitionFact>,
    math_block_start_line: Option<u32>,
    in_code_block: u32,
    // True while inside the leading `---`/`+++` frontmatter (MetadataBlock).
    // Its text is metadata, not document body, so it is excluded from word
    // counts and math/embedded detection (frontmatter facts come from
    // `parse_frontmatter`, which reads the raw source independently).
    in_metadata_block: bool,
}

impl FactBuilder {
    pub fn new(source: &str) -> Self {
        let line_index = LineIndex::new(source);
        let frontmatter = parse_frontmatter(source);
        let frontmatter_lines = frontmatter_excluded_lines(frontmatter.as_ref());
        let scanned_definitions = scan_reference_definitions(source, frontmatter_lines.clone());
        let reference_definitions = first_definition_lookup(&scanned_definitions);
        let unresolved_links = scan_unresolved_reference_links(
            source,
            &line_index,
            &reference_definitions,
            frontmatter_lines,
        );
        let unresolved_link_starts = unresolved_links
            .iter()
            .map(|link| link.byte_start)
            .collect();
        let unresolved_link_facts = unresolved_links
            .into_iter()
            .map(|link| (link.byte_start, link.fact))
            .collect();
        let mut facts = CoreDocumentFacts::empty();
        facts.counts.bytes = source.len().try_into().unwrap_or(u32::MAX);
        facts.frontmatter = frontmatter;
        facts.reference_definitions = scanned_definitions;

        Self {
            line_index,
            facts,
            slugger: Slugger::default(),
            blocks: BlockBuilder::default(),
            heading: None,
            link: None,
            image: None,
            code_block: None,
            link_facts: Vec::new(),
            unresolved_link_starts,
            unresolved_link_facts,
            reference_definitions,
            math_block_start_line: None,
            in_code_block: 0,
            in_metadata_block: false,
        }
    }

    pub fn line_index(&self) -> &LineIndex {
        &self.line_index
    }

    pub fn rendered_link_marker_id(&self, byte_start: usize, rendered_link_count: usize) -> usize {
        rendered_link_count
            + self
                .unresolved_link_starts
                .partition_point(|start| *start < byte_start)
    }

    pub fn observe_event(&mut self, event: &Event<'_>, range: Range<usize>) {
        // Frontmatter block: track open/close and drop all inner content so it
        // is not word-counted or scanned for math/embedded spans.
        if matches!(event, Event::Start(Tag::MetadataBlock(_))) {
            self.in_metadata_block = true;
            return;
        }
        if matches!(event, Event::End(TagEnd::MetadataBlock(_))) {
            self.in_metadata_block = false;
            return;
        }
        if self.in_metadata_block {
            return;
        }
        match event {
            Event::Start(tag) => self.observe_start(tag, range),
            Event::End(tag_end) => self.observe_end(tag_end, range),
            Event::Text(text) => self.observe_text(text, range),
            Event::Code(text) => self.observe_code(text),
            Event::SoftBreak | Event::HardBreak => self.observe_break(),
            Event::Rule => self.observe_rule(range),
            Event::Html(_) | Event::InlineHtml(_) => {}
            Event::FootnoteReference(label) => self.observe_footnote_reference(label, range),
            Event::TaskListMarker(_) => {}
        }
    }

    pub fn finish(mut self) -> CoreDocumentFacts {
        self.link_facts.extend(self.unresolved_link_facts);
        self.link_facts.sort_by_key(|(byte_start, _)| *byte_start);
        self.facts.links = self.link_facts.into_iter().map(|(_, fact)| fact).collect();
        finalize_counts(&mut self.facts);
        self.facts
    }

    fn observe_start(&mut self, tag: &Tag<'_>, range: Range<usize>) {
        let (line_start, _) = self.line_index.byte_range_to_lines(range.clone());
        let block_id = block_kind_for_start(tag)
            .map(|kind| self.blocks.start_block(&mut self.facts, kind, line_start));

        match tag {
            Tag::Paragraph => {
                self.facts.counts.paragraphs = self.facts.counts.paragraphs.saturating_add(1);
            }
            Tag::Heading { level, id, .. } => {
                self.heading = Some(HeadingCapture {
                    level: *level as u8,
                    text: String::new(),
                    explicit_id: id.as_ref().map(ToString::to_string),
                    line_start,
                    block_id: block_id.unwrap_or_default(),
                });
            }
            Tag::FootnoteDefinition(label) => {
                if let Some(block_id) = block_id {
                    self.facts.anchors.push(AnchorFact {
                        slug: format!("fn-{}", github_style_base_slug(label)),
                        line_start,
                        line_end: line_start,
                        block_id,
                        source: AnchorSource::Footnote,
                    });
                }
            }
            Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            } => {
                self.link = Some(LinkCapture {
                    link_type: *link_type,
                    target: string_option(dest_url),
                    title: string_option(title),
                    reference_label: string_option(id),
                    label_text: String::new(),
                    line_start,
                    byte_start: range.start,
                });
            }
            Tag::Image {
                dest_url,
                title,
                id,
                ..
            } => {
                self.image = Some(ImageCapture {
                    target: string_option(dest_url),
                    title: string_option(title),
                    reference_label: string_option(id),
                    alt_text: String::new(),
                    line_start,
                });
            }
            Tag::CodeBlock(kind) => {
                self.in_code_block = self.in_code_block.saturating_add(1);
                self.code_block = Some(CodeBlockCapture {
                    language: code_block_language(kind),
                    line_start,
                    block_id,
                });
            }
            _ => {}
        }
    }

    fn observe_end(&mut self, tag_end: &TagEnd, range: Range<usize>) {
        let (_, line_end) = self.line_index.byte_range_to_lines(range);

        match tag_end {
            TagEnd::Heading(_) => self.finish_heading(line_end),
            TagEnd::Link => self.finish_link(line_end),
            TagEnd::Image => self.finish_image(line_end),
            TagEnd::CodeBlock => {
                self.finish_code_block(line_end);
                self.in_code_block = self.in_code_block.saturating_sub(1);
            }
            _ => {}
        }

        if block_kind_for_end(tag_end).is_some() {
            self.blocks.finish_block(&mut self.facts, line_end);
        }
    }

    fn observe_text(&mut self, text: &str, range: Range<usize>) {
        add_word_count(&mut self.facts, text);
        self.capture_text(text);
        if self.image.is_none() && self.in_code_block == 0 {
            self.observe_math_text(text, range);
        }
    }

    fn observe_code(&mut self, text: &str) {
        add_word_count(&mut self.facts, text);
        self.capture_text(text);
    }

    fn observe_break(&mut self) {
        self.capture_text(" ");
    }

    fn observe_rule(&mut self, range: Range<usize>) {
        let (line_start, line_end) = self.line_index.byte_range_to_lines(range);
        let id = self
            .blocks
            .start_block(&mut self.facts, BlockKind::Rule, line_start);
        self.blocks.finish_specific(&mut self.facts, &id, line_end);
    }

    fn capture_text(&mut self, text: &str) {
        if let Some(heading) = self.heading.as_mut() {
            heading.text.push_str(text);
        }
        if let Some(link) = self.link.as_mut() {
            link.label_text.push_str(text);
        }
        if let Some(image) = self.image.as_mut() {
            image.alt_text.push_str(text);
        }
    }

    fn finish_heading(&mut self, line_end: u32) {
        let Some(heading) = self.heading.take() else {
            return;
        };
        let explicit_anchor = heading.explicit_id.is_some();
        let (slug, duplicate_index) = if let Some(explicit_id) = heading.explicit_id {
            self.slugger.slug_explicit(explicit_id)
        } else {
            self.slugger.slug_for(heading.text.trim())
        };
        self.facts.headings.push(HeadingFact {
            level: heading.level,
            text: heading.text.trim().to_string(),
            slug: slug.clone(),
            duplicate_index,
            line_start: heading.line_start,
            line_end,
            block_id: heading.block_id.clone(),
        });
        self.facts.anchors.push(AnchorFact {
            slug,
            line_start: heading.line_start,
            line_end,
            block_id: heading.block_id,
            source: if explicit_anchor {
                AnchorSource::ExplicitId
            } else {
                AnchorSource::Heading
            },
        });
    }

    fn observe_footnote_reference(&mut self, label: &str, range: Range<usize>) {
        let (line_start, line_end) = self.line_index.byte_range_to_lines(range);
        self.facts.anchors.push(AnchorFact {
            slug: format!("fnref-{}", github_style_base_slug(label)),
            line_start,
            line_end,
            block_id: self.blocks.current_block_id().unwrap_or_default(),
            source: AnchorSource::Footnote,
        });
    }

    fn finish_link(&mut self, line_end: u32) {
        let Some(link) = self.link.take() else {
            return;
        };
        let is_reference = is_reference_link(link.link_type);
        let definition = link
            .reference_label
            .as_deref()
            .map(normalize_reference_label)
            .and_then(|label| self.reference_definitions.get(&label).cloned());
        let target = link
            .target
            .or_else(|| definition.as_ref().map(|def| def.target.clone()));
        let title = link
            .title
            .or_else(|| definition.as_ref().and_then(|def| def.title.clone()));

        self.link_facts.push((
            link.byte_start,
            LinkFact {
                kind: classify_target(target.as_deref(), is_reference),
                target,
                title,
                label_text: link.label_text,
                reference_label: link.reference_label,
                definition_id: definition.map(|def| def.id),
                line_start: link.line_start,
                line_end,
            },
        ));
    }

    fn finish_image(&mut self, line_end: u32) {
        let Some(image) = self.image.take() else {
            return;
        };
        let definition = image
            .reference_label
            .as_deref()
            .map(normalize_reference_label)
            .and_then(|label| self.reference_definitions.get(&label).cloned());

        self.facts.images.push(ImageFact {
            target: image
                .target
                .or_else(|| definition.as_ref().map(|def| def.target.clone())),
            title: image
                .title
                .or_else(|| definition.as_ref().and_then(|def| def.title.clone())),
            alt_text: image.alt_text,
            reference_label: image.reference_label,
            definition_id: definition.map(|def| def.id),
            line_start: image.line_start,
            line_end,
        });
    }

    fn finish_code_block(&mut self, line_end: u32) {
        let Some(code_block) = self.code_block.take() else {
            return;
        };
        let span = EmbeddedSpan {
            line_start: code_block.line_start,
            line_end,
            block_id: code_block.block_id,
            language_or_kind: code_block.language.clone(),
        };
        if code_block
            .language
            .as_deref()
            .is_some_and(|language| language.eq_ignore_ascii_case("mermaid"))
        {
            self.facts.embedded.mermaid_blocks.push(span.clone());
        }
        self.facts.embedded.code_blocks.push(span);
    }

    fn observe_math_text(&mut self, text: &str, range: Range<usize>) {
        let mut cursor = 0;
        while cursor < text.len() {
            if let Some(start_line) = self.math_block_start_line {
                let Some(close) = text[cursor..].find("$$") else {
                    return;
                };
                let close_pos = cursor + close;
                self.facts.embedded.math_blocks.push(EmbeddedSpan {
                    line_start: start_line,
                    line_end: self.line_index.byte_to_line(range.start + close_pos + 1),
                    block_id: self.blocks.current_block_id(),
                    language_or_kind: Some("math".to_string()),
                });
                self.math_block_start_line = None;
                cursor = close_pos + 2;
                continue;
            }

            let next_block = text[cursor..].find("$$").map(|idx| cursor + idx);
            let segment_end = next_block.unwrap_or(text.len());
            self.observe_inline_math_segment(text, range.start, cursor, segment_end);
            let Some(open) = next_block else {
                return;
            };
            self.math_block_start_line = Some(self.line_index.byte_to_line(range.start + open));
            cursor = open + 2;
        }
    }

    fn observe_inline_math_segment(
        &mut self,
        text: &str,
        text_start_byte: usize,
        start: usize,
        end: usize,
    ) {
        let mut cursor = start;
        while let Some(open_rel) = find_inline_math_delimiter(&text[cursor..end], 0) {
            let open = cursor + open_rel;
            let math_start = open + 1;
            let Some(close_rel) = find_inline_math_delimiter(&text[math_start..end], 0) else {
                return;
            };
            let close = math_start + close_rel;
            self.facts.embedded.math_spans.push(EmbeddedSpan {
                line_start: self.line_index.byte_to_line(text_start_byte + open),
                line_end: self.line_index.byte_to_line(text_start_byte + close),
                block_id: self.blocks.current_block_id(),
                language_or_kind: Some("math".to_string()),
            });
            cursor = close + 1;
        }
    }
}

fn frontmatter_excluded_lines(
    frontmatter: Option<&crate::facts::FrontmatterFact>,
) -> Option<RangeInclusive<usize>> {
    let frontmatter = frontmatter?;
    let line_count = frontmatter.raw.lines().count();
    if line_count == 0 {
        None
    } else {
        Some(1..=line_count)
    }
}

#[derive(Default)]
struct BlockBuilder {
    next_index: u32,
    open: Vec<OpenBlock>,
}

impl BlockBuilder {
    fn start_block(
        &mut self,
        facts: &mut CoreDocumentFacts,
        kind: BlockKind,
        line_start: u32,
    ) -> String {
        self.next_index = self.next_index.saturating_add(1);
        let id = format!("block-{}", self.next_index);
        let parent_id = self.open.last().map(|block| block.id.clone());
        facts.blocks.push(BlockFact {
            id: id.clone(),
            kind,
            line_start,
            line_end: line_start,
            parent_id,
        });
        self.open.push(OpenBlock { id: id.clone() });
        id
    }

    fn finish_block(&mut self, facts: &mut CoreDocumentFacts, line_end: u32) {
        let Some(open) = self.open.pop() else {
            return;
        };
        self.finish_specific(facts, &open.id, line_end);
    }

    fn finish_specific(&mut self, facts: &mut CoreDocumentFacts, id: &str, line_end: u32) {
        if let Some(block) = facts.blocks.iter_mut().find(|block| block.id == id) {
            block.line_end = line_end;
        }
        self.open.retain(|block| block.id != id);
    }

    fn current_block_id(&self) -> Option<String> {
        self.open.last().map(|block| block.id.clone())
    }
}

struct OpenBlock {
    id: String,
}

struct HeadingCapture {
    level: u8,
    text: String,
    explicit_id: Option<String>,
    line_start: u32,
    block_id: String,
}

struct LinkCapture {
    link_type: LinkType,
    target: Option<String>,
    title: Option<String>,
    reference_label: Option<String>,
    label_text: String,
    line_start: u32,
    byte_start: usize,
}

struct ImageCapture {
    target: Option<String>,
    title: Option<String>,
    reference_label: Option<String>,
    alt_text: String,
    line_start: u32,
}

struct CodeBlockCapture {
    language: Option<String>,
    line_start: u32,
    block_id: Option<String>,
}

fn block_kind_for_start(tag: &Tag<'_>) -> Option<BlockKind> {
    match tag {
        Tag::Paragraph => Some(BlockKind::Paragraph),
        Tag::Heading { .. } => Some(BlockKind::Heading),
        Tag::BlockQuote => Some(BlockKind::Blockquote),
        Tag::CodeBlock(_) => Some(BlockKind::CodeBlock),
        Tag::HtmlBlock => Some(BlockKind::HtmlBlock),
        Tag::List(_) => Some(BlockKind::List),
        Tag::Item => Some(BlockKind::ListItem),
        Tag::FootnoteDefinition(_) => Some(BlockKind::FootnoteDefinition),
        Tag::Table(_) => Some(BlockKind::Table),
        Tag::TableRow => Some(BlockKind::TableRow),
        Tag::TableCell => Some(BlockKind::TableCell),
        Tag::TableHead
        | Tag::Emphasis
        | Tag::Strong
        | Tag::Strikethrough
        | Tag::Link { .. }
        | Tag::Image { .. }
        | Tag::MetadataBlock(_) => None,
    }
}

fn block_kind_for_end(tag_end: &TagEnd) -> Option<BlockKind> {
    match tag_end {
        TagEnd::Paragraph => Some(BlockKind::Paragraph),
        TagEnd::Heading(_) => Some(BlockKind::Heading),
        TagEnd::BlockQuote => Some(BlockKind::Blockquote),
        TagEnd::CodeBlock => Some(BlockKind::CodeBlock),
        TagEnd::HtmlBlock => Some(BlockKind::HtmlBlock),
        TagEnd::List(_) => Some(BlockKind::List),
        TagEnd::Item => Some(BlockKind::ListItem),
        TagEnd::FootnoteDefinition => Some(BlockKind::FootnoteDefinition),
        TagEnd::Table => Some(BlockKind::Table),
        TagEnd::TableRow => Some(BlockKind::TableRow),
        TagEnd::TableCell => Some(BlockKind::TableCell),
        TagEnd::TableHead
        | TagEnd::Emphasis
        | TagEnd::Strong
        | TagEnd::Strikethrough
        | TagEnd::Link
        | TagEnd::Image
        | TagEnd::MetadataBlock(_) => None,
    }
}

fn code_block_language(kind: &CodeBlockKind<'_>) -> Option<String> {
    match kind {
        CodeBlockKind::Fenced(info) => info
            .split_whitespace()
            .next()
            .filter(|language| !language.is_empty())
            .map(ToOwned::to_owned),
        CodeBlockKind::Indented => Some("text".to_string()),
    }
}

fn string_option(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn is_reference_link(link_type: LinkType) -> bool {
    matches!(
        link_type,
        LinkType::Reference
            | LinkType::ReferenceUnknown
            | LinkType::Collapsed
            | LinkType::CollapsedUnknown
            | LinkType::Shortcut
            | LinkType::ShortcutUnknown
    )
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
