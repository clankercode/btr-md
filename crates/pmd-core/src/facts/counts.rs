use crate::facts::CoreDocumentFacts;

pub fn add_word_count(facts: &mut CoreDocumentFacts, text: &str) {
    let words = text.split_whitespace().count();
    facts.counts.words = facts.counts.words.saturating_add(words as u32);
}

pub fn finalize_counts(facts: &mut CoreDocumentFacts) {
    facts.counts.headings = facts.headings.len().try_into().unwrap_or(u32::MAX);
    facts.counts.links = facts.links.len().try_into().unwrap_or(u32::MAX);
    facts.counts.images = facts.images.len().try_into().unwrap_or(u32::MAX);
    facts.counts.code_blocks = facts
        .embedded
        .code_blocks
        .len()
        .try_into()
        .unwrap_or(u32::MAX);
    facts.counts.mermaid_blocks = facts
        .embedded
        .mermaid_blocks
        .len()
        .try_into()
        .unwrap_or(u32::MAX);
    facts.counts.math_spans = facts
        .embedded
        .math_spans
        .len()
        .try_into()
        .unwrap_or(u32::MAX);
    facts.counts.math_blocks = facts
        .embedded
        .math_blocks
        .len()
        .try_into()
        .unwrap_or(u32::MAX);
}
