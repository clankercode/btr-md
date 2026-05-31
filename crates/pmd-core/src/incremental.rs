//! Block-incremental rendering: memoize sanitized HTML per top-level block,
//! keyed by block source text, falling back to whole-document render_string for
//! cross-block constructs. Output is byte-identical to render_string.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

use pulldown_cmark::{Event, Parser, Tag};

/// A process-stable random token used as the render nonce inside cached blocks.
/// Never returned to the frontend; substituted for the real per-render nonce at
/// assembly. Random so it cannot appear in document content.
#[allow(dead_code)]
fn placeholder_nonce() -> &'static str {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(crate::emit::generate_render_nonce)
}

#[allow(dead_code)]
pub(crate) struct BlockSlice {
    pub start: usize,
    pub end: usize,
    pub start_line: u32,
}

/// Returns the ordered top-level block slices, or `None` if the document
/// contains a cross-block construct that requires a whole-document render
/// (footnotes, reference-link definitions, raw HTML).
pub(crate) fn plan_blocks(md: &str) -> Option<Vec<BlockSlice>> {
    if has_reference_definition(md) {
        return None;
    }
    let to_line = crate::emit::byte_to_line(md);
    let mut blocks = Vec::new();
    let mut depth: i32 = 0;
    let mut cur_start = 0usize;
    for (event, range) in Parser::new_ext(md, crate::emit::parser_options()).into_offset_iter() {
        match event {
            Event::Html(_) | Event::InlineHtml(_) | Event::FootnoteReference(_) => return None,
            Event::Start(Tag::FootnoteDefinition(_)) => return None,
            Event::Start(_) => {
                if depth == 0 {
                    cur_start = range.start;
                }
                depth += 1;
            }
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    blocks.push(BlockSlice {
                        start: cur_start,
                        end: range.end,
                        start_line: to_line(cur_start),
                    });
                }
            }
            Event::Rule => {
                if depth == 0 {
                    blocks.push(BlockSlice {
                        start: range.start,
                        end: range.end,
                        start_line: to_line(range.start),
                    });
                }
            }
            _ => {}
        }
    }
    Some(blocks)
}

/// Conservative scan for reference-style link/image definitions: a line of the
/// form `[label]: ...` with up to 3 leading spaces. pulldown-cmark consumes
/// these without emitting events, so they cannot be detected from the stream.
/// A false positive only forces a (correct) full render.
fn has_reference_definition(md: &str) -> bool {
    md.lines().any(|line| {
        let t = line.trim_start_matches(' ');
        if line.len() - t.len() > 3 || !t.starts_with('[') {
            return false;
        }
        if let Some(close) = t.find("]:") {
            close > 1 // non-empty label
        } else {
            false
        }
    })
}

pub(crate) struct CachedBlock {
    /// Sanitized HTML; `data-src-*` are 1-based relative to the block; trusted
    /// nodes carry the placeholder nonce.
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}

const BLOCK_CACHE_CAP: usize = 4096;

struct BlockCache {
    map: HashMap<[u8; 32], Arc<CachedBlock>>,
    order: VecDeque<[u8; 32]>,
    hits: u64,
}

impl BlockCache {
    fn new() -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), hits: 0 }
    }
    fn get(&mut self, key: &[u8; 32]) -> Option<Arc<CachedBlock>> {
        let v = self.map.get(key).cloned();
        if v.is_some() {
            self.hits += 1;
        }
        v
    }
    fn put(&mut self, key: [u8; 32], block: Arc<CachedBlock>) {
        if self.map.insert(key, block).is_none() {
            self.order.push_back(key);
            while self.order.len() > BLOCK_CACHE_CAP {
                if let Some(old) = self.order.pop_front() {
                    self.map.remove(&old);
                }
            }
        }
    }
}

fn cache() -> &'static Mutex<BlockCache> {
    static C: OnceLock<Mutex<BlockCache>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(BlockCache::new()))
}

/// Render+sanitize one block's source with the placeholder nonce, memoized by
/// blake3(source). Returns shared cached HTML (relative line numbers).
#[allow(dead_code)]
pub(crate) fn render_block_cached(src: &str) -> Arc<CachedBlock> {
    let key: [u8; 32] = *blake3::hash(src.as_bytes()).as_bytes();
    if let Some(hit) = cache().lock().unwrap().get(&key) {
        return hit;
    }
    let frag = crate::emit::render_fragment(src, placeholder_nonce());
    let html = crate::sanitize::clean_with_render_nonce(&frag.html, placeholder_nonce());
    let block = Arc::new(CachedBlock { html, source_map: frag.source_map });
    cache().lock().unwrap().put(key, block.clone());
    block
}

pub fn render_block_for_test(src: &str) -> (String, u64) {
    let b = render_block_cached(src);
    let hits = cache().lock().unwrap().hits;
    (b.html.clone(), hits)
}

// Test-only view (stable shape for the integration test).
pub struct BlockSliceView {
    pub start: usize,
    pub end: usize,
    pub start_line: u32,
}

pub fn plan_blocks_for_test(md: &str) -> Option<Vec<BlockSliceView>> {
    plan_blocks(md).map(|v| {
        v.into_iter()
            .map(|b| BlockSliceView {
                start: b.start,
                end: b.end,
                start_line: b.start_line,
            })
            .collect()
    })
}
