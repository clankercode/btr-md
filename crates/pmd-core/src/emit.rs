// placeholder until phase 2

/// Result of a single render request, returned to the webview.
///
/// `version` is the monotonic counter assigned by `pmd-app` (see spec §3.2);
/// the webview drops any `RenderResult` whose `version` is lower than the
/// highest dispatched. `source_map` is the flattened
/// `(block_start_line, block_end_line)` table emitted alongside the HTML.
pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}
