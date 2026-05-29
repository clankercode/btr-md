# Security Re-review: Markdown Rendering and Sanitizer

Date: 2026-05-25
Reviewer: Codex
Scope: `crates/pmd-core/src/emit.rs`, `crates/pmd-core/src/sanitize/`, `ui/src/main.ts`, `ui/src/mermaid_runner.ts`, `ui/src/katex_runner.ts`, `ui/src/theme_apply.ts`, `crates/pmd-core/tests/security.rs`
Authorization boundary: local passive source review and local test/probe execution only.

## Summary

Verdict: FAIL.

The original URL scheme and UI error-rendering fixes are mostly present, fenced and indented code math suppression works, and image alt text is now collected for plain and formatted text. However, two meaningful gaps remain:

- Raw sanitized HTML can still reach Mermaid and KaTeX by preserving `code.language-mermaid`, `code.language-math`, or `code.math-block` classes that the UI later upgrades.
- Protocol-relative image URLs (`//example.com/...`) bypass the remote-image sanitizer policy because the URL classifier treats a leading slash as relative.

A smaller DOM-quality issue remains in image alt collection: formatting tags inside alt text leave empty inline elements before the image.

## Findings

| ID | Title | Severity | Exploitability | Impact | Confidence | Affected Surface | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1-M3-R | Raw HTML can still opt into Mermaid/KaTeX via trusted selector classes | Major | Medium | Renderer trust boundary bypass, renderer DoS/bug exposure | High | `theme_apply.ts`, `allowlist.rs` | Open |
| T1-M6-R | Protocol-relative remote images survive sanitizer | Major | Medium | Sanitizer/CSP mismatch, potential remote image load depending on webview resolution | High | `allowlist.rs` | Open |
| T1-M5-R | Formatted image alt leaves empty inline DOM nodes | Minor | Low | Dirty output DOM, incomplete literal-alt suppression | Medium | `emit.rs` | Open |
| T1-M7-R | Tests still miss the remaining sanitizer trust-path and URL edge cases | Minor | Low | Regressions pass current suite | High | `security.rs` | Open |

## Evidence

Tests run:

- `cargo test -p pmd-core --test security`: PASS, 13 tests passed.
- `cargo test -p pmd-core`: PASS, all pmd-core tests passed.
- `npm run build` from `ui/`: PASS.

Manual probes against current `pmd_core` output:

- `![x](//example.com/evil.png)` renders `<img src="//example.com/evil.png" alt="x">`.
- Raw `<pre><code class="language-mermaid">graph TD; A-->B</code></pre>` survives sanitization with `class="language-mermaid"`.
- Raw `<code class="language-math">\href{javascript:alert(1)}{x}</code>` survives sanitization with `class="language-math"`.
- Raw `<code class="math-block">x</code>` survives sanitization with `class="math-block"`.
- Indented code `    let x = $E=mc^2$;` renders as literal `language-text` code with no math markers.
- `![**bold** *em* `code`](rel.png)` renders with `alt="bold em code"` but also emits empty `<strong></strong><em></em>`.

## Negative Checks

- `data:` and `asset:` anchors are denied by the attribute-aware `href` filter.
- `data:text/html` images are denied; allowed data images are limited by MIME.
- Remote `http://` image URLs are denied.
- Raw `svg`, `video`, and `source` tags are not in the sanitizer tag allowlist and are stripped in probe.
- Error strings in `ui/src/main.ts` route through `showError`, and `chrome.setStatus` uses `textContent`.

## Recommendation

- Introduce a post-sanitize marker that raw HTML cannot produce, or mark trusted render targets before sanitization and preserve only a private, non-user-producible signal. Do not trust public class names that raw HTML can emit.
- Treat protocol-relative URLs as non-relative for image `src` filtering. For the current CSP intent, `//...` should be denied for images.
- Suppress all child start/end tag emission while collecting image alt text, or build alt text from pulldown's structured events without emitting any child markup.
- Add tests for raw `language-mermaid`, raw `language-math`, raw `math-block`, protocol-relative images, indented code math, and nested formatted alt text.
