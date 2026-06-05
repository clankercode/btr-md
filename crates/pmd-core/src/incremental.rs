//! Block-incremental rendering: memoize sanitized HTML per top-level block,
//! keyed by block source text, falling back to whole-document render_string for
//! cross-block constructs. Output is byte-identical to render_string.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

use pulldown_cmark::{Event, Parser, Tag};

/// A process-stable random token used as the render nonce inside cached blocks.
/// Never returned to the frontend; substituted for the real per-render nonce at
/// assembly. Random so it cannot appear in document content.
fn placeholder_nonce() -> &'static str {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(crate::emit::generate_render_nonce)
}

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

/// Conservative detection of reference-style link/image definitions, including
/// those nested inside blockquote/list containers (pulldown-cmark consumes
/// these without emitting events). A false positive only forces a correct full
/// render. Strips leading whitespace + `>`/list-marker container prefixes, then
/// checks for `[label]:`.
fn has_reference_definition(md: &str) -> bool {
    md.lines().any(looks_like_ref_def)
}

fn looks_like_ref_def(line: &str) -> bool {
    let mut s = line;
    loop {
        let t = s.trim_start();
        if let Some(rest) = t.strip_prefix('>') {
            s = rest;
            continue;
        }
        if let Some(rest) = t.strip_prefix(['-', '+', '*']) {
            if rest.is_empty() || rest.starts_with([' ', '\t']) {
                s = rest;
                continue;
            }
        }
        let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            let after = &t[digits..];
            if let Some(rest) = after.strip_prefix(['.', ')']) {
                if rest.is_empty() || rest.starts_with([' ', '\t']) {
                    s = rest;
                    continue;
                }
            }
        }
        break;
    }
    let t = s.trim_start();
    t.starts_with('[') && t.find("]:").is_some_and(|close| close > 1)
}

pub(crate) struct CachedBlock {
    /// Sanitized HTML; `data-src-*` are 1-based relative to the block; trusted
    /// nodes carry the placeholder nonce.
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}

const BLOCK_CACHE_CAP: usize = 4096;
const BLOCK_CACHE_BYTE_BUDGET: usize = 8 * 1024 * 1024;

struct BlockCache {
    map: HashMap<[u8; 32], Arc<CachedBlock>>,
    /// (key, html_len) in insertion order for LRU eviction.
    order: VecDeque<([u8; 32], usize)>,
    bytes: usize,
    hits: u64,
}

impl BlockCache {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            hits: 0,
        }
    }
    fn get(&mut self, key: &[u8; 32]) -> Option<Arc<CachedBlock>> {
        let v = self.map.get(key).cloned();
        if v.is_some() {
            self.hits += 1;
        }
        v
    }
    fn put(&mut self, key: [u8; 32], block: Arc<CachedBlock>) {
        let html_len = block.html.len();
        if self.map.insert(key, block).is_none() {
            self.bytes += html_len;
            self.order.push_back((key, html_len));
            while self.order.len() > BLOCK_CACHE_CAP || self.bytes > BLOCK_CACHE_BYTE_BUDGET {
                if let Some((old, old_len)) = self.order.pop_front() {
                    self.map.remove(&old);
                    self.bytes = self.bytes.saturating_sub(old_len);
                } else {
                    break;
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
pub(crate) fn render_block_cached(src: &str) -> Arc<CachedBlock> {
    let key: [u8; 32] = *blake3::hash(src.as_bytes()).as_bytes();
    if let Some(hit) = cache().lock().unwrap().get(&key) {
        return hit;
    }
    let frag = crate::emit::render_fragment(src, placeholder_nonce());
    let html = crate::sanitize::clean_with_render_nonce(&frag.html, placeholder_nonce());
    let block = Arc::new(CachedBlock {
        html,
        source_map: frag.source_map,
    });
    cache().lock().unwrap().put(key, block.clone());
    block
}

/// Insert ` data-pmd-block="key"` into the first start-tag of `block_html`
/// (right after the tag name). Every top-level block emits exactly one opening
/// element, so the first `<name` is that element.
fn inject_block_key(out: &mut String, block_html: &str, key: &str) {
    if let Some(lt) = block_html.find('<') {
        if block_html[lt + 1..].starts_with('/') {
            out.push_str(block_html);
            return;
        }
        let after_name = block_html[lt + 1..]
            .find(|c: char| c.is_whitespace() || c == '>')
            .map(|p| lt + 1 + p)
            .unwrap_or(block_html.len());
        out.push_str(&block_html[..after_name]);
        out.push_str(&format!(" data-pmd-block=\"{key}\""));
        out.push_str(&block_html[after_name..]);
    } else {
        out.push_str(block_html);
    }
}

/// Append `block_html` to `out`, adding `base` to every `data-src-start` and
/// `data-src-end` numeric value. `base = block.start_line - 1`. Pure string
/// scan — no HTML parsing.
fn append_with_line_offset(out: &mut String, block_html: &str, base: u32) {
    const KEYS: [&str; 2] = ["data-src-start=\"", "data-src-end=\""];
    let bytes = block_html.as_bytes();
    let mut i = 0usize;
    while i < block_html.len() {
        let mut matched = None;
        for k in KEYS {
            if block_html[i..].starts_with(k) {
                matched = Some(k);
                break;
            }
        }
        match matched {
            Some(k) => {
                out.push_str(k);
                i += k.len();
                let num_start = i;
                while i < block_html.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > num_start {
                    // data-src line numbers always fit in u32; unwrap_or(0) is a defensive no-op.
                    let n: u32 = block_html[num_start..i].parse().unwrap_or(0);
                    out.push_str(&(n + base).to_string());
                }
            }
            None => {
                let ch = block_html[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
}

pub fn render_incremental(md: &str) -> crate::emit::RenderResult {
    let Some(blocks) = plan_blocks(md) else {
        return crate::emit::render_string(md);
    };
    let render_nonce = crate::emit::generate_render_nonce();
    let mut html = String::new();
    let mut source_map = Vec::<(u32, u32)>::new();
    let mut blocks_manifest = Vec::<crate::emit::BlockRef>::new();
    for b in &blocks {
        let cb = render_block_cached(&md[b.start..b.end]);
        // A top-level block can render to empty HTML — notably frontmatter,
        // whose metadata events `render_fragment` drops entirely. Such a block
        // produces no DOM element, so it must NOT claim a manifest slot: the UI
        // reconcile aligns manifest[i] with the i-th root element by index, and
        // an empty block would shift every subsequent block (garbled preview
        // then freeze). It has no source-map entries either, so skipping is safe.
        if cb.html.trim().is_empty() {
            continue;
        }
        let base = b.start_line - 1;
        let key = blake3::hash(&md.as_bytes()[b.start..b.end])
            .to_hex()
            .to_string();
        let mut offset_html = String::new();
        append_with_line_offset(&mut offset_html, &cb.html, base);
        inject_block_key(&mut html, &offset_html, &key);
        for &(s, e) in &cb.source_map {
            source_map.push((s + base, e + base));
        }
        blocks_manifest.push(crate::emit::BlockRef {
            key,
            base_line: b.start_line,
        });
    }
    let html = html.replace(placeholder_nonce(), &render_nonce);
    let mut fact_builder = crate::facts::builder::FactBuilder::new(md);
    for (event, range) in Parser::new_ext(md, crate::emit::parser_options()).into_offset_iter() {
        fact_builder.observe_event(&event, range);
    }
    crate::emit::RenderResult {
        version: 0,
        html,
        source_map,
        render_nonce,
        blocks: blocks_manifest,
        facts: fact_builder.finish(),
    }
}

#[doc(hidden)]
pub fn render_block_for_test(src: &str) -> (String, u64) {
    // Test-support only (used by tests/incremental.rs); not part of the public API.
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

#[doc(hidden)]
pub fn plan_blocks_for_test(md: &str) -> Option<Vec<BlockSliceView>> {
    // Test-support only (used by tests/incremental.rs); not part of the public API.
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
