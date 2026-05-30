# Competitive Landscape: Markdown Preview Feature Opportunities

Date: 2026-05-30

Scope: competitor/product landscape for `preview-md`, a Linux-first Rust/Tauri app aiming to be the best Markdown preview renderer on Linux.

Method: current web research, fetched 2026-05-30. This report focuses on user-visible feature expectations and differentiation opportunities. It does not propose changes to the existing implementation.

## Executive Takeaways

The planned/built `preview-md` v1 already covers many modern table-stakes renderer expectations: GFM, source/split/preview modes, live preview, mermaid, KaTeX, syntax highlighting, themes, file browser/tabs/settings, file watching, Linux desktop integration, AppImage/Flatpak, and strict sanitization.

Competitors suggest three high-leverage gaps:

1. Navigation and document intelligence: outline, link validation, references, headings, and local-file navigation are repeatedly present in mature tools.
2. Editing ergonomics around rendered documents: table tools, image paste/drag-drop, smart selection, autocomplete, and command palettes make editors feel complete even when the core renderer is good.
3. Linux-native differentiation: fast local launch, low memory, offline-safe rendering, good desktop integration, and security posture can beat Electron-heavy or note-system-heavy competitors.

## Landscape Notes

- Typora emphasizes single-pane live preview, table editing, syntax highlighting, math, diagrams, front matter, footnotes, file tree, outline, export, word/read-time counts, focus mode, typewriter mode, auto-pairing, and CSS themes. Source: https://typora.io/ and https://support.typora.io/Export/
- MarkText offers WYSIWYG realtime preview, CommonMark/GFM/select Pandoc support, KaTeX math, front matter, emoji, HTML/PDF output, themes, source/typewriter/focus modes, and clipboard image paste. Source: https://github.com/marktext/marktext
- VS Code's built-in Markdown support includes real-time side preview, preview locking, bidirectional editor-preview scroll synchronization, line markers, double-click preview-to-source navigation, rendered Markdown diffs, Mermaid, KaTeX, link validation, find-all-references for headers/links, rename symbol for headers/links, paste/copy image handling, and Copilot alt-text generation. Source: https://code.visualstudio.com/docs/languages/markdown
- Obsidian sets expectations around live preview/source/reading modes, vault search operators, properties/front matter UI, backlinks, graph/local graph, and canvas. Source: https://obsidian.md/help/edit-and-read, https://obsidian.md/help/Plugins/Search, https://obsidian.md/help/properties, https://obsidian.md/help/Plugins/Graph%2Bview, https://obsidian.md/help/plugins/canvas
- Zettlr is strongest for academic/document workflows: citations, Zotero, citation previews, project support, writing statistics, full-text search, split view, snippets/templates, graph view, and Pandoc-backed export formats. Source: https://www.zettlr.com/features and https://docs.zettlr.com/en/editor/markdown-compendium/
- ghostwriter is a Linux/KDE-native reference point for distraction-free writing: large-document-optimized live preview, outline navigation, focus mode, document/session statistics, Pandoc/MultiMarkdown/commonmark export, Hemingway mode, image drag-drop, MathJax via Pandoc, autosave/backups, and a built-in cheat sheet. Source: https://ghostwriter.kde.org/
- Apostrophe shows GNOME-native expectations: comfortable writing UI, distraction-free mode, light/dark/sepia themes, spellchecking, document statistics, live preview, and export to PDF/Word/LibreOffice/LaTeX/HTML slideshows. Source: https://apps.gnome.org/en-GB/Apostrophe/
- ReText is simpler but still normalizes tabs, live preview, spellchecking, CSS styles, syntax highlighting, quick-insert boxes, autosave, MathJax, and custom export functions in Linux markdown-editor expectations. Sources: https://github.com/retext-project/retext and https://www.linuxlinks.com/retext/
- Markdown Preview Enhanced shows what power users expect from preview extensions: automatic scroll sync, math, Mermaid, PlantUML, Pandoc, PDF export, code chunks, and presentation writing. Source: https://packages.pulsar-edit.dev/packages/markdown-preview-enhanced
- Ferrite is an emerging Rust/native competitor claiming fast launch/low memory, native Mermaid, semantic minimap, dual-pane editing, Git integration, wikilinks/backlinks, callouts, frontmatter editor, multi-cursor editing, code folding, session restore, Zen mode, command palette, image/PDF viewer, CJK/Unicode support, and future native LaTeX/math. Source: https://getferrite.dev/

## Ranked Feature Opportunities

| Rank | Feature opportunity | Classification | Release fit | Rationale |
|---:|---|---|---|---|
| 1 | Document outline / table of contents sidebar with click navigation | Necessary | v1 | Typora, ghostwriter, VS Code-adjacent workflows, MarkText, and many preview tools treat an outline as baseline for long Markdown. `preview-md` already emits source-map data, so this is also aligned with "best preview renderer" rather than note-app sprawl. |
| 2 | Local link and fragment validation, with broken-link UI in editor and preview | High-value | v1.1 | VS Code validates file links, header fragments, image links, and references locally. A preview-first Linux app can differentiate by making broken local docs obvious without network access. Keep out of v1 if it threatens renderer/security scope. |
| 3 | Preview-to-source navigation: click or double-click rendered block to reveal source line | High-value | v1.1 | VS Code supports preview/editor synchronization, line markers, and double-click preview-to-source. Existing v1 has forward source-to-preview sync; reverse scroll sync is YAGNI, but targeted click-to-source is smaller and more useful than continuous reverse sync. |
| 4 | Image paste and drag-drop insertion with safe local asset handling | High-value | v1.1 | MarkText supports clipboard image paste; ghostwriter supports drag/drop image URLs; VS Code has rich copy/paste image destinations. For docs authors, images are the daily pain point. This should reuse the existing scoped asset policy and avoid network/image upload behavior. |
| 5 | Table editing helpers: insert table, resize/reorder columns, format existing table | High-value | v1.1 | Typora highlights table resize/reorder/insert; Apostrophe shows table insertion UI; VS Code users rely on extensions for table formatting. This is an editor ergonomics feature, not a renderer requirement, so it should follow v1. |
| 6 | Command palette for app actions, recent files, themes, mode changes, and navigation | High-value | v1.1 | VS Code/Obsidian/Ferrite normalize command palettes for keyboard-first workflows. `preview-md` already has enough commands that discoverability will become a UX bottleneck. Good Linux desktop users often prefer keyboard-driven tools. |
| 7 | Focus / Zen / typewriter modes for source and split writing | Nice-to-have | v1.1 | Typora, MarkText, ghostwriter, Apostrophe, and Ferrite all advertise focus/Zen/typewriter modes. This is expected in writer-oriented editors, but `preview-md`'s core identity is renderer-first, so it should not displace navigation or link/image work. |
| 8 | Writing statistics panel: words, characters, headings, read time, session delta | Nice-to-have | v1.1 | Typora, ghostwriter, Zettlr, Apostrophe, and ReText all expose word/document statistics. A small status-bar count is already planned; a richer panel would make the app feel mature with low security risk. |
| 9 | Front matter/properties preview and lightweight metadata UI | High-value | later | Typora and MarkText support front matter; Obsidian turns YAML properties into structured UI; Zettlr uses metadata for academic/export workflows. For `preview-md`, rendering YAML front matter nicely is valuable, but editing structured properties risks scope creep. |
| 10 | Wikilinks/backlinks and local graph for folders | Nice-to-have | later | Obsidian, Zettlr, and Ferrite set expectations for PKM features, but this conflicts with `preview-md`'s preview-renderer focus. Consider only as local-folder navigation/diagnostics, not a full note app. |
| 11 | Pandoc/export pipeline beyond print/browser export | Nice-to-have | later | Typora, Zettlr, ghostwriter, Apostrophe, ReText, and Markdown Preview Enhanced all emphasize export. The existing spec explicitly parks PDF export for v1, which still looks right: export is broad, dependency-heavy, and can dilute the renderer/security focus. |
| 12 | Diagram power features: Mermaid error overlays, fullscreen/zoom/export, per-diagram copy SVG/PNG | High-value | v1.1 | Mermaid/diagram support is now table stakes in VS Code, Typora, MarkText, Ferrite, MPE, and new lightweight viewers. Since `preview-md` wants to be the best renderer, diagram inspection and error feedback are more on-brand than cloud/plugins. Avoid v1 geometry overrides unless needed. |

## Notes On Explicit v1 YAGNI Items

- Plugins: competitors use plugins heavily, especially Obsidian and VS Code, but for `preview-md` this is a later ecosystem decision. Do not add in v1 or v1.1.
- Non-Linux builds: competitors are mostly cross-platform, but Linux-first is a differentiator. Keep non-Linux later.
- Cloud/sync: Obsidian and newer apps offer sync/collaboration, but this is off-mission. Later or never.
- PDF export: strong market expectation, but dependency and fidelity burden are large. Later remains right.
- Runnable code blocks/code chunks: Markdown Preview Enhanced supports code chunks, but this is a major trust-boundary expansion. Later or never; security review required.
- Custom protocol handlers: useful for Obsidian-style linking, but not necessary for v1.
- Raw HTML toggle: many tools support richer HTML, but strict default security is a differentiator. Later, behind a clear trust UI.
- Reverse scroll sync: continuous reverse sync is not necessary for v1, but targeted preview-to-source navigation should be considered earlier as v1.1.
- Session restore: common in Ferrite-style editors, but can stay later unless user testing shows window/tab loss hurts adoption.
- Mermaid geometry overrides: defer unless Mermaid quality blocks the "best renderer" claim.
- Polling watcher fallback: still later; current landscape does not make this table stakes.
- Block-level incremental render: still performance-driven only. Competitors advertise large-document smoothness; implement only if v1 latency misses its budget.

## Best v1 Additions If Scope Allows

If v1 can absorb only one more competitive feature, add document outline/click navigation. It is the clearest "expected by users" gap and reinforces preview/document navigation.

If v1 can absorb two, add outline plus richer Mermaid error display/diagram inspect controls. Both reinforce renderer quality without turning the app into a note system.

If v1 must stay frozen, preserve the current v1 scope and make v1.1 "document navigation and authoring ergonomics": outline, link validation, preview-to-source click, image paste/drop, table helpers, and command palette.
