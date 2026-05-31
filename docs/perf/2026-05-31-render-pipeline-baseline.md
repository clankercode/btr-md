# Render pipeline timing baseline (2026-05-31)

Measured to locate the bottleneck before designing incremental rendering.
Raw data: [`2026-05-31-rust-stages.md`](2026-05-31-rust-stages.md) (release, 25 iters),
[`2026-05-31-frontend-stages.md`](2026-05-31-frontend-stages.md) (Playwright/Chromium — indicative, not webkit2gtk).

## Data flow, one render (edit → preview), with per-stage timing

```
 EDITOR edit
   │  (debounced 80ms — already landed)
   ▼
 invoke('render_cmd', {markdown})         ── JS main thread blocked: ~0
   │
   ▼  [Tauri IPC →]  (real bridge transport unmeasured; proxies below are small)
 ╔══════════════ RUST  (async, OFF the webview thread) ══════════════╗
 ║ byte_to_line            ~0.2–1ms        (≤1% — negligible)         ║
 ║ parse + emit            12–16% of total (linear in output tags)    ║
 ║ ammonia build           ~0.04ms         (constant — negligible)    ║
 ║ ammonia CLEAN           80–88% of total  ◄── BACKEND BOTTLENECK    ║
 ║ strip_nonces            ~0–10ms          (tracks math/mermaid; ~0) ║
 ║ serde serialize (IPC)   ~3%              (cheap)                    ║
 ╚════════════════════════════════════════════════════════════════════╝
   │  RenderResult{html, source_map, render_nonce}
   ▼  [← Tauri IPC]   JSON.parse(2MB) ≈ 3ms   (cheap)
 ╔════════════ FRONTEND apply  (JS MAIN THREAD) ═════════════════════╗
 ║ previewContent.innerHTML = html   linear, ~10ms / 1000 blocks      ║
 ║ (forced) full re-layout / reflow  ~70% of apply  ◄── FE BOTTLENECK ║
 ║ markAllNodes                      cheap                            ║
 ║ renderMermaidNodes  warm ~0.8ms/diagram (cached) │ COLD ~25ms each!║
 ║ renderMathNodes     warm ~0.23ms/formula (cached)│ cold ~0.5ms     ║
 ║ decorateCodeBlocks  linear querySelector('pre') over WHOLE tree    ║
 ║ decorateTables      linear querySelectorAll('table') over tree     ║
 ╚════════════════════════════════════════════════════════════════════╝
```

## Headline numbers

Rust `render_string` total (release): prose **62ms @ 1MB**, **117ms @ 2MB**;
tables far worse (**614ms @ 2MB** — table HTML expands ~7×). `ammonia_clean`
is **84%** of that, scaling linearly with **output tag count** (not input bytes).

Frontend apply (Chromium, indicative): dominated by **full re-layout** (~70%),
linear in block count (~60–82ms @ 1000 blocks, ~196ms @ 3000, ~610ms @ 9000),
then `innerHTML` (~10ms/1000 blocks). Decorate scans are linear over the whole
tree even when nothing changed. Cold Mermaid (~25ms/diagram) is the single
costliest op but is already neutralized for unchanged diagrams by the
source-keyed SVG cache (landed in the perf branch).

IPC payload prep (serde) and deserialize (JSON.parse) are both ~3% — not a
bottleneck. Real Tauri bridge transport is unmeasured but bracketed small.

## Conclusion — two bottlenecks, one root cause

Both bottlenecks are *"we redo whole-document work on every render"*:

1. **Backend:** whole-document **re-sanitization** (ammonia), 80–88% of Rust time.
2. **Frontend:** whole-document **`innerHTML` replace → full re-layout**, ~70%+ of apply.

The single structural fix for both: **operate per top-level block, touching only
what changed.**
- Rust: cache sanitized HTML per block; re-parse/emit/sanitize only changed
  blocks; reuse cached HTML for the rest. (Captures the dominant ~84% cost.)
- Frontend: patch only changed blocks into the DOM (scoping layout/reflow);
  scope decorate/mark to changed blocks only.

Correctness stance (chosen): always-correct with fallback — whenever cross-block
constructs (footnote defs, reference link definitions, setext, spanning raw HTML)
are present or detection is uncertain, fall back to a full render. Verified by
fuzz/property tests asserting `incremental output ≡ full render`.

Scale-to-huge-docs is a *separate* lever: incremental updates do not shrink the
**first** render of a huge doc (innerHTML + initial layout are linear in blocks).
Viewport / lazy rendering (render only visible blocks) addresses initial load
and DOM memory; it composes with, but is independent of, block-incremental
updates.
