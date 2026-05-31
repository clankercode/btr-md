use std::collections::BTreeMap;
use std::ops::RangeInclusive;

use crate::facts::{LinkFact, LinkKind, ReferenceDefinitionFact};
use crate::source_map::LineIndex;

pub struct ScannedLinkFact {
    pub byte_start: usize,
    pub fact: LinkFact,
}

pub fn classify_target(target: Option<&str>, is_reference: bool) -> LinkKind {
    if is_reference {
        return LinkKind::Reference;
    }

    let Some(target) = target else {
        return LinkKind::Reference;
    };
    let lower = target.to_ascii_lowercase();

    if target.starts_with('#') {
        LinkKind::Fragment
    } else if lower.starts_with("mailto:") {
        LinkKind::Mailto
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        LinkKind::ExternalUrl
    } else if has_unknown_scheme(target) {
        LinkKind::UnknownScheme
    } else if target_without_fragment_or_query(&lower).ends_with(".md")
        || target_without_fragment_or_query(&lower).ends_with(".markdown")
    {
        LinkKind::LocalMarkdown
    } else {
        LinkKind::LocalFile
    }
}

pub fn normalize_reference_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub fn scan_reference_definitions(
    source: &str,
    excluded_lines: Option<RangeInclusive<usize>>,
) -> Vec<ReferenceDefinitionFact> {
    let mut definitions = Vec::new();
    let mut duplicate_counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut code_context = LineCodeContext::default();

    for (line_index, line) in source.lines().enumerate() {
        let line_number = line_index + 1;
        if excluded_lines
            .as_ref()
            .is_some_and(|lines| lines.contains(&line_number))
        {
            continue;
        }
        if code_context.skip_line(line) {
            continue;
        }
        let Some((label, target, title)) = parse_reference_definition_line(line) else {
            continue;
        };
        let normalized = normalize_reference_label(&label);
        let duplicate_index = duplicate_counts.get(&normalized).copied().unwrap_or(0);
        duplicate_counts.insert(normalized, duplicate_index.saturating_add(1));

        definitions.push(ReferenceDefinitionFact {
            id: format!("definition-{}", definitions.len()),
            label,
            target,
            title,
            line_start: line_number.try_into().unwrap_or(u32::MAX),
            line_end: line_number.try_into().unwrap_or(u32::MAX),
            duplicate_index,
        });
    }

    definitions
}

pub fn first_definition_lookup(
    definitions: &[ReferenceDefinitionFact],
) -> BTreeMap<String, ReferenceDefinitionFact> {
    let mut lookup = BTreeMap::new();
    for definition in definitions {
        lookup
            .entry(normalize_reference_label(&definition.label))
            .or_insert_with(|| definition.clone());
    }
    lookup
}

pub fn scan_unresolved_reference_links(
    source: &str,
    line_index: &LineIndex,
    definitions: &BTreeMap<String, ReferenceDefinitionFact>,
    excluded_lines: Option<RangeInclusive<usize>>,
) -> Vec<ScannedLinkFact> {
    let mut facts = Vec::new();
    let mut code_context = LineCodeContext::default();
    let mut byte_start = 0;

    for (line_zero_index, line) in source.split_inclusive('\n').enumerate() {
        let line_without_newline = line.trim_end_matches(['\r', '\n']);
        let line_number = line_zero_index + 1;
        if excluded_lines
            .as_ref()
            .is_some_and(|lines| lines.contains(&line_number))
        {
            byte_start += line.len();
            continue;
        }
        if code_context.skip_line(line_without_newline) {
            byte_start += line.len();
            continue;
        }

        scan_unresolved_reference_links_in_line(
            line_without_newline,
            byte_start,
            line_index,
            definitions,
            &mut facts,
        );
        byte_start += line.len();
    }

    facts
}

fn scan_unresolved_reference_links_in_line(
    line: &str,
    line_byte_start: usize,
    line_index: &LineIndex,
    definitions: &BTreeMap<String, ReferenceDefinitionFact>,
    facts: &mut Vec<ScannedLinkFact>,
) {
    let inline_code_ranges = inline_code_ranges(line);
    let bytes = line.as_bytes();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(label_open_rel) = line[cursor..].find('[') else {
            break;
        };
        let label_open = cursor + label_open_rel;
        if is_in_any_range(label_open, &inline_code_ranges) {
            cursor = label_open + 1;
            continue;
        }
        if label_open > 0 && bytes[label_open - 1] == b'!' {
            cursor = label_open + 1;
            continue;
        }

        let Some(label_close_rel) = line[label_open + 1..].find(']') else {
            break;
        };
        let label_close = label_open + 1 + label_close_rel;
        if is_in_any_range(label_close, &inline_code_ranges) {
            cursor = label_close + 1;
            continue;
        }
        if bytes.get(label_close + 1) != Some(&b'[') {
            cursor = label_close + 1;
            continue;
        }
        let Some(reference_close_rel) = line[label_close + 2..].find(']') else {
            break;
        };
        let reference_close = label_close + 2 + reference_close_rel;
        if is_in_any_range(reference_close, &inline_code_ranges) {
            cursor = reference_close + 1;
            continue;
        }
        let label_text = &line[label_open + 1..label_close];
        let reference_label = &line[label_close + 2..reference_close];
        let normalized = normalize_reference_label(reference_label);

        if !normalized.is_empty() && !definitions.contains_key(&normalized) {
            let absolute_start = line_byte_start + label_open;
            let absolute_end = line_byte_start + reference_close + 1;
            let (line_start, line_end) =
                line_index.byte_range_to_lines(absolute_start..absolute_end);
            facts.push(ScannedLinkFact {
                byte_start: absolute_start,
                fact: LinkFact {
                    target: None,
                    title: None,
                    label_text: label_text.to_string(),
                    reference_label: Some(reference_label.to_string()),
                    definition_id: None,
                    line_start,
                    line_end,
                    kind: LinkKind::Reference,
                },
            });
        }

        cursor = reference_close + 1;
    }
}

fn parse_reference_definition_line(line: &str) -> Option<(String, String, Option<String>)> {
    let trimmed = line.trim_start();
    let label_end = trimmed.find("]:")?;
    if !trimmed.starts_with('[') || label_end <= 1 {
        return None;
    }

    let label = trimmed[1..label_end].to_string();
    let rest = trimmed[label_end + 2..].trim_start();
    if rest.is_empty() {
        return None;
    }

    let (target, title_rest) = if let Some(rest) = rest.strip_prefix('<') {
        let target_end = rest.find('>')?;
        (
            rest[..target_end].to_string(),
            rest[target_end + 1..].trim(),
        )
    } else {
        let split = rest.find(char::is_whitespace).unwrap_or(rest.len());
        (rest[..split].to_string(), rest[split..].trim())
    };

    let title = parse_reference_title(title_rest);
    Some((label, target, title))
}

fn parse_reference_title(rest: &str) -> Option<String> {
    let rest = rest.trim();
    if rest.len() < 2 {
        return None;
    }

    let pairs = [('"', '"'), ('\'', '\''), ('(', ')')];
    for (open, close) in pairs {
        if rest.starts_with(open) && rest.ends_with(close) {
            return Some(rest[1..rest.len() - 1].to_string());
        }
    }
    None
}

fn target_without_fragment_or_query(target: &str) -> &str {
    let fragment = target.find('#').unwrap_or(target.len());
    let query = target.find('?').unwrap_or(target.len());
    &target[..fragment.min(query)]
}

fn has_unknown_scheme(target: &str) -> bool {
    let Some(colon) = target.find(':') else {
        return false;
    };
    let scheme = &target[..colon];
    !scheme.is_empty()
        && scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
}

#[derive(Default)]
struct LineCodeContext {
    fence: Option<Fence>,
}

impl LineCodeContext {
    fn skip_line(&mut self, line: &str) -> bool {
        if is_indented_code_line(line) {
            return true;
        }
        if let Some(fence) = self.fence {
            if is_closing_fence(line, fence) {
                self.fence = None;
            }
            return true;
        }

        if let Some(fence) = opening_fence(line) {
            self.fence = Some(fence);
            return true;
        }

        false
    }
}

#[derive(Clone, Copy)]
struct Fence {
    marker: char,
    len: usize,
}

fn opening_fence(line: &str) -> Option<Fence> {
    let trimmed = line.trim_start();
    let mut chars = trimmed.chars();
    let marker @ ('`' | '~') = chars.next()? else {
        return None;
    };
    let len = 1 + chars.take_while(|ch| *ch == marker).count();
    if len >= 3 {
        Some(Fence { marker, len })
    } else {
        None
    }
}

fn is_closing_fence(line: &str, fence: Fence) -> bool {
    let trimmed = line.trim_start();
    let mut chars = trimmed.chars();
    if chars.next() != Some(fence.marker) {
        return false;
    }
    let len = 1 + chars.by_ref().take_while(|ch| *ch == fence.marker).count();
    len >= fence.len && chars.all(char::is_whitespace)
}

fn is_indented_code_line(line: &str) -> bool {
    line.starts_with('\t') || line.starts_with("    ")
}

fn inline_code_ranges(line: &str) -> Vec<std::ops::Range<usize>> {
    let bytes = line.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(open_rel) = line[cursor..].find('`') else {
            break;
        };
        let open = cursor + open_rel;
        let tick_count = count_ticks(bytes, open);
        let mut search = open + tick_count;
        let mut close = None;
        while search < bytes.len() {
            let Some(close_rel) = line[search..].find('`') else {
                break;
            };
            let candidate = search + close_rel;
            if count_ticks(bytes, candidate) == tick_count {
                close = Some(candidate + tick_count);
                break;
            }
            search = candidate + count_ticks(bytes, candidate);
        }
        let Some(close) = close else {
            break;
        };
        ranges.push(open..close);
        cursor = close;
    }

    ranges
}

fn count_ticks(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .take_while(|byte| **byte == b'`')
        .count()
}

fn is_in_any_range(index: usize, ranges: &[std::ops::Range<usize>]) -> bool {
    ranges
        .iter()
        .any(|range| range.start <= index && index < range.end)
}
