# Round-3 Security Re-review: Markdown Rendering and Sanitizer

Date: 2026-05-25
Reviewer: Codex
Scope: `crates/pmd-core/src/emit.rs`, `crates/pmd-core/src/sanitize/allowlist.rs`, `ui/src/main.ts`, `ui/src/mermaid_runner.ts`, `ui/src/katex_runner.ts`, `ui/src/theme_apply.ts`, `crates/pmd-core/tests/security.rs`
Authorization boundary: local passive source review, local test execution, and local sanitizer probes only.

## Executive Summary

Verdict: FAIL.

The prior round-3 fixes close T1-M3-R, T1-M6-R for slash protocol-relative Markdown images, T1-M5-R, and the requested tests are present. A fresh image URL edge remains: backslash-prefixed network-path URLs can survive the image `src` filter because the sanitizer only treats `/`, `?`, and `#` as relative delimiters and only special-cases `//`.

## System Overview and Trust Boundaries

Markdown is parsed by `pulldown-cmark`, emitted into HTML with a per-render nonce for trusted Mermaid/KaTeX targets, sanitized by Ammonia with a nonce-aware attribute filter, then inserted into the preview DOM. The frontend adds renderer-only classes/source attributes after sanitization only to nodes carrying the current nonce.

Protected assets and invariants:
- Raw HTML must not opt into Mermaid/KaTeX rendering.
- Remote image URLs should not survive as image `src` values unless explicitly allowed.
- Renderer trust markers should not be replayable across renders.

Attacker capability assumed: attacker controls Markdown content, including raw HTML permitted by Markdown, but cannot run arbitrary JavaScript before sanitization.

## Corpus and Coverage

Coverage ledger: `reviews/2026-05-25-sec-review-markdown-sanitizer-round3-COVERAGE-1.md`.

## Findings

| ID | Title | Severity | Exploitability | Impact | Confidence | Affected Surface | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1-R3-M1 | Backslash network-path image URLs survive the sanitizer | Major | Medium | Sanitizer/CSP policy mismatch; possible remote/asset-host image load depending WebView URL resolution | High | `allowlist.rs` image URL filtering | Open |
| T1-R3-N1 | Render nonce allowlist is value-only, not element-aware | Nit | Low | Defense-in-depth gap if future code broadens nonce selectors | Medium | `allowlist.rs` nonce filtering | Open |

## Attack Hypotheses

| Attack | Method | Preconditions | Target/Invariants | Severity | Correctness/Confidence | Detection | Thwarting/Mitigation | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raw HTML reaches Mermaid/KaTeX | Preserve public renderer classes in raw HTML | Raw HTML allowed | Renderer trust boundary | Major | Refuted/high | Source walk and probes | Current render nonce required | Raw classes survive but no nonce/trust marker | Closed |
| Old nonce replay | Copy a previous trusted fragment into new Markdown | Prior render visible | Replay protection | Major | Refuted/high | Probe old nonce into new render | New random nonce per render; old nonce stripped | Old nonce removed from raw fragment | Closed |
| Backslash image network path | Use `\\host\path` in raw HTML or angle-bracket Markdown image destination | Raw HTML or Markdown image destination allowed | Remote image denial | Major | Confirmed/high | Probe sanitizer output and WHATWG URL parsing | Treat `\` as URL path delimiter/network-path introducer | `src="\\host\x.png"` survives | Open |

## Detailed Findings

### T1-R3-M1: Backslash Network-path Image URLs Survive the Sanitizer

`url_scheme` strips leading ASCII whitespace/control characters and explicitly rejects only `//` as protocol-relative. During scanning it treats `/`, `?`, and `#` as relative URL delimiters, but not `\`. `filter_img_src` then accepts `None` from `url_scheme` as a relative image path.

Manual probes against current HEAD showed:
- `![x](<\\\host\x.png>)` renders an image with `src="\\host\x.png"`.
- Raw `<img src="\\host\x.png" alt="x">` survives `clean`.
- Node/WHATWG URL parsing resolves `"\\\\host\\x.png"` against an HTTPS base as `https://host/x.png`.

This is the same policy class as the fixed `//host/x.png` case: the sanitizer intends to deny remote image URLs, but a browser URL parser can interpret the retained value as a network-path URL. CSP should be a backstop for arbitrary remote hosts, but the sanitizer should not emit a URL form that depends on CSP/WebView behavior to stay safe.

Recommended fix: normalize or reject `\` before scheme classification. At minimum, after trimming leading URL whitespace/control characters, reject values starting with `//`, `\\`, `/\`, or `\/`, and treat `\` like `/` as a path delimiter while scanning for a scheme.

### T1-R3-N1: Render Nonce Allowlist Is Value-only, Not Element-aware

The `data-pmd-nonce` filter preserves any attribute whose value equals the current render nonce, regardless of element or class. Current exploitation still requires knowing the fresh nonce before sanitization, and old nonce replay was not reproducible, so this is not a live T1-M3-R bypass. It is a narrow hardening gap because a matching nonce can remain on arbitrary allowed elements instead of only renderer-owned code targets.

Recommended fix: scope `data-pmd-nonce` preservation to the exact emitted renderer target shapes, or document the nonce as the sole trust predicate and keep all frontend selectors strict.

## Negative Findings

- T1-M3-R appears closed: trusted Mermaid/math emitters add `data-pmd-nonce`; raw HTML can preserve public syntax classes but the sanitizer strips attacker nonce values, and the frontend only marks/renders nodes matching the current nonce.
- T1-M6-R slash form appears closed: `![x](//host/x.png)` no longer renders a `src`.
- T1-M5-R appears closed: formatted image alt text is accumulated as plain alt text and does not emit empty inline nodes.
- T1-M7-R is improved: the test file now includes nonce marker tests for trusted Mermaid and raw Mermaid/math, protocol-relative slash image stripping, and formatted alt suppression.
- Mixed-case `data:`/`asset:` image schemes behave as intended. `https:/host`, leading-tab `https://`, leading-tab `//host`, and leading RTL mark before `https://` are stripped for images.
- Old nonce replay was not reproducible: a copied previous nonce is removed on the next render because the new render has a different nonce.
- Raw HTML with a nonmatching or previous `data-pmd-nonce` is stripped; only a value equal to the current render nonce is preserved.

## Unknowns and Gaps

- No live Tauri WebView instrumentation was run to observe actual image fetches or CSP violations.
- No independent subagent review was run; the user requested a targeted re-review and did not authorize delegation.

## Remediation and Verification Plan

- Add sanitizer tests for raw `<img src="\\host\x.png">`, Markdown image destinations that emit `src="\\host\x.png"`, and mixed slash/backslash variants.
- Update `url_scheme`/`filter_img_src` to reject backslash network-path forms and to use the same delimiter treatment as browser URL parsing for special URLs.
- Re-run `cargo test -p pmd-core --test security` and a UI build.

## Independent Review Log

- Local self-review status: FAIL due T1-R3-M1.
- Independent delegated review: not performed; delegation was not requested/permitted for this turn.
