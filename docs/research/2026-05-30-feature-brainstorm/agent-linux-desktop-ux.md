# Linux desktop UX feature opportunities for preview-md

Date: 2026-05-30

Scope: Linux desktop polish and necessary UX for `preview-md`, a Linux-first Rust/Tauri markdown previewer. This report treats the existing v1 pillars as already planned: GFM rendering, source/split/preview modes, CodeMirror, Mermaid, KaTeX, syntax highlighting, 17 themes, tabs/file browser/settings, file watching, desktop integration, AppImage/Flatpak, and security-focused sanitization. It also respects the current v1 YAGNI fence: plugins, non-Linux builds, cloud, PDF export, runnable code blocks, custom protocol handlers, raw-HTML toggle, reverse scroll sync, session restore, Mermaid geometry overrides, polling watcher fallback, and block-level incremental render.

## Research signals

- Linux desktop integration is still primarily standards-driven: `.desktop` files, reverse-DNS app IDs, `Exec` field codes, `MimeType`, `StartupWMClass`, and static desktop actions are expected by launchers and file managers. The Desktop Entry spec recommends reverse-DNS IDs and notes that dashes are allowed but not recommended for related Flatpak/D-Bus uses. Source: https://specifications.freedesktop.org/desktop-entry-spec/latest-single/
- MIME association behavior is split across Shared MIME data, desktop files, and user/system `mimeapps.list`; this means file association quality is not just "ship a desktop file", but verify `xdg-mime query default text/markdown` and open-with behavior across install modes. Source: https://specifications.freedesktop.org/mime-apps-spec/latest-single/
- Flatpak expects least-privilege filesystem access, preferring portals over blanket filesystem grants; Wayland-capable apps should request `--socket=wayland` plus `--socket=fallback-x11`, and session/system bus access should remain filtered. Source: https://docs.flatpak.org/en/latest/sandbox-permissions.html
- The XDG FileChooser portal gives sandboxed apps user-mediated access to files outside the sandbox, can expose selected files via the Documents portal, and returns `file://` URIs for open/save flows. Source: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.FileChooser.html
- The XDG Settings portal exposes standardized host preferences for `color-scheme`, `accent-color`, `contrast`, and `reduced-motion`. Source: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html
- The XDG Print portal exists for sandboxed printing; it expects apps to prepare print settings, format output, and print the formatted document, with high-level toolkit APIs hiding much of the complexity. Source: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Print.html
- GNOME HIG accessibility guidance expects descriptive accessible names, high-contrast and large-text testing, keyboard-only operation, screen-reader checks, and on-screen-keyboard compatibility. Source: https://developer.gnome.org/hig/guidelines/accessibility.html
- GNOME HIG styling guidance expects light/dark/follow-system choices for text-editing apps and high-contrast testing. Source: https://developer.gnome.org/hig/guidelines/ui-styling.html
- GNOME keyboard guidance expects every action to be usable from the keyboard, standard shortcuts for standard actions, `Ctrl+?` for shortcut help, `Ctrl+O/S/Shift+Ctrl+S`, `Ctrl+F/G`, zoom shortcuts, `F10` menus, and avoidance of reserved Alt/Super shortcuts. Sources: https://developer.gnome.org/hig/guidelines/keyboard.html and https://developer.gnome.org/hig/reference/keyboard.html
- Flathub quality guidance strongly rewards complete metadata: good screenshots, captions, app name/summary discipline, icon quality, brand colors, and current Linux screenshots. Flathub metadata guidance also supports device/control metadata such as keyboard, pointing device, and minimum display size. Sources: https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/quality-guidelines and https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/
- Current markdown app expectations include split preview, source/preview modes, dark mode, full-text search, export/print, outline navigation, focus/typewriter modes, and rich export. Examples: Typora export docs: https://support.typora.io/Export/ ; Typora focus/typewriter docs: https://support.typora.io/Focus-and-Typewriter-Mode/ ; Zettlr feature comparison: https://www.zettlr.com/features ; Zettlr export docs: https://docs.zettlr.com/en/export/ ; MarkText project features: https://github.com/marktext/marktext

## Ranked opportunities

### 1. Portal-first file open/save and Flatpak sandbox tightening

Classification: Necessary

Recommended phase: v1

Add a Linux/Flatpak file-access contract that uses native/portal file pickers for Open, Save, and Save As, persists user-granted document access where appropriate, and removes broad static grants such as `--filesystem=xdg-documents` from release Flatpak builds unless a specific need remains. The current manifest has `--filesystem=xdg-documents`, which is convenient but weaker than the Flatpak guidance to limit static filesystem access and use portals wherever possible.

Rationale: A markdown previewer must handle arbitrary user files, but a trustworthy Flatpak should not ask for broad document access just to open one `.md` file. Portal-mediated access also gives better behavior on Wayland and non-GNOME desktops.

Acceptance shape:

- Release Flatpak opens and saves Markdown through FileChooser portal-backed flows.
- CLI/open-with paths remain supported outside Flatpak and inside Flatpak where document portal paths are provided.
- Markdown image resolution works for files granted by the portal, and blocked local images show a clear in-document placeholder.
- `flatpak run --log-session-bus dev.previewmd.App` shows no broad session-bus dependency beyond portals.

### 2. Local asset grant UX for images and linked resources

Classification: Necessary

Recommended phase: v1

Keep the security boundary, but add user-visible recovery when Markdown references local assets outside the currently granted scope. For example: a broken image block should explain that the image is outside the document grant and offer "Grant Folder" through a portal/native folder chooser. For v1, keep grants per window/session; durable broader grants can wait.

Rationale: Markdown files commonly reference sibling `images/`, `assets/`, or project-level media folders. The existing parent-directory and `images/` policy is good, but users will judge the app by whether their README diagrams render and whether failures are understandable.

Acceptance shape:

- Missing/blocked local image placeholders distinguish "file missing" from "not permitted".
- "Grant Folder" only grants a selected folder and re-renders the current document.
- No raw `file://` HTML or unscoped Tauri asset access is introduced.

### 3. AppStream, Flathub, and software-center completeness pass

Classification: Necessary

Recommended phase: v1

Promote packaging metadata from skeleton to store-ready: real screenshots, screenshot captions, Flathub-friendly summary/name, release detail URLs, developer/project URLs, branding colors if accepted by current schema, control/display metadata, and content rating if required by the target store workflow. Add validation targets for `appstreamcli validate`, `appstreamcli check-syscompat`, `desktop-file-validate`, `update-mime-database`, `update-desktop-database`, and a local GNOME Software/metainfo preview.

Rationale: For Linux users, trust starts before launch. A markdown app with a polished renderer but placeholder metainfo looks unfinished in software centers.

Acceptance shape:

- Metainfo contains 3-6 current Linux window screenshots with captions and no TODO comments.
- Metadata declares desktop-oriented controls: keyboard, pointing, and a realistic minimum display length.
- `.desktop`, MIME XML, icon theme entries, and AppStream all validate in CI or release CI.
- Screenshots use real Markdown content with Mermaid/KaTeX/code/theme examples.

### 4. Accessibility and host-preference audit gate

Classification: Necessary

Recommended phase: v1

Add an explicit accessibility pass for all chrome and custom webview controls: accessible names, logical tab order, keyboard-only operation, focus visibility, screen-reader labels for icon-only controls, high-contrast rendering, large-text scaling, reduced-motion handling, and on-screen-keyboard sanity. Read host preferences via the Settings portal where available: `color-scheme`, `accent-color`, `contrast`, and `reduced-motion`; keep `matchMedia` as a web fallback, not the whole Linux story.

Rationale: preview-md has custom chrome, a CodeMirror editor, theme picker, Mermaid overlays, tabs/file browser/settings, and visual mode controls. These are exactly the places where webview apps often feel alien or inaccessible on Linux.

Acceptance shape:

- Every toolbar, mode, theme, file browser, tab, settings, and overlay control has an accessible name.
- `Tab`, `Shift+Tab`, arrows, `Esc`, `F10`, and `Ctrl+?` behave predictably.
- High-contrast and large-text modes remain usable with no clipped labels or invisible focus rings.
- Reduced-motion disables nonessential crossfades/animated scrolling.

### 5. Standard Linux desktop shortcuts, menus, and command discoverability

Classification: Necessary

Recommended phase: v1

Align commands with GNOME/KDE expectations: `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Shift+Ctrl+S`, `Ctrl+W`, `Ctrl+Q`, `Ctrl+F`, `Ctrl+G`, `Shift+Ctrl+G`, `Ctrl++`, `Ctrl+-`, `Ctrl+0`, `F10`, `Ctrl+,`, and `Ctrl+?`. Keep existing app-specific mode switching, but avoid Alt/Super shortcuts and expose all shortcuts in a searchable dialog or compact overlay.

Rationale: The app wants to feel best-in-class on Linux, not just visually polished. Standard accelerators make it immediately legible to users from GNOME, KDE, Electron apps, and GTK apps.

Acceptance shape:

- Standard shortcuts work in both editor and preview contexts where meaningful.
- Shortcut help is available via `Ctrl+?` and toolbar/menu entry.
- Conflicts with CodeMirror editing shortcuts are documented and resolved intentionally.

### 6. File-change, save-conflict, and external-edit UX

Classification: Necessary

Recommended phase: v1

Turn file watching into user-facing conflict handling: when a watched file changes externally and the buffer is clean, reload with a small toast/status message; when dirty, show a compare-safe choice: keep mine, reload from disk, save as, or copy current buffer. Include non-local filesystem warning UX already planned by the spec, but make it visible enough that users understand stale previews on NFS/CIFS/SSHFS/FUSE.

Rationale: Many Linux markdown workflows involve editors, generators, static-site tools, and Git operations changing files under the app. Losing edits or silently showing stale content is a trust-breaker.

Acceptance shape:

- Clean external updates reload automatically or with a non-modal notice.
- Dirty external updates never overwrite local edits without confirmation.
- Atomic-save patterns from common editors are covered by tests.
- Non-local watcher limitations are surfaced in the status bar and docs.

### 7. Native print and PDF export through WebKit/portal pipeline

Classification: High-value

Recommended phase: v1.1, with a narrow v1 architecture hook

Revisit the current v1 YAGNI decision for Print/PDF after the core app is stable. Keep full export ecosystems out of v1, but reserve architecture for a native Print command and "Print to PDF" quality path using WebKit print rendering and the XDG Print portal in Flatpak. Do not add Pandoc, DOCX, EPUB, or broad exporter profiles in v1.1 unless a later product decision calls for them.

Rationale: Markdown apps now commonly treat PDF/HTML export and print as baseline workflows. Typora and Zettlr both advertise export/print capabilities, and the XDG Print portal exists specifically for sandboxed desktop apps.

Acceptance shape:

- v1.1 supports `Ctrl+P` and desktop print dialog for preview output.
- Print CSS is theme-aware but readable by default, with page breaks and code block wrapping.
- "Export PDF" can initially be "Print to PDF" via the system print dialog, not a separate exporter stack.

### 8. Outline/navigation pane for headings, symbols, and document structure

Classification: High-value

Recommended phase: v1.1

Add a lightweight outline generated from Markdown headings, with click-to-jump, keyboard navigation, and optional search filtering. Keep it document-structure-only; do not grow it into a project graph, backlinks, tags, or PKM system.

Rationale: Long Markdown files, READMEs, specs, and whitepapers need a fast way to move around. Typora emphasizes outline navigation, and Zettlr/Obsidian-style apps normalize document navigation as part of markdown UX.

Acceptance shape:

- Outline reflects sanitized/source-mapped headings and updates after render.
- Clicking a heading scrolls editor and preview consistently.
- Works in source, split, and preview modes without forcing a persistent sidebar.

### 9. Find in source and rendered preview

Classification: High-value

Recommended phase: v1.1

Add `Ctrl+F`, `Ctrl+G`, and `Shift+Ctrl+G` across source and preview. In source mode this can delegate to CodeMirror. In preview mode it should search rendered text and scroll to matches without exposing unsafe HTML traversal. Split mode should make the search scope explicit or provide a source/preview toggle.

Rationale: Search is a standard desktop command and appears in markdown editor comparisons. A preview app that cannot find text inside rendered output feels incomplete once files exceed a few screens.

Acceptance shape:

- Keyboard-first search UI with visible match counts.
- Preview search highlights are sanitized DOM overlays/classes, not raw HTML injection.
- Search state clears predictably when closing the find UI or changing documents.

### 10. Drag-and-drop and "open with" polish

Classification: High-value

Recommended phase: v1.1

Support dropping `.md`, `.markdown`, and related text files onto the window to open them; support dropping an image into the editor as a relative Markdown image reference if and only if the file can be safely represented from the current document location. Preserve multi-file open-with behavior from `%F`.

Rationale: Drag-and-drop is a normal Linux desktop workflow from file managers. It is also a good test of whether sandboxing, path grants, and file associations feel coherent.

Acceptance shape:

- Drop a Markdown file into empty/start state: opens the file.
- Drop multiple Markdown files: follows the app's multi-instance or tab policy consistently.
- Drop unsupported files: non-modal explanation.
- In Flatpak, dropped files use portal/document grants rather than broad filesystem access.

### 11. Rendered-copy and HTML-copy workflows

Classification: Nice-to-have

Recommended phase: later

Add explicit copy modes: copy Markdown source, copy rendered rich text, copy sanitized HTML fragment, and copy Mermaid diagram as SVG/PNG. Keep this behind clear commands rather than changing default clipboard behavior invisibly.

Rationale: Markdown previewers are often used to move rendered content into issue trackers, email, docs, and chat. This is useful, but less essential than file trust, packaging, accessibility, and navigation.

Acceptance shape:

- Sanitized HTML copy uses the same allowlist/trust model as preview rendering.
- Diagram copy does not grant script execution or include unsafe Mermaid markup.
- Clipboard commands are discoverable from context menu and shortcut help.

### 12. Focus/typewriter writing affordances

Classification: Nice-to-have

Recommended phase: later

Consider focus mode and typewriter mode for users who write in preview-md rather than only previewing. Keep this scoped to editor viewport behavior and avoid Vim/Emacs modes, which are already YAGNI'd.

Rationale: Typora and MarkText both advertise focus/typewriter modes, but preview-md's differentiator is renderer quality and Linux trust. This should not displace native UX work.

Acceptance shape:

- Typewriter mode keeps the active line vertically stable.
- Focus mode dims surrounding blocks without hiding content from assistive tech.
- Reduced-motion/high-contrast settings remain respected.

## Suggested v1/v1.1/later split

v1 should include the items that affect trust before or during first launch:

- Portal-first file open/save and Flatpak sandbox tightening.
- Local asset grant UX for images and linked resources.
- AppStream/Flathub/software-center completeness.
- Accessibility and host-preference audit gate.
- Standard Linux shortcuts, menus, and command discoverability.
- File-change/save-conflict/external-edit UX.

v1.1 should add workflows that users expect once they adopt the app:

- Native print and PDF via the system print path.
- Outline/navigation pane.
- Find in source and rendered preview.
- Drag-and-drop and open-with polish.

Later should stay opportunistic:

- Rendered-copy and HTML-copy modes.
- Focus/typewriter mode.

## YAGNI adjustments recommended

- Keep plugins, cloud, non-Linux builds, runnable code, custom protocols, raw HTML toggle, reverse scroll sync, session restore, Mermaid geometry overrides, polling watcher fallback, and block-level incremental render out of v1.
- Move "Print / export to PDF" from "v1 out of scope" to "v1.1 high-value, reserve v1 architecture hook". The feature is common in markdown apps and has a native Linux portal story, but it does not need to block v1.
- Treat portal-first file access, AppStream completeness, accessibility/high-contrast/reduced-motion, and conflict UX as v1 native-Linux requirements rather than optional polish.

## Highest-leverage next planning tasks

1. Add a "Linux trust and packaging" v1 slice covering portal-first open/save, Flatpak permissions, AppStream screenshots/metadata, and validation commands.
2. Add an "Accessibility and keyboard" v1 slice covering accessible names, focus order, standard shortcuts, shortcut help, high contrast, large text, and reduced motion.
3. Add a "File trust UX" v1 slice covering local asset grants, blocked image explanations, external file changes, and save conflict handling.
4. Add v1.1 backlog items for print/PDF, outline, preview search, and drag-and-drop.
