---
title: Document Intelligence + Visible Trust
date: 2026-05-30
status: approved design draft
scope: synthesis items 1-5 from docs/research/2026-05-30-feature-brainstorm/synthesis.md
---

# Document Intelligence + Visible Trust Design

## Goal

Add the shared product layer that makes `preview-md` feel indispensable for real Markdown documents: navigation, local correctness, visible trust, recoverable local asset policy, and Linux-grade keyboard/accessibility behavior.

This work covers synthesis items 1-5 plus the approved broad shared foundation for later frontmatter editing and structure-aware features:

1. Document outline and heading navigation.
2. Local link, anchor, and image validation.
3. Visible trust and resource policy UI.
4. Local asset grant and paste/drop image workflow foundation.
5. Linux accessibility, keyboard, command overlay, and simple keybinding editor.

The design is intentionally a **hybrid linked-spec structure**: one root integration spec defines shared contracts, then five linked feature specs consume those contracts. Execution should implement the heavily shared foundation first, then use subagents heavily across disjoint feature slices.

## Product Position

The product promise for this slice is:

> Open any Markdown file and see what is rendered, what is broken, and what was blocked.

This is not a note platform, static-site generator, cloud sync tool, plugin host, or runnable notebook. Features are included when they improve rendering fidelity, document navigation, local correctness, visible trust, or Linux desktop ergonomics.

## Planning Shape

The chosen planning structure is:

- **Root integration spec:** this document.
- **Shared foundation first:** render facts, async diagnostics, resource ledger, diagnostics model, action registry, keybinding persistence.
- **Five linked feature specs:**
  - [Feature Spec 1: Outline](#feature-spec-1-outline)
  - [Feature Spec 2: Local Validation](#feature-spec-2-local-validation)
  - [Feature Spec 3: Visible Trust and Resource Policy UI](#feature-spec-3-visible-trust-and-resource-policy-ui)
  - [Feature Spec 4: Local Asset Grants and Image Workflow Foundation](#feature-spec-4-local-asset-grants-and-image-workflow-foundation)
  - [Feature Spec 5: Linux Accessibility, Commands, and Keybindings](#feature-spec-5-linux-accessibility-commands-and-keybindings)
- **Subagent-heavy execution after contracts stabilize:** each feature gets disjoint file/module ownership where possible.

The implementation plan should be one plan file with explicit task groups. It may dispatch workers by task group once the shared interfaces are in place.

## Architecture

The design uses a hybrid ownership boundary.

### `pmd-core`: Parse Facts

`pmd-core` owns parse-derived document facts because it already owns Markdown parsing and HTML emission.

Render-time facts are returned with every render:

- HTML and render nonce.
- Source map and block index.
- Headings and generated anchors.
- Links, images, and reference links as written in source.
- Frontmatter source range, raw text, syntax status, and typed common metadata.
- Code, Mermaid, and math spans.
- Structure counts.

These facts must be deterministic, pure, and unit/golden-testable.

### `pmd-app`: Authority Facts

`pmd-app` owns filesystem, scope, and desktop authority because the frontend must not nominate arbitrary paths or permissions.

Authoritative resource resolution runs before HTML is inserted into the webview:

- Canonical path checks.
- Local image, linked-resource, and link-activation policy decisions.
- Rewriting allowed local image paths to scoped asset URLs.
- Replacing blocked or missing resources with inert placeholders.
- Rendering source-authored links as backend-mediated activation targets instead of raw navigable URLs.
- Initial blocked-resource ledger and initial diagnostics for anything that could otherwise load or navigate in the webview.

Async enrichment runs after render and may lag the preview:

- File existence checks for links that do not load resources.
- Cross-file Markdown anchor validation.
- Expanded link diagnostics.
- Grant-folder recovery status.

Resource authorization is never async. No untrusted Markdown URL may reach the webview as a loadable `src` or navigation target before `pmd-app` has either rewritten it to an allowed safe URL or replaced it with a blocked placeholder.

All source-authored links are inert in the inserted HTML. The safe HTML may carry a stable `data-pmd-link-id`, label text, and normalized display fields, but it must not carry the Markdown URL as a browser-navigable `href`, `target`, `download`, or `ping`. Mouse click, keyboard activation, middle-click, context-menu open, drag, and WebView navigation events all route through the same backend-mediated action. Current-document fragment jumps can resolve to in-app scroll actions; local files and external URLs require backend validation and, for external URLs, confirmation before opening outside the app.

Async facts may require filesystem I/O and must be cancellable or newest-wins/coalesced by document identity and render version.

### UI: Presentation State

The UI owns view state and presentation:

- Outline panel state: collapsed, overlay, pinned/docked.
- Diagnostics panel state: hidden when clean, collapsed/expanded when issues exist.
- Inline diagnostic visibility setting.
- Command overlay search state.
- Keybinding editor state.
- Focus, keyboard navigation, and accessibility affordances.

The UI may derive presentation-only facts from backend data, but it should not re-parse Markdown for semantic truth.

## Shared Data Contracts

The exact Rust/TypeScript names may be adjusted during implementation, but the plan should keep the concepts stable.

### Document Identity

Every render, fact set, diagnostic set, and async enrichment result is keyed by:

- `doc_id: u64`
- `version: u64`

The UI must drop any result whose `(doc_id, version)` does not match the currently rendered active document. This matches the existing registry model where open documents are keyed by `DocId`.

### `DocumentFacts`

Returned with `RenderResult`.

Required fields:

- `doc_id: u64`
- `version: u64`
- `headings: Vec<HeadingFact>`
- `anchors: Vec<AnchorFact>`
- `links: Vec<LinkFact>`
- `reference_definitions: Vec<ReferenceDefinitionFact>`
- `images: Vec<ImageFact>`
- `frontmatter: Option<FrontmatterFact>`
- `blocks: Vec<BlockFact>`
- `embedded: EmbeddedFacts`
- `counts: StructureCounts`

`HeadingFact`:

- `level: u8`
- `text: String`
- `slug: String`
- `duplicate_index: u32`
- `line_start: u32`
- `line_end: u32`
- `block_id: String`

`AnchorFact`:

- `slug: String`
- `line_start: u32`
- `line_end: u32`
- `block_id: String`
- `source: AnchorSource`

`AnchorSource` values:

- `heading`
- `explicit_id`
- `footnote`

`LinkFact`:

- `target: Option<String>`
- `title: Option<String>`
- `label_text: String`
- `reference_label: Option<String>`
- `definition_id: Option<String>`
- `line_start: u32`
- `line_end: u32`
- `kind: LinkKind`

`LinkKind` values:

- `fragment`
- `local_markdown`
- `local_file`
- `external_url`
- `mailto`
- `reference`
- `unknown_scheme`

For inline links, `target` is the Markdown destination and `reference_label`/`definition_id` are `None`. For reference links, `reference_label` is the normalized lookup key, `definition_id` points to a matching definition when present, and `target` is `None` when the reference is unresolved.

`ReferenceDefinitionFact`:

- `id: String`
- `label: String`
- `target: String`
- `title: Option<String>`
- `line_start: u32`
- `line_end: u32`
- `duplicate_index: u32`

`ImageFact`:

- `target: Option<String>`
- `alt_text: String`
- `title: Option<String>`
- `reference_label: Option<String>`
- `definition_id: Option<String>`
- `line_start: u32`
- `line_end: u32`

`BlockFact`:

- `id: String`
- `kind: BlockKind`
- `line_start: u32`
- `line_end: u32`
- `parent_id: Option<String>`

`BlockKind` values:

- `paragraph`
- `heading`
- `blockquote`
- `list`
- `list_item`
- `table`
- `table_row`
- `table_cell`
- `code_block`
- `html_block`
- `footnote_definition`
- `rule`

`FrontmatterFact`:

- `format: FrontmatterFormat` (`yaml` or `toml`)
- `line_start: u32`
- `line_end: u32`
- `raw: String`
- `syntax: FrontmatterSyntax`
- `metadata: CommonFrontmatter`

`FrontmatterSyntax` values:

- `valid`
- `malformed`
- `unsupported_format`

Frontmatter foundation is in scope for this slice. The foundation detects YAML/TOML frontmatter, preserves the raw span, parses common fields, and emits diagnostics for malformed frontmatter. Absence is represented by `frontmatter: None`, not by a `FrontmatterSyntax` value. Frontmatter editing UI is out of scope.

`CommonFrontmatter` recognizes at least:

- `title`
- `description`
- `slug`
- `sidebar_label`
- `sidebar_position`
- `tags`
- `draft`

Unknown keys remain available as normalized string-keyed values so future editing support is not blocked.

`EmbeddedFacts`:

- `code_blocks: Vec<EmbeddedSpan>`
- `mermaid_blocks: Vec<EmbeddedSpan>`
- `math_spans: Vec<EmbeddedSpan>`
- `math_blocks: Vec<EmbeddedSpan>`

`EmbeddedSpan`:

- `line_start: u32`
- `line_end: u32`
- `block_id: Option<String>`
- `language_or_kind: Option<String>`

`StructureCounts`:

- words
- bytes
- sentences
- paragraphs
- headings
- links
- images
- code blocks
- Mermaid blocks
- math spans and blocks

### `DocumentDiagnostics`

Returned first by the synchronous trusted render/resource pipeline, then later by async enrichment as a full replacement for the same render/document version.

Required fields:

- `version: u64`
- `doc_id: u64`
- `phase: DiagnosticPhase`
- `issues: Vec<DocumentIssue>`
- `resources: ResourcePolicyReport`
- `link_summary: LinkValidationSummary`

`DiagnosticPhase` values:

- `initial`: synchronous diagnostics returned before safe HTML is inserted.
- `enriched`: async diagnostics after filesystem and cross-file checks finish.

Initial diagnostics include parse/frontmatter issues and all immediate trust/resource-policy issues from synchronous resource resolution. Enriched diagnostics are full replacements, not partial patches: they carry forward still-valid initial issues and add async validation results. The UI replaces diagnostics for the same `(doc_id, version)` when a newer phase arrives and drops any stale `(doc_id, version)`.

`DocumentIssue`:

- `id: String`
- `severity: IssueSeverity`
- `category: IssueCategory`
- `line_start: Option<u32>`
- `line_end: Option<u32>`
- `block_id: Option<String>`
- `message: String`
- `detail: Option<String>`
- `primary_action: Option<ActionId>`

`ActionId` is a stable string id registered in the action registry, such as `asset.grantFolder` or `navigate.openOutline`.

`IssueSeverity`:

- `error`: content is wrong or cannot be resolved.
- `blocked`: content was intentionally blocked by trust/resource policy.
- `warning`: likely issue or degraded behavior.
- `info`: useful status or metadata.

`IssueCategory` values:

- `link`
- `anchor`
- `image`
- `resource_policy`
- `frontmatter`
- `security`
- `accessibility`
- `filesystem`
- `command`

Inline issue messages must be actionable one-liners. An experienced Markdown user should be able to solve the issue from the inline message in almost all cases.

`ResourcePolicyReport`:

- `doc_id`
- `version`
- `allowed_roots: Vec<String>`
- `loaded_resources: Vec<String>`
- `decisions: Vec<ResourceDecision>`

`ResourceDecision`:

- `source_target: String`
- `normalized_target: Option<String>`
- `line_start: u32`
- `line_end: u32`
- `kind: ResourceKind`
- `decision: ResourceDecisionKind`
- `reason: ResourceReason`
- `safe_url: Option<String>`
- `placeholder_id: Option<String>`

`ResourceKind` values:

- `image`
- `link`
- `data_uri`
- `embedded_renderer`

`ResourceDecisionKind` values:

- `allowed`
- `blocked`
- `missing`
- `unchecked`

`ResourceReason` values:

- `allowed_local_scope`
- `remote_blocked`
- `file_url_blocked`
- `outside_allowed_roots`
- `missing_file`
- `invalid_protocol`
- `unsafe_data_uri`
- `external_link_requires_confirmation`
- `not_applicable`

The report is never an authorization source. It explains decisions made by trusted backend policy.

`LinkValidationSummary`:

- `checked: u32`
- `errors: u32`
- `warnings: u32`
- `unchecked_external: u32`
- `pending_async: u32`

### Resource Resolution Pipeline

The render pipeline for documents with a filesystem-backed path is:

1. `pmd-core` emits HTML with unresolved resource/link markers and `DocumentFacts`.
2. `pmd-app` synchronously resolves load-bearing resources and link activation policy against the active document path and `PathScope`.
3. `pmd-app` rewrites allowed local images to scoped asset URLs.
4. `pmd-app` replaces blocked or missing load-bearing resources with inert placeholders carrying stable placeholder ids.
5. `pmd-app` renders source-authored anchors as inert backend-mediated link controls.
6. `pmd-app` returns safe HTML, `DocumentFacts`, and initial `DocumentDiagnostics` including the initial `ResourcePolicyReport`.
7. Async enrichment starts for non-load-bearing local links and cross-file anchors, then returns an enriched full `DocumentDiagnostics` replacement.

For untitled documents, local relative resources are unresolved and represented as blocked or unchecked until the document has a saved path.

## Diagnostics UX Contract

Diagnostics use a layered model.

- **Clean document:** diagnostics panel is completely hidden.
- **Issues present:** diagnostics panel is always reachable, either as a collapsed indicator or expanded details.
- **Collapsed form:** shows error, blocked, warning, and info counts.
- **Expanded form:** groups issues by severity and category, with source location, one-line message, detail, and primary action when available.
- **Inline default:** inline markers/placeholders show one-line actionable messages.
- **Quiet option:** the diagnostics panel can hide inline detail, leaving subtle markers/placeholders for users who want a quieter preview.

Validation, trust/resource policy, local asset grants, and frontmatter diagnostics all use this shared issue model.

## Feature Spec 1: Outline

The outline is a dockable/pinnable panel.

Required behavior:

- Shows headings from `DocumentFacts.headings`.
- Supports click-to-jump.
- Supports keyboard navigation and filter/search.
- Tracks active heading from editor caret or preview scroll.
- Works in source, split, and preview modes.
- Default surface can be collapsed/overlay on narrow windows and docked/pinned when the user chooses.

Important boundaries:

- The file browser remains a separate tab for now.
- The panel architecture should not block an optional VS Code-style folder tree later.
- The outline does not implement backlinks, graph views, tags, or project indexes.

## Feature Spec 2: Local Validation

Validation checks local Markdown correctness without doing network link checking.

Required checks:

- Current-file fragments such as `#heading`.
- Cross-file Markdown fragments such as `other.md#heading`.
- Local file links.
- Local image paths.
- Reference links.
- Duplicate heading slug behavior using GitHub-compatible slugs.

Validation output:

- Uses `DocumentDiagnostics`.
- Surfaces inline one-line errors/warnings.
- Appears in the diagnostics panel when any issue exists.
- Does not fetch external URLs in v1.

Cross-file checks run asynchronously through `pmd-app` because they require filesystem authority.

Async validation budgets:

- Only direct links from the active document are checked; no recursive docs crawl.
- At most 512 link/image/reference facts are checked per render.
- At most 64 distinct cross-file Markdown targets are opened per render.
- At most 1 MiB is read from any single target file and 8 MiB total per render.
- At most four filesystem checks run concurrently.
- Work is cancelled or ignored when `(doc_id, version)` changes.
- Results are cached by canonical path, mtime, and byte length, and invalidated by save, file watcher change, folder grant change, or explicit reload.
- Budget exhaustion produces a warning diagnostic with the skipped count rather than silent partial validation.

## Feature Spec 3: Visible Trust and Resource Policy UI

Trust state makes the existing security posture legible.

Required behavior:

- Status surface shows `Safe Preview` when no trust/resource issues exist.
- Status surface shows `Content Blocked` when content was intentionally blocked.
- A resource policy panel explains active restrictions:
  - raw HTML stripped.
  - scripts disabled.
  - remote images blocked.
  - local images scoped.
  - Mermaid strict.
  - KaTeX untrusted.
- External link activation is backend-mediated and confirmed before opening outside the app.
- Confirmation shows normalized URL, scheme, host, and enough context to spot disguised labels.
- WebView navigation events originating from document content are denied unless they correspond to a backend-issued safe action.
- Trusted-domain persistence may be designed as a later extension; the first plan should not require full trust profiles.

Important boundaries:

- No raw-HTML toggle in this slice.
- No direct WebView remote image loading.
- No custom protocol handler.
- No plugin-based trust expansion.

## Feature Spec 4: Local Asset Grants and Image Workflow Foundation

This feature makes blocked local assets recoverable while preserving the trust boundary.

Required v1 behavior:

- Broken/missing local image state is distinct from blocked/not-permitted local image state.
- Blocked local asset diagnostics include the blocked path in safe form and the reason.
- `Grant Folder` action opens a native/portal folder picker.
- A granted folder re-renders/revalidates the current document and updates the resource policy report.
- Grants are scoped and backend-owned; renderer-supplied strings do not admit paths directly.

Grant lifecycle:

- Grants are session-scoped in v1 and are not persisted across app restarts.
- A granted folder is recursive for resources below that folder after canonicalization.
- Symlink targets are canonicalized; paths resolving outside granted roots remain blocked.
- Grants are owned by `pmd-app`, keyed by window/document context, and mirrored into Tauri asset scope only after the native/portal picker returns.
- Multi-window behavior follows process/window isolation in v1; grants do not silently leak to unrelated windows.
- The resource policy panel lists active grants and supports revocation.
- Revocation removes the backend grant, releases the corresponding Tauri asset scope when no active document/grant still needs it, and re-renders/revalidates affected documents.

Future image workflow foundation:

- The data model and commands leave room for paste/drop image insertion.
- Future paste/drop should copy images to `images/` or `images/<document-stem>/`, then insert a relative Markdown image.
- Unsaved buffers should prompt to save before accepting pasted image files.

## Feature Spec 5: Linux Accessibility, Commands, and Keybindings

This feature turns keyboard behavior into a real action system.

### Action Registry

Every user-visible operation should register an action:

- stable action id.
- label.
- category.
- description.
- default keybindings.
- enabled predicate.
- visible predicate.
- run handler.

Initial categories:

- File
- Document
- Edit
- View
- Navigate
- Theme
- Diagnostics
- Trust
- Assets
- Share
- Settings

The command overlay indexes registered actions and opens with `Ctrl+P`. The shortcut help dialog is generated from the same registry.

Initial action inventory:

| Action id | Label | Default shortcut |
| --- | --- | --- |
| `file.new` | New file | `Ctrl+N` |
| `file.open` | Open file | `Ctrl+O` |
| `file.save` | Save | `Ctrl+S` |
| `file.saveAs` | Save as | `Shift+Ctrl+S` |
| `file.closeTab` | Close tab | `Ctrl+W` |
| `app.quit` | Quit | `Ctrl+Q` |
| `edit.find` | Find | `Ctrl+F` |
| `edit.findNext` | Find next | `Ctrl+G` |
| `edit.findPrevious` | Find previous | `Shift+Ctrl+G` |
| `view.zoomIn` | Zoom in | `Ctrl++` |
| `view.zoomOut` | Zoom out | `Ctrl+-` |
| `view.zoomReset` | Reset zoom | `Ctrl+0` |
| `view.cycleMode` | Cycle mode | `Ctrl+\` |
| `navigate.commandOverlay` | Command overlay | `Ctrl+P` |
| `navigate.outline` | Show outline | `Ctrl+Shift+O` |
| `diagnostics.togglePanel` | Toggle diagnostics | `Ctrl+Shift+M` |
| `theme.pick` | Pick theme | `Ctrl+T` |
| `settings.open` | Settings | `Ctrl+,` |
| `help.shortcuts` | Keyboard shortcuts | `Ctrl+?` |
| `menu.focus` | Focus menu | `F10` |

Existing no-default actions that must be migrated into the registry:

| Action id | Label | Category |
| --- | --- | --- |
| `file.revealInFolder` | Reveal in folder | File |
| `file.openDefaultApp` | Open in default app | File |
| `file.copyPath` | Copy path | File |
| `file.copyFilename` | Copy filename | File |
| `file.copyFileUrl` | Copy file URL | File |
| `file.clearRecent` | Clear recent files | File |
| `document.reloadFromDisk` | Reload from disk | Document |
| `document.mergeDiskChanges` | Merge disk changes | Document |
| `view.toggleWordWrap` | Toggle word wrap | View |
| `view.setDiffMode` | Set diff mode | View |
| `navigate.fileBrowser` | File browser | Navigate |
| `share.openGist` | Open Gist | Share |
| `share.copyGistMarkdown` | Copy Gist Markdown | Share |
| `settings.pickBaseFolder` | Pick file-browser folder | Settings |
| `settings.selectMonoFont` | Select editor font | Settings |
| `settings.setDefaultHandler` | Set as Markdown default | Settings |

These actions begin without new default shortcuts unless listed in the default shortcut table. Any existing legacy shortcut, such as word-wrap toggling, must be imported deliberately into the registry and made visible/rebindable rather than remaining as an unregistered document-level listener.

Shortcut conflict behavior:

- Defaults must be conflict-free within the app.
- User overrides can bind multiple shortcuts to an action.
- Saving an override that conflicts with another enabled action shows a blocking conflict warning.
- A shortcut can be deliberately moved by removing it from the old action and assigning it to the new action.
- The implementation should avoid Alt/Super shortcuts and reserved browser/system shortcuts unless explicitly approved.
- Approved reserved-style defaults in this slice are `Ctrl+P` for command overlay and the existing `Ctrl+T` for theme picker. Do not add more reserved-style defaults without an explicit design decision.
- When a command overlay shortcut conflicts with a future print command, the action registry owns the conflict; this slice keeps `Ctrl+P` for command overlay because that was the approved direction.

### Keybinding Editor

The first keybinding editor is simple but real:

- Users can add or remove shortcuts for actions.
- User overrides persist in settings.
- Conflicts are detected and shown before saving.
- Defaults can be restored per action or globally.

Out of scope:

- Full keybinding profiles.
- Import/export profiles.
- Vim/Emacs/modal editing layers.
- Context-specific language server behavior.

### Accessibility and Host Preferences

Accessibility is a gate for every new surface.

Required checks:

- All controls have accessible names.
- All controls are reachable with keyboard.
- Focus order is logical.
- Focus ring is visible in all bundled themes.
- `Esc` closes overlays/panels where appropriate.
- Reduced motion disables nonessential animations.
- High contrast and large text do not clip critical labels.
- Icon-only buttons have labels/tooltips.
- Standard shortcut coverage includes the initial action inventory above.

Where practical, host preferences should use XDG Settings portal values for color scheme, accent color, contrast, and reduced motion, with browser APIs as fallback.

## Error Handling

Render-time parse facts must not make rendering fail for ordinary malformed document content. For example, malformed frontmatter produces a `FrontmatterFact` with syntax error state and a diagnostic, not a blank preview.

Async diagnostics use newest-wins semantics:

- Diagnostics carry the render/document version they describe.
- The UI drops diagnostics older than the current rendered version.
- Expensive checks are coalesced so rapid typing does not queue stale filesystem work.

Filesystem and resource-policy failures are shown as diagnostics rather than console-only errors when they affect the document. Internal unexpected failures may still log to console, but user-visible failures need an issue row or status message.

## Testing Strategy

Required coverage:

- `pmd-core` unit/golden tests for headings, slug duplicates, links, images, frontmatter detection, embedded blocks, and structure counts.
- `pmd-core` security regression corpus for raw links, remote images, `file://` URLs, unsafe data URIs, reference links, raw HTML anchors, and target/download/ping attributes.
- `pmd-app` tests for path canonicalization, allowed roots, blocked resources, local file existence, and cross-file anchor validation.
- TypeScript unit tests for action registry, keybinding conflicts, diagnostics grouping, and panel state rules.
- TypeScript or e2e tests that every default shortcut in the initial action inventory is registered and conflict-free.
- TypeScript tests that existing no-default actions are registered, searchable in the command overlay, and omitted from conflict checks unless the user binds shortcuts to them.
- WebView fetch/navigation sentinel tests proving blocked remote/local loads and document-originated navigation do not happen, not only that blocked UI appears.
- E2E tests for:
  - outline opens, filters, and jumps.
  - broken link/image diagnostics appear inline and in panel.
  - clean document hides diagnostics panel.
  - blocked resource shows `Content Blocked`.
  - `Grant Folder` revalidates a blocked local asset.
  - command overlay runs actions.
  - shortcut editor persists and detects conflicts.
  - standard shortcuts trigger the expected actions.
  - keyboard-only navigation across toolbar, panels, overlay, settings, and diagnostics.

The implementation plan should keep tests close to each feature slice and add cross-feature e2e only after the shared foundation exists.

## Execution Strategy

The implementation plan should run in this order:

1. Shared data model and render-time `DocumentFacts`.
2. Async diagnostics shell in `pmd-app`, with versioning/coalescing.
3. Action registry and keybinding persistence.
4. Outline UI.
5. Diagnostics panel and inline issue rendering.
6. Local validation.
7. Trust/resource policy UI.
8. Local asset grant recovery.
9. Accessibility and keyboard verification pass across all new surfaces.

Subagents should be used heavily after steps 1-3 define stable contracts. Good worker boundaries:

- `pmd-core` document facts worker.
- `pmd-app` diagnostics/resource enrichment worker.
- action registry/keybinding worker.
- outline UI worker.
- diagnostics/trust UI worker.
- asset grant flow worker.
- accessibility/e2e verification worker.

Workers must not share write scopes without an explicit integration task.

## Out of Scope

This design does not include:

- plugin ecosystem.
- cloud sync or collaboration.
- backlinks, graph view, vault abstractions, daily notes, tag databases.
- runnable code blocks.
- raw HTML trust toggle.
- external network link checking.
- broad Pandoc/DOCX/EPUB export.
- full static-site-generator behavior.
- custom protocol handlers.
- full keybinding profiles or Vim/Emacs modal layers.

## Approval Notes

Approved design decisions from the brainstorming session:

- Hybrid linked-spec structure: root integration spec plus five linked feature specs.
- Broad shared foundation, keeping later frontmatter editing support in mind.
- Hybrid analysis boundary: `pmd-core` parse facts, `pmd-app` authority/resource facts, UI presentation state.
- Tiered freshness: render-time parse facts plus async filesystem/cross-file enrichment.
- Frontmatter foundation: typed common metadata, not a full editing AST yet.
- Diagnostics UX: layered status, inline messages, and panel; panel hidden only when clean.
- Outline UI: dockable/pinnable panel, with command overlay support.
- File browser: remains a separate tab first; optional folder tree remains possible later.
- Action system: registry, command overlay, shortcut help, persisted simple keybinding editor.
