# Authoring and Technical-Docs Workflow Feature Opportunities

Date: 2026-05-30

Scope: markdown authoring and technical documentation workflows for `preview-md`, a Linux-first Rust/Tauri markdown preview app whose goal is to be the best markdown preview renderer on Linux.

Non-goals: note-taking platform features, cloud sync, plugins, collaboration, graph views, backlinks, custom protocol handlers, raw-HTML trust toggles, and broad static-site generator replacement.

## Research Signals

- VS Code treats Markdown as a first-class authoring surface with document outline, synchronized preview, smart file/link insertion, paste/drag image handling, local link validation, smart selection, and preview security restrictions. Its link validation covers local files, headings, images, cross-file markdown fragments, and reference links, all locally. Source: https://code.visualstudio.com/docs/languages/markdown
- GitHub's rendered Markdown experience makes outline/table-of-contents, heading anchors, relative links, image embeds, task lists, footnotes, alerts, and Mermaid diagrams part of the baseline expectation for README and docs review. Source: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax and https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams
- Typora highlights long-document outline navigation, current-heading tracking, header search/filter, word/line/character/reading-time statistics, image path handling, YAML frontmatter, and export as core writer ergonomics. Sources: https://support.typora.io/Outline/ , https://support.typora.io/Word-Count/ , https://support.typora.io/Images/ , https://support.typora.io/Export/
- Docs generators such as Docusaurus and MkDocs use Markdown files as a structured doc set, not just standalone documents: filesystem structure, sidebars/navigation, frontmatter, relative links, generated table of contents, and page order matter. Sources: https://docusaurus.io/docs/sidebar , https://docusaurus.io/docs/create-doc , https://www.mkdocs.org/getting-started/
- Technical-writing teams increasingly use docs-as-code checks. Vale positions prose linting as code-like linting for style-guide compliance in Markdown and other text formats. Source: https://docs.vale.sh/
- Mermaid-focused tools emphasize live preview, pan/zoom, full-screen focus, and export/share loops for complex diagrams. That reinforces preview-md's existing Mermaid investment, but suggests diagram inspection controls matter more than source-level geometry overrides. Sources: https://mermaid.js.org/ , https://www.mermaid.tools/
- Recent Markdown community discussions still surface two practical pain points: just opening/editing arbitrary Markdown files without vault/project lock-in, and image/asset handling feeling outdated when paste/drop does not create predictable relative links. Sources: https://www.reddit.com/r/Markdown/comments/1t0qe3s/desperately_looking_for_a_markdown_editor/ , https://www.reddit.com/r/ObsidianMD/comments/1d04raf/

## Ranked Opportunities

### 1. Document Outline and Symbol Navigation

Classification: Necessary

Placement: v1

Add a compact outline panel/overlay generated from headings, with click-to-scroll, current-section highlight, and quick filtering by heading text. This directly improves long README, spec, design doc, and API guide workflows without changing the app into a note system. GitHub, VS Code, Typora, Docusaurus, and MkDocs all reinforce headings as the main document navigation structure.

Rationale: This is the highest daily-use value because it works for every long Markdown file, pairs naturally with preview-md's source maps, and strengthens both preview mode and split mode. It also avoids the v1 YAGNI item of reverse scroll sync: the app can still give readers orientation without implementing bidirectional scroll behavior.

Acceptance shape:

- Extract heading text, level, line range, and GitHub-compatible slug from the existing render/source-map pipeline.
- Show outline as a left side panel or command-palette-style overlay, not a heavy docs browser.
- Highlight the active heading based on editor caret or preview scroll position.
- Support keyboard navigation and heading filter search.

### 2. GitHub Anchor and Local Link Validation

Classification: Necessary

Placement: v1

Validate local Markdown links, image paths, reference links, and heading fragments using GitHub-compatible slug rules. Surface failures in the editor gutter/status bar and in preview as subtle broken-link/broken-image states. VS Code's local-only link validation is a strong model: valuable, private, and aligned with docs-as-code workflows.

Rationale: Broken relative links and stale heading anchors are among the most common docs regressions. This is unusually valuable for a preview app because the app already sees the rendered result and can make link correctness visible at authoring time. It also supports GitHub parity without attempting external network link checking.

Acceptance shape:

- Validate current-file fragments like `#heading`, local files like `../guide.md`, images like `./images/foo.png`, and cross-file fragments like `other.md#heading`.
- Use GitHub heading slug behavior, including duplicate-heading suffixes.
- Keep external `http(s)` link checking out of v1; optionally mark those as unchecked.
- Provide a small link diagnostics panel sorted by severity and line.

### 3. Paste/Drop Image Asset Workflow

Classification: Necessary

Placement: v1

When the user pastes an image from the clipboard or drops an image file into the editor, copy it to a predictable local asset folder and insert a relative Markdown image link. VS Code's `markdown.copyFiles.destination` and Typora's relative-path image handling show that users expect Markdown editors to manage the file-plus-reference split.

Rationale: Markdown image handling is still a daily papercut. preview-md already has a security-scoped local image policy; a paste/drop workflow would turn that policy into a visible advantage. It keeps the app file-based and local, while avoiding cloud upload/image hosting features.

Acceptance shape:

- Default destination: `images/<document-stem>/` or `images/` beside the current file.
- Generate stable, collision-safe filenames such as `screenshot-YYYYMMDD-HHMMSS.png`.
- Insert `![alt text](relative/path.png)` at the cursor.
- For unsaved buffers, prompt to save before accepting pasted images.
- Reuse the existing asset scope checks so inserted images preview immediately.

### 4. Frontmatter Awareness Without Becoming a CMS

Classification: High-value

Placement: v1

Parse YAML/TOML frontmatter enough to recognize common fields (`title`, `description`, `slug`, `sidebar_label`, `sidebar_position`, `tags`, `draft`) and display a compact metadata strip or sidebar section. Do not implement site-generator-specific build behavior.

Rationale: Docusaurus, MkDocs ecosystems, static blogs, and technical-doc sites use frontmatter heavily. preview-md can help authors see whether metadata exists and whether it is syntactically valid, without taking responsibility for the full generator. This is a small feature with high confidence because the renderer already needs to decide whether frontmatter renders or hides.

Acceptance shape:

- Hide frontmatter from preview if the configured flavor treats it as metadata.
- Show parsed metadata in an inspector panel.
- Warn on malformed frontmatter and duplicate common keys.
- Recognize generator hints but keep behavior generic: "Docusaurus-like fields detected", not "Docusaurus project mode".

### 5. GitHub Preview Parity Mode

Classification: High-value

Placement: v1

Add a clear "GitHub parity" rendering profile that aims to match GitHub's current behavior for GFM, heading anchors, alerts, task lists, footnotes, Mermaid, math where applicable, relative links, and sanitized HTML posture. The app already targets GFM; this feature makes the target explicit and testable.

Rationale: For README and PR documentation authors, "will this look right on GitHub?" is the preview question. Parity mode creates a sharp product identity: preview-md is not just pretty, it is trustworthy for the destination most developers use.

Acceptance shape:

- Show the active flavor/profile in status or settings.
- Maintain golden fixtures for GitHub-specific details: alerts, footnotes, duplicate anchors, task lists, relative images, Mermaid fences.
- Document known intentional deviations, especially raw HTML stripping and offline image restrictions.

### 6. Diagram and Math Inspection Controls

Classification: High-value

Placement: v1.1

Add per-rendered-block controls for Mermaid and KaTeX-heavy documents: zoom to fit, actual size, pan/drag, open focused overlay, copy SVG/PNG for diagrams, and show render errors inline with source line references.

Rationale: preview-md already has Mermaid/KaTeX as core pillars. Current Mermaid tools emphasize live preview and zoom/pan because complex diagrams quickly exceed the page. This feature creates real differentiating value while avoiding the parked "mermaid geometry overrides" item; authors need inspection and error feedback more than a custom layout engine.

Acceptance shape:

- Hover or focus toolbar on Mermaid blocks.
- Full-window diagram inspection overlay with keyboard escape.
- Inline Mermaid parse errors with source line range.
- Copy rendered SVG for Mermaid, if security and licensing review allow it.

### 7. Docs Folder Navigation Light Mode

Classification: High-value

Placement: v1.1

Enhance the file browser into a docs-oriented navigator when opening a folder: show Markdown files, folder hierarchy, inferred page titles from frontmatter/H1, and next/previous movement. Avoid generating or serving a static site.

Rationale: Docusaurus and MkDocs workflows are doc-set workflows. Authors often need to move across nearby files while editing one page. A lightweight local navigator fits preview-md's Linux desktop app identity and existing tabs/file browser, but should not become a vault, graph, or CMS.

Acceptance shape:

- Optional folder-open mode, not required for single-file use.
- Title inference: frontmatter `title`, first H1, then filename.
- Next/previous based on filesystem order, optional `sidebar_position`, or discovered `mkdocs.yml`/`sidebars.js` read-only hints later.
- Keep backlinks, graph views, tags databases, and search indexes out of v1.1.

### 8. Spellcheck and Prose Lint Integration

Classification: High-value

Placement: v1.1

Provide built-in spellcheck for editor text plus optional integration with installed local prose tools such as Vale. Show diagnostics inline but keep them local, opt-in, and non-blocking.

Rationale: Technical writers rely on spelling and style feedback, but preview-md should not build a full grammar service. The best local-product fit is: use platform/WebKit spellcheck where available, then optionally run local docs-as-code tools if the repo already has them.

Acceptance shape:

- Enable CodeMirror/WebKit spellcheck if viable on Linux/WebKitGTK.
- Detect `.vale.ini` or `vale.ini` and offer "Run Vale" if `vale` is installed.
- Map diagnostics to line ranges and status-panel entries.
- Do not ship style rules or cloud grammar services.

### 9. Reading/Word/Structure Stats

Classification: High-value

Placement: v1

Expand the existing status bar counts into a small stats popover: words, characters, lines, headings, links, images, code blocks, Mermaid blocks, math blocks, and estimated reading time. Typora treats word/line/character/reading-time stats as normal editor furniture; technical-doc authors also benefit from structural counts.

Rationale: Low implementation risk, frequent passive value, and strong fit for a preview app. This also helps users spot accidental bloat, missing headings, or unexpectedly many images/diagrams.

Acceptance shape:

- Keep primary status compact: line/column, words, path.
- Popover or command reveals extended stats.
- Count Markdown structure from the parsed document, not fragile regexes.
- Include selected-text counts if CodeMirror makes that cheap.

### 10. Print-Ready Preview and HTML Export, but Keep PDF Export Parked

Classification: Nice-to-have

Placement: v1.1 for print stylesheet and HTML export; later for PDF export

Add a polished print stylesheet and "export current rendered HTML" option before full PDF export. Typora and other editors normalize export, but preview-md's existing v1 YAGNI explicitly parks PDF export. A browser/WebKit print path gives users a practical bridge without taking on pagination fidelity as a core v1 promise.

Rationale: Sharing rendered docs with non-technical stakeholders is real, but export can balloon into a product by itself. Print CSS and self-contained/sanitized HTML export support the "preview renderer" mission; first-class PDF generation belongs later unless user demand proves overwhelming.

Acceptance shape:

- `File -> Print` uses a preview-specific print stylesheet.
- `Export HTML` writes sanitized rendered HTML plus active theme CSS.
- Do not promise pixel-perfect paginated output in v1.1.
- Keep Pandoc/PDF/Docx export as later or external-tool integration.

### 11. Lightweight Markdown Formatting and Link Commands

Classification: Nice-to-have

Placement: v1.1

Add a small set of editor commands: wrap selection as link, paste URL over selected text as Markdown link, toggle bold/italic/code, insert fenced code block, insert table skeleton, and insert image link. GitHub and VS Code both expose shortcuts/toolbars that reduce syntax friction without hiding Markdown.

Rationale: Useful, but less central than navigation and validation. This feature should stay command-oriented, not WYSIWYG, so preview-md remains a source-plus-preview app.

Acceptance shape:

- Keyboard-first commands with optional toolbar icons.
- No rich-text editor mode.
- Preserve source text predictability.

### 12. Docs Project Hints and Generator Compatibility Notes

Classification: Nice-to-have

Placement: later

Detect common repo docs files (`mkdocs.yml`, `docusaurus.config.*`, `sidebars.*`, `.vale.ini`) and show read-only compatibility hints: active docs root, probable generator, known unsupported syntax, and relevant commands if configured.

Rationale: Helpful for serious docs-as-code users, but it risks pulling preview-md toward static-site-generator replacement. Keep it as a passive context layer after core single-document authoring is excellent.

Acceptance shape:

- Read-only detection only.
- No build server, no custom plugin execution, no Node/Python dependency.
- Links to local files/configs, not cloud services.

## Recommended Roadmap Shape

v1 should include:

1. Document outline and symbol navigation.
2. GitHub anchor and local link validation.
3. Paste/drop image asset workflow.
4. Frontmatter awareness.
5. GitHub preview parity mode.
6. Reading/word/structure stats.

v1.1 should include:

1. Diagram/math inspection controls.
2. Docs folder navigation light mode.
3. Spellcheck and optional Vale integration.
4. Print-ready preview and HTML export.
5. Lightweight formatting/link commands.

Later should include:

1. Docs project hints.
2. Full PDF export, only if print/HTML export is insufficient.
3. External link checking, only if it can be clearly local-first, cancellable, and non-annoying.

## Features to Keep Out

- Backlinks, graph views, daily notes, tags databases, and vault abstractions: these are note-taking/PKM territory.
- Plugin ecosystem in v1/v1.1: the existing YAGNI call remains correct.
- Cloud image upload: local relative assets are the right default for Linux docs-as-code.
- Runnable code blocks: useful in notebooks and playgrounds, but too much security and execution-sandbox surface for a preview renderer.
- Raw HTML toggle in v1: GitHub parity matters, but preview-md's strict security posture is a product asset. Revisit only with a narrow sanitized mode.
- Block-level incremental render: only revisit if measured latency misses the current budget.

## Product Positioning Summary

The highest-value path is not to become Obsidian, Typora, VS Code, Docusaurus, or MkDocs. It is to be the fast, beautiful, trustworthy Linux app that lets a developer or technical writer open any Markdown file or docs folder and immediately answer:

- Does it render like the destination I care about?
- Can I navigate this long document?
- Are the links, anchors, images, diagrams, and metadata sane?
- Can I paste screenshots and keep the repo clean?
- Can I share or print the rendered result without losing the preview fidelity?

That suggests a v1 feature profile centered on outline, validation, image workflow, frontmatter, GitHub parity, and stats. These features reinforce the existing renderer pillars and create daily-use value without crossing into note-taking platform scope.
