# preview-md Feature Brainstorm Synthesis

Date: 2026-05-30

Inputs:

- `agent-competitive-landscape.md`
- `agent-authoring-workflows.md`
- `agent-linux-desktop-ux.md`
- `agent-security-trust.md`
- Local project context: Rust/Tauri markdown previewer with source/split/preview modes, GFM, Mermaid, KaTeX, themes, multi-tab documents, file browser, settings, diff/merge conflict tooling, Gist/open-with conveniences, custom mono font selection, strict sanitization/resource policy, file watching/save-conflict guards, Linux packaging, and current icon assets.

## Current Repo Drift Check

Checked after recent branch movement on 2026-05-30:

- Commit `c6e2bb4` formatted merged review/feature code in `crates/pmd-app/src/{cmd/doc.rs,doc/registry.rs,doc/state.rs}`, `crates/pmd-app/tests/doc_state.rs`, `crates/pmd-core/src/emit.rs`, and `crates/pmd-core/tests/alerts_footnotes.rs`; those formatting-only code changes do not change this roadmap.
- Recent commits added or advanced diff/merge conflict UI, atomic save guarding, disk-context recovery, Gist/open-with commands, settings for diff/Gist/fonts, editor mono font selection, a feature-ideas backlog, and the app icon/raster set.
- These changes do not displace the top five recommendation. They do affect roadmap wording: file-change/save-conflict UX is now mostly an implementation polish/completeness item, and packaging/commercial polish should focus on the remaining AppStream/Flatpak/portal/screenshot pieces rather than the icon itself.
- `docs/feature-ideas.md` is a useful backlog input, but this synthesis remains the ordering source for the document-intelligence/visible-trust push.

## Executive Recommendation

The highest-value direction is **document intelligence plus visible trust**.

The app already has strong renderer ambition: pretty output, themes, Mermaid, KaTeX, and Linux packaging. The missing layer that competitors repeatedly normalize is not cloud sync, backlinks, plugins, or WYSIWYG editing. It is the set of features that lets a user open a real README/spec/docs page and immediately answer:

- Where am I in this long document?
- Are the links, anchors, images, metadata, and diagrams sane?
- Why did this content render, fail, or get blocked?
- Does it behave like a serious Linux desktop app?

That suggests a near-term roadmap centered on outline/navigation, local validation, image/asset workflow, security transparency, accessibility/keyboard polish, and file-change correctness.

## Ranked Opportunities

### 1. Document Outline and Heading Navigation

Classification: Necessary

Recommended release: v1 if scope is still open; otherwise v1.1

Why: The competitive and authoring agents independently ranked this first. Typora, VS Code, ghostwriter, docs generators, and technical-writing workflows all rely on headings as the navigation spine. This is also on-mission: it strengthens previewing and reading without creating a note-taking platform.

Shape:

- Extract heading text, level, source line/range, and GitHub-compatible slug from the render pipeline.
- Provide a compact outline panel or searchable overlay.
- Click a heading to scroll source and preview.
- Highlight current section from caret or preview scroll.

### 2. Local Link, Anchor, and Image Validation

Classification: Necessary

Recommended release: v1 if feasible; otherwise v1.1

Why: Broken relative links and stale heading anchors are one of the most common docs failures. VS Code already validates local Markdown links, headings, images, cross-file fragments, and reference links. For `preview-md`, this feature is unusually high value because the app already owns the rendered result and local path policy.

Shape:

- Validate `#fragment`, `other.md#fragment`, local file links, local images, and reference links.
- Use GitHub-compatible slug behavior, including duplicate-heading suffixes.
- Keep network link checking out of v1.
- Surface diagnostics in the preview, status bar, and a small diagnostics panel.

### 3. Visible Trust and Resource Policy UI

Classification: Necessary

Recommended release: v1

Why: The current security posture is a product advantage, but only if users can understand it. Silent blocking looks like a renderer bug. VS Code exposes Markdown preview security settings and blocked-content state; Tauri and Flatpak both make explicit scoping part of the app contract.

Shape:

- Show a per-document status such as `Safe Preview` or `Content Blocked`.
- Provide a popover listing restrictions: raw HTML stripped, scripts disabled, remote images blocked, local image roots scoped, Mermaid strict, KaTeX untrusted.
- Return a structured blocked-resource ledger from render/path resolution.
- Include blocked remote images, blocked `file://`, out-of-scope relative paths, and allowed local roots.

### 4. Local Asset Grant and Paste/Drop Image Workflow

Classification: Necessary / High-value

Recommended release: split it: blocked-asset recovery in v1, paste/drop creation in v1.1

Why: Markdown image handling is a daily papercut. The Linux desktop agent emphasized understandable recovery for out-of-scope local assets; the authoring and competitive agents emphasized paste/drop image insertion. This pairs cleanly with the existing scoped asset policy.

Shape:

- In preview, distinguish missing file from not-permitted file.
- Offer `Grant Folder` for blocked local assets through a native/portal folder picker.
- On image paste/drop into a saved document, copy to `images/` or `images/<document-stem>/` and insert a relative Markdown image.
- For unsaved buffers, prompt to save first.

### 5. Linux Accessibility, Keyboard, and Host Preference Gate

Classification: Necessary

Recommended release: v1

Why: Webview apps often feel foreign on Linux when custom chrome, tabs, menus, pickers, and toolbars miss accessibility and keyboard details. The app's stated goal is "best on Linux", so this is not cosmetic.

Shape:

- Standard shortcuts: `Ctrl+N/O/S`, `Shift+Ctrl+S`, `Ctrl+W/Q`, `Ctrl+F/G`, zoom shortcuts, `F10`, `Ctrl+,`, `Ctrl+?`.
- Full keyboard navigation for toolbar, tabs, theme picker, file browser, settings, overlays, and dialogs.
- Accessible names for all icon-only controls.
- High contrast, large text, reduced motion, focus visibility, and screen-reader smoke checks.
- Prefer XDG Settings portal values for color scheme, accent, contrast, and reduced motion where available.

### 6. File-Change and Save-Conflict UX

Classification: Necessary

Recommended release: v1 polish/completion; core machinery has already landed.

Why: A markdown preview/editor will often sit beside Git, static-site generators, other editors, and formatters. Silent stale content or edit loss would hurt trust more than almost any missing renderer flourish.

Shape:

- Treat this as partly covered by the current per-document registry/watcher, `DiskChangedClean`/`DiskChangedDirty` states, reload/merge affordances, CodeMirror diff view, atomic save guard, and disk-context recovery.
- Finish the user-facing polish: ensure clean external updates reload or prompt exactly as intended, dirty external updates never overwrite local edits without confirmation, and merge/reload/status language is obvious.
- Keep or add coverage for atomic-save patterns from common editors.
- Surface non-local filesystem watcher limitations clearly.

### 7. GitHub Parity Mode and Compatibility Notes

Classification: High-value

Recommended release: v1 or v1.1

Why: A large part of the target audience wants to know whether the file will look right on GitHub. `preview-md` already targets GFM; making that explicit creates a sharper product promise and a better test surface.

Shape:

- Show active render profile/flavor.
- Maintain fixtures for alerts, footnotes, task lists, duplicate anchors, Mermaid, math, relative links, and intentional raw-HTML/security deviations.
- Document known differences instead of hiding them.

### 8. Diagram and Math Inspection Controls

Classification: High-value

Recommended release: v1.1

Why: Mermaid and KaTeX are already core differentiators. Competitors increasingly support Mermaid, so the differentiator becomes inspection quality: zoom, pan, focus, errors, and copying.

Shape:

- Per-Mermaid block controls: zoom to fit, actual size, pan, focused overlay, reset.
- Inline Mermaid errors tied back to source lines.
- Copy diagram source and possibly copy SVG/PNG after security review.
- Show Mermaid/KaTeX trust policy at block level later if useful.

### 9. Frontmatter Awareness Without Generator Scope Creep

Classification: High-value

Recommended release: v1.1

Why: Docusaurus, MkDocs, static blogs, and docs-as-code systems use frontmatter heavily. Previewing metadata validity is useful; becoming a site generator is not.

Shape:

- Parse YAML/TOML frontmatter enough to hide/render appropriately and report malformed metadata.
- Recognize common fields such as `title`, `description`, `slug`, `sidebar_label`, `sidebar_position`, `tags`, and `draft`.
- Show a compact metadata inspector.
- Avoid project build behavior, plugins, and generator execution.

### 10. AppStream, Flatpak, Portal, and Software-Center Completeness

Classification: Necessary

Recommended release: v1

Why: For Linux users, the product starts at install time. Placeholder metadata, broad Flatpak permissions, or weak file associations make the app feel unfinished even if the renderer is excellent.

Shape:

- Portal-first open/save in Flatpak.
- Tighten Flatpak filesystem permissions where possible.
- Validate desktop file, MIME XML, AppStream, and installed icons; the core icon/raster set is now landed, so focus on integration and release metadata.
- Add real screenshots with captions showing Markdown, Mermaid, KaTeX, code, and themes.

### 11. Find in Source and Rendered Preview

Classification: High-value

Recommended release: v1.1

Why: Search is a standard desktop command and a practical necessity for long Markdown files. In source mode CodeMirror can handle much of it; preview search needs careful sanitized DOM highlighting.

Shape:

- `Ctrl+F`, `Ctrl+G`, `Shift+Ctrl+G`.
- Explicit source/preview scope in split mode.
- Match counts and keyboard navigation.
- No raw HTML injection for highlights.

### 12. Reading, Word, and Structure Stats

Classification: High-value

Recommended release: v1.1 unless very cheap for v1

Why: Low risk, frequent passive value. Typora, ghostwriter, Zettlr, Apostrophe, and ReText normalize word/document statistics. For a previewer, structure counts also help users spot document problems.

Shape:

- Keep status compact: line/column, words, path.
- Add a popover with words, characters, lines, headings, links, images, code blocks, Mermaid blocks, math blocks, and estimated reading time.
- Prefer parser-derived counts for structure.

## Suggested Roadmap Cut

### v1 Must-Have If Not Already Covered

1. Visible trust/resource policy UI.
2. Linux accessibility, keyboard, and host preference audit.
3. Finish file-change and save-conflict UX polish around the landed registry/watcher/diff/merge core.
4. AppStream/Flatpak/portal/software-center completeness; app icon assets are already landed.
5. Local asset blocked-state recovery.
6. Security regression corpus and WebView fetch sentinel.

### v1 Stretch, High Return

1. Document outline and heading navigation.
2. Local link/anchor/image validation.
3. GitHub parity mode and compatibility notes.

These three are the best "make the app feel indispensable" additions. If scope pressure is high, ship them as the headline v1.1.

### v1.1 Theme

Make v1.1 "document intelligence and authoring ergonomics":

1. Outline if not in v1.
2. Local validation if not in v1.
3. Paste/drop image creation.
4. Diagram/math inspection controls.
5. Find in rendered preview.
6. Frontmatter awareness.
7. Reading/structure stats.
8. Print stylesheet plus system print path, not a full export platform.

### Later

1. Safe standalone HTML export.
2. Privacy-first remote image opt-in.
3. Optional Vale/prose lint integration.
4. Docs folder navigation using inferred titles and order hints.
5. Sanitizer/security inspector command.
6. Hardened Mermaid sandbox mode.

## Keep Out of v1

- Plugin ecosystem.
- Cloud sync/collaboration.
- Backlinks, graph view, vault abstractions, daily notes, tag databases.
- Runnable code blocks.
- Raw HTML trust toggle.
- External network link checking.
- Broad Pandoc/DOCX/EPUB export.
- Full static-site-generator/project build behavior.
- Custom protocol handlers.

## Product Positioning

The strongest positioning is:

> The fast, beautiful, trustworthy Linux app for opening any Markdown file and seeing what is rendered, what is broken, and what was blocked.

The docs-folder promise should remain a later extension until folder semantics, folder-tree behavior, and project navigation are designed explicitly.

That is sharper than "a prettier Typora" or "a smaller Obsidian". It also gives the project a coherent feature filter: add features that improve rendering fidelity, document navigation, local correctness, or visible trust; reject features that turn Markdown preview into a cloud note platform or execution environment.

## Source Pointers

Primary source URLs used across the reports:

- Typora: https://typora.io/ and https://support.typora.io/Export/
- VS Code Markdown: https://code.visualstudio.com/docs/languages/markdown
- Zettlr features/export: https://www.zettlr.com/features and https://docs.zettlr.com/en/export/
- GitHub Markdown syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
- GitHub Mermaid diagrams: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams
- Tauri CSP and asset protocol: https://v2.tauri.app/security/csp/ and https://v2.tauri.app/security/asset-protocol/
- Mermaid security level: https://mermaid.js.org/config/schema-docs/config.html
- KaTeX options: https://katex.org/docs/options.html
- XDG FileChooser portal: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.FileChooser.html
- Freedesktop desktop entry spec: https://specifications.freedesktop.org/desktop-entry-spec/latest-single/
- Flatpak sandbox permissions: https://docs.flatpak.org/en/latest/sandbox-permissions.html
