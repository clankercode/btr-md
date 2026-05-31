# GitHub Parity — btr.md render profile

btr.md renders Markdown with a **GitHub-flavored (GFM)** profile: the same core
feature set you see in a GitHub README — tables, task lists, strikethrough,
autolinks, fenced code, GitHub alerts, and footnotes — plus math and Mermaid.

This is **not** a bit-for-bit clone of GitHub's renderer. btr.md is a local,
offline-first previewer, so it deliberately differs from GitHub anywhere that
trust, security, or local-file semantics matter. This document lists the
**known, intentional differences**. The regression corpus that locks this
behavior lives in `crates/pmd-core/tests/fixtures/github-parity/` (harness:
`crates/pmd-core/tests/github_parity.rs`).

## Supported, GitHub-compatible

- **GitHub alerts** — `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
  `> [!WARNING]`, `> [!CAUTION]`. The marker must be alone on the first line of
  the blockquote (same rule as GitHub). Rendered as a titled, classed callout.
- **Footnotes** — `[^id]` references and `[^id]: …` definitions, collected into
  a back-linked footnotes section, numbered by reference order. Repeated
  references to one footnote get unique back-link ids.
- **Task lists** — `- [ ]` / `- [x]` render as disabled checkboxes.
- **Tables, strikethrough, fenced code** — standard GFM.

## Intentional differences from GitHub

### Security / trust (the deliberate divergence)

- **Raw HTML is sanitized, not passed through.** GitHub allows a curated subset
  of raw HTML. btr.md runs all output through a strict ammonia-based sanitizer:
  - `<script>` and other active elements are removed.
  - Event-handler attributes (`onerror`, `onclick`, …) are stripped.
  - `javascript:`, `data:text/html`, and `asset:` URLs are stripped from links.
  - Raw HTML cannot spoof btr.md's internal `data-pmd-*` markers or the
    per-render nonce — those are stripped from any untrusted element.
- **Remote images are blocked.** `http(s)://`, protocol-relative (`//host/…`),
  and network-path (`\\host\…`) image sources are removed; only local relative
  images resolve (through the app's scoped-asset path). GitHub proxies and
  serves remote images; btr.md makes no network requests.
- **Links are inert markers.** Markdown links become `data-pmd-link-id` markers
  (no live `href`); navigation is mediated by the app, not the DOM. This keeps
  the preview from making surprise navigations/requests.

### Math (KaTeX)

- `$…$` (inline) and `$$…$$` (block) are recognized and emitted as
  `language-math` / `math-block` code for client-side KaTeX rendering.
- KaTeX runs in **untrusted mode** (no `\href`, `\includegraphics`, etc.).
- **Known limitation:** a backslash-prefixed punctuation command such as the
  thin-space `\,` can be consumed by the Markdown escape pass before reaching
  the math emitter (e.g. `\,dx` becomes `,dx`). This is a fidelity gap vs
  GitHub's math handling, not a security control. See the math fixture.

### Mermaid

- ` ```mermaid ` fences are recognized as trusted diagram sources (carry the
  render nonce) for client-side Mermaid. Mermaid runs in **strict** security
  mode. Raw `<div class="pmd-mermaid">`/`language-mermaid` HTML injected by the
  document is *not* treated as a diagram (the markers are stripped).

### Heading anchors / slugs

- Duplicate headings get GitHub-style suffixed slugs (`hello-world`,
  `hello-world-1`, `hello-world-2`), and explicit `{#custom-id}` anchors are
  honored.
- **Difference:** these slugs are exposed via document *facts* (used for the
  outline/TOC and in-document navigation) rather than emitted as `id=`
  attributes on the rendered `<h*>` elements. Fragment links are resolved by
  the app against the slug table, not by the browser's native anchor jump.

## Regenerating the goldens

The goldens are generated from the current pipeline output (nonce stripped). To
update after an intentional renderer change, render each fixture through
`emit::render_string`, strip the `data-pmd-nonce` attributes, and write the
result to the matching `.expected.html`. See the module docs in
`crates/pmd-core/tests/github_parity.rs`.
