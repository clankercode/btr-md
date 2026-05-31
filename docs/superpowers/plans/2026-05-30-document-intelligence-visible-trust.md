# Document Intelligence + Visible Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every independently mergeable workstream runs in a dedicated project-local git worktree such as `.worktrees/dit-core-facts` and merges back into the current integration branch after review; closely coupled numbered blocks marked as the same workstream are sequential phases inside that worktree.

**Goal:** Build the shared document-intelligence and visible-trust layer for `preview-md`: outline navigation, local validation, visible resource policy, recoverable local asset grants, and Linux-grade command/keybinding accessibility.

**Architecture:** `pmd-core` owns pure deterministic parse facts and inert render markers; `pmd-app` owns document identity, filesystem authority, safe HTML rewriting, diagnostics, validation, grants, and backend-mediated link activation; the UI owns presentation state, commands, panels, and accessibility. Shared contracts land first so later workers can develop outline, diagnostics, validation, trust, and grant flows in parallel without inventing incompatible shapes.

**Tech Stack:** Rust stable, Tauri 2.x, `pulldown-cmark`, `ammonia`, `toml`, `yaml-rust2` 0.11.0 for YAML frontmatter metadata, CodeMirror 6, TypeScript modules tested with `node --test`, Playwright e2e, existing `just` commands, and `ccc --yolo @cx-reviewer` review loops for plan/spec gates.

---

## References

- Canonical spec: `docs/superpowers/specs/2026-05-30-document-intelligence-visible-trust-design.md`
- Research synthesis: `docs/research/2026-05-30-feature-brainstorm/synthesis.md`
- Existing implementation plan style: `docs/superpowers/plans/2026-05-24-preview-md.md`
- Worktree root: `.worktrees/` at the repository root. It is already gitignored.

## Current Baseline

Fresh baseline command run in the plan worktree:

```bash
cargo test --workspace --all-targets
```

Observed result on 2026-05-30:

- Rust unit, integration, property, golden, security, theme, and app command tests passed before e2e.
- `crates/pmd-e2e/tests/file_open.rs::file_open_app_launches_with_cli_argv` failed because WebDriver was not listening at `127.0.0.1:4444`.

Implementation workers should use `just check` for the default non-WebDriver gate. Security sentinel tests in `crates/pmd-e2e/tests/navigation_policy.rs` are release-blocking once Block 12 exists; start the repo e2e harness with `just e2e` or the documented WebDriver setup before claiming final PASS.

## Execution Status

Updated 2026-05-31 after merging `dit-actions-keybindings` into `feat/large-expansion`:

- Blocks 1-3, `dit-core-facts`: merged into `feat/large-expansion` as `d062d9c`, `a7cf6db`, and `5d87966`.
- Block 4, app preview authority shell: merged as `2451545` with implementation commit `d66162f`; `ccc --yolo @cx-reviewer` returned `PASS` after the rebase.
- Post-rebase rustfmt cleanup from `master` landed as `d2c10fc` so worker baselines start with `cargo fmt --check` clean.
- Block 5, synchronous resource policy: implemented as `85d5736`; focused verification and `ccc --yolo @cx-reviewer` returned `PASS`.
- Block 6, backend-mediated link activation: implemented as `6109dad`; fixed the reviewer-found stale external-confirmation token case, reran verification, and `ccc --yolo @cx-reviewer` returned `PASS` with WebView navigation sentinel coverage still provisional until Block 12.
- Blocks 4-6, `dit-app-authority`: merged back into `feat/large-expansion` as `6d22101`; root `just check` passed after merge.
- Block 7, async local validation: implemented as `35f5cf5`; `ccc --yolo @cx-reviewer` returned `PASS`; root `just test-ipc`, `cargo check -p pmd-e2e --tests -j 2`, and `npm run typecheck` passed after merge.
- Block 7, `dit-validation`: merged back into `feat/large-expansion` as `2f8553c`.
- Block 8, action registry and keybinding persistence: implemented as `9960503`; rebased onto Block 7; fixed the ccc-found stale tracked UI bundle artifact; final `ccc --yolo @cx-reviewer` returned `PASS`.
- Block 8, `dit-actions-keybindings`: merged back into `feat/large-expansion` as `8d47a6d`; root `just check` passed after merge, including 19 Playwright tests.
- Next active workstreams: Block 9, `dit-outline`, and Block 10, `dit-diagnostics-ui`, both after the shared fact/action/validation foundation.

## Operating Contract

### Worktrees

Do not start implementation workstreams from this plan worktree while the plan file is uncommitted or unmerged. First commit this plan branch, merge it into the repository checkout that will receive feature work, and run the following commands from that root checkout. The guard below prevents accidentally creating nested implementation worktrees inside `.worktrees/plan-document-intelligence-visible-trust`.

```bash
INTEGRATION_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_BRANCH="$(git branch --show-current)"
test -n "$INTEGRATION_BRANCH"
case "$INTEGRATION_ROOT" in
    */.worktrees/*)
        echo "Run implementation from the merged integration checkout, not from a linked plan worktree." >&2
        exit 1
        ;;
esac
test -f "$INTEGRATION_ROOT/docs/superpowers/plans/2026-05-30-document-intelligence-visible-trust.md"
```

Then create each implementation workstream from that current integration branch in a project-local worktree. Set `WORKSTREAM` to one of the exact slugs in the dependency DAG, such as `dit-core-facts`:

```bash
WORKSTREAM=dit-core-facts
case "$WORKSTREAM" in
    dit-core-facts|dit-app-authority|dit-validation|dit-actions-keybindings|dit-outline|dit-diagnostics-trust|dit-asset-grants|dit-accessibility-e2e) ;;
    *)
        echo "Unknown workstream: $WORKSTREAM" >&2
        exit 1
        ;;
esac
cd "$INTEGRATION_ROOT"
git switch "$INTEGRATION_BRANCH"
git pull --ff-only
git worktree add ".worktrees/${WORKSTREAM}" -b "work/${WORKSTREAM}" HEAD
cd ".worktrees/${WORKSTREAM}"
```

If the integration branch changes because another merge lands into `master` or another branch, recompute `INTEGRATION_ROOT` and `INTEGRATION_BRANCH` in the checkout that contains the latest merged plan before creating the next block.

Each block's final step lists the exact `git add`, commit message, and merge command for that workstream. Before running any final merge command from a workstream, recompute the integration checkout from the project-local worktree path:

```bash
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
test -f "$INTEGRATION_ROOT/docs/superpowers/plans/2026-05-30-document-intelligence-visible-trust.md"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
```

Do not share a worktree between unrelated workstreams. Numbered blocks marked as the same workstream are sequential phases and may share that worktree. Do not edit files outside the block's ownership list unless the block explicitly says it is an integration task.

### Subagents

Use subagents heavily after the core facts, app authority, and action/keybinding workstreams define stable contracts:

- One worker owns `pmd-core` facts and security tests.
- One worker owns `pmd-app` preview authority, resource policy, validation, grants, and link activation.
- One worker owns action registry and keybinding persistence.
- One worker owns outline UI.
- One worker owns diagnostics, trust UI, and resource policy surfaces.
- One worker owns asset grant UI and e2e recovery flows.
- One worker owns accessibility and e2e verification.

Workers must receive exact file ownership in their prompt and must not rewrite another worker's files. Integration conflicts are resolved in the integration branch after each workstream is merged.

### Dependency DAG and Shared Surfaces

Execute these workstreams in dependency order:

1. `dit-core-facts`: Blocks 1-3, sequential in one worktree.
2. `dit-app-authority`: Blocks 4-6, sequential in one worktree.
3. `dit-validation`: Block 7, after `dit-app-authority`.
4. `dit-actions-keybindings`: Block 8, after `dit-app-authority`.
5. `dit-outline`: Block 9, after `dit-actions-keybindings`.
6. `dit-diagnostics-trust`: Block 10, after `dit-outline`, `dit-actions-keybindings`, and `dit-validation`.
7. `dit-asset-grants`: Block 11, after `dit-diagnostics-trust`.
8. `dit-accessibility-e2e`: Block 12, final integration and release gate.

Subagents may run in parallel only when their write sets are disjoint. The integration owner serializes edits to these shared surfaces:

- `ui/src/main.ts`
- `ui/src/actions.ts`
- `ui/styles/components.css`
- `ui/styles/base.css`
- `ui/e2e/helpers.cjs`
- `ui/e2e/trust-policy.spec.cjs`
- `crates/pmd-app/src/preview/contracts.rs`
- `crates/pmd-app/src/main.rs`

Feature workers may create focused modules and tests in parallel, but shared-surface changes are applied by the integration owner in DAG order. When a block's file list says `Integration-owner modify`, that path is listed so the integration owner can wire modules together after the feature worker finishes its focused files. The feature worker prompt must exclude those paths from its write scope. The integration owner applies those edits after reviewing the worker output, then runs that block's tests and `ccc-review-cx` before commit.

### Review Gates

For every plan or spec created while executing this work:

```bash
ccc --yolo @cx-reviewer "Review docs/superpowers/plans/2026-05-30-document-intelligence-visible-trust.md against docs/superpowers/specs/2026-05-30-document-intelligence-visible-trust-design.md and implementation-plan standards. Return PASS only if it is complete, executable, internally consistent, and free of placeholders."
```

Repeat the review/fix loop until the reviewer returns `PASS`.

For implementation blocks, run a code review before merge:

```bash
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
REVIEW_BASE="$(git merge-base HEAD "$INTEGRATION_BRANCH")"
ccc --yolo @cx-reviewer "Review the diff from ${REVIEW_BASE} to HEAD for correctness, security, tests, and plan compliance. Return PASS or concrete blocking issues."
```

Fix all blocker and major findings before merging.

## File Structure

### `pmd-core`

Create:

- `crates/pmd-core/src/facts/mod.rs`: public serializable fact contracts and type exports.
- `crates/pmd-core/src/facts/builder.rs`: private builder that consumes parser events and byte ranges.
- `crates/pmd-core/src/facts/slug.rs`: GitHub-compatible heading slugger and duplicate tracker.
- `crates/pmd-core/src/facts/frontmatter.rs`: frontmatter delimiter detection, raw range preservation, common metadata extraction, and syntax status.
- `crates/pmd-core/src/facts/links.rs`: link/image/reference classification helpers.
- `crates/pmd-core/src/facts/counts.rs`: structure count helpers.

Modify:

- `crates/pmd-core/src/lib.rs`: export `facts`.
- `crates/pmd-core/src/emit.rs`: add fact collection and emit inert `data-pmd-*` markers for source-authored links/images.
- `crates/pmd-core/src/parse.rs`: replace the current phase-2 stub with parser options and pre-pass helpers.
- `crates/pmd-core/src/source_map.rs`: move line/range helpers out of `emit.rs`.
- `crates/pmd-core/src/sanitize/allowlist.rs`: strip source-authored `data-pmd-*`, `target`, `download`, and `ping`.

Tests:

- `crates/pmd-core/tests/document_facts_headings.rs`
- `crates/pmd-core/tests/document_facts_links.rs`
- `crates/pmd-core/tests/document_facts_frontmatter.rs`
- `crates/pmd-core/tests/document_facts_blocks.rs`
- `crates/pmd-core/tests/document_facts_embedded_counts.rs`
- Update `crates/pmd-core/tests/security.rs`
- Update `crates/pmd-core/tests/alerts_footnotes.rs`

### `pmd-app`

Create:

- `crates/pmd-app/src/preview/mod.rs`: preview authority module exports.
- `crates/pmd-app/src/preview/contracts.rs`: app-facing render, diagnostics, resource, and link activation DTOs.
- `crates/pmd-app/src/preview/render_pipeline.rs`: core render result plus safe HTML rewrite.
- `crates/pmd-app/src/preview/resource_policy.rs`: synchronous resource decisions and safe local image rewriting.
- `crates/pmd-app/src/preview/validation.rs`: async local validation engine and budgets.
- `crates/pmd-app/src/preview/grants.rs`: session-scoped asset grants and revocation.
- `crates/pmd-app/src/preview/link_activation.rs`: backend-mediated link activation and external confirmation DTOs.

Modify:

- `crates/pmd-app/src/lib.rs`: export `preview`.
- `crates/pmd-app/src/main.rs`: register new commands and state.
- `crates/pmd-app/src/cmd/mod.rs`: export preview commands.
- `crates/pmd-app/src/cmd/render.rs`: accept `doc_id`, `version`, and `markdown`; return safe HTML, facts, and initial diagnostics.
- `crates/pmd-app/src/cmd/settings.rs`: persist keybinding overrides.
- `crates/pmd-app/src/state/settings.rs`: add shortcut settings schema.
- `crates/pmd-app/src/cmd/reveal.rs`: route document-originated link opens through preview link activation.
- `crates/pmd-app/src/doc/registry.rs`: provide active document path snapshots for render/validation.
- `crates/pmd-app/src/path_scope.rs`: keep existing file-browser authority separate from session asset grants.

Tests:

- `crates/pmd-app/tests/cmd_render.rs`
- `crates/pmd-app/tests/resource_policy.rs`
- `crates/pmd-app/tests/async_validation.rs`
- `crates/pmd-app/tests/asset_grants.rs`
- `crates/pmd-app/tests/link_activation.rs`
- `crates/pmd-app/tests/cmd_settings.rs`

### UI

Create:

- `ui/src/document_contracts.ts`: TypeScript mirrors of render, facts, diagnostics, resource, and action DTOs.
- `ui/src/document_facts_store.ts`: newest-wins store keyed by `docId` and `version`.
- `ui/src/diagnostics.ts`: grouping, counts, inline visibility state, and issue lookup helpers.
- `ui/src/link_activation.ts`: inert link handlers and backend command calls.
- `ui/src/resource_policy.ts`: trust/resource presentation helpers.
- `ui/src/actions.ts`: pure action registry metadata and action registration.
- `ui/src/keybindings.ts`: shortcut normalization, lookup, conflict detection, and override merge.
- `ui/src/command_overlay.ts`: command palette UI.
- `ui/src/shortcut_editor.ts`: simple keybinding editor UI.
- `ui/src/outline_panel.ts`: outline panel UI.
- `ui/src/diagnostics_panel.ts`: diagnostics panel UI.
- `ui/src/inline_issues.ts`: inline issue marker and placeholder rendering.
- `ui/src/trust_policy_panel.ts`: trust/resource panel UI.
- `ui/src/local_asset_grants.ts`: grant/revoke UI hooks.

Modify:

- `ui/src/main.ts`: pass `docId` to render, consume facts/diagnostics, drop stale results, remove unregistered shortcut listeners.
- `ui/src/hotkeys.ts`: replace static shortcut help and direct listener with registry-backed help.
- `ui/src/chrome.ts`: register menu/toolbar operations as actions.
- `ui/src/settings_menu.ts`: host keybinding editor entry and persisted settings.
- `ui/src/file_browser.ts`: expose file-browser operations through registered actions and keyboardable tree semantics.
- `ui/src/tabbar.ts`: add registered tab actions and arrow-key navigation.
- `ui/src/editor.ts`: expose find and source navigation action hooks.
- `ui/src/codemirror-entry.ts`: export find/search commands used by actions.
- `ui/styles/components.css`: panels, inline markers, command overlay, shortcut editor, trust status, focus states.
- `ui/styles/base.css`: stable layout reservations for diagnostics and outline surfaces.
- `ui/tsconfig.json`: include new pure TS modules.

Tests:

- `ui/src/actions.test.ts`
- `ui/src/keybindings.test.ts`
- `ui/src/diagnostics.test.ts`
- `ui/src/document_facts_store.test.ts`
- `ui/src/resource_policy.test.ts`
- `ui/src/link_activation.test.ts`
- `ui/e2e/document-intelligence.spec.cjs`
- `ui/e2e/trust-policy.spec.cjs`
- `ui/e2e/commands-keybindings.spec.cjs`
- `ui/e2e/accessibility.spec.cjs`

### E2E Harness

Modify:

- `ui/e2e/helpers.cjs`: render-result mocks, active doc ids, backend command stubs, and keyboard helpers.
- `crates/pmd-e2e/tests/helpers/mod.rs`: WebDriver helper support for link and asset grant flows.

Create:

- `crates/pmd-e2e/tests/navigation_policy.rs`
- `crates/pmd-e2e/tests/asset_grants.rs`

## Shared Contracts

### Rust Core Facts

`pmd-core` exposes pure facts without filesystem authority:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreDocumentFacts {
    pub headings: Vec<HeadingFact>,
    pub anchors: Vec<AnchorFact>,
    pub links: Vec<LinkFact>,
    pub reference_definitions: Vec<ReferenceDefinitionFact>,
    pub images: Vec<ImageFact>,
    pub frontmatter: Option<FrontmatterFact>,
    pub blocks: Vec<BlockFact>,
    pub embedded: EmbeddedFacts,
    pub counts: StructureCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnchorFact {
    pub slug: String,
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: String,
    pub source: AnchorSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkFact {
    pub target: Option<String>,
    pub title: Option<String>,
    pub label_text: String,
    pub reference_label: Option<String>,
    pub definition_id: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub kind: LinkKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReferenceDefinitionFact {
    pub id: String,
    pub label: String,
    pub target: String,
    pub title: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub duplicate_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageFact {
    pub target: Option<String>,
    pub alt_text: String,
    pub title: Option<String>,
    pub reference_label: Option<String>,
    pub definition_id: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockFact {
    pub id: String,
    pub kind: BlockKind,
    pub line_start: u32,
    pub line_end: u32,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrontmatterFact {
    pub format: FrontmatterFormat,
    pub line_start: u32,
    pub line_end: u32,
    pub raw: String,
    pub syntax: FrontmatterSyntax,
    pub metadata: CommonFrontmatter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CommonFrontmatter {
    pub title: Option<String>,
    pub description: Option<String>,
    pub slug: Option<String>,
    pub sidebar_label: Option<String>,
    pub sidebar_position: Option<i64>,
    pub tags: Vec<String>,
    pub draft: Option<bool>,
    pub unknown: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct EmbeddedFacts {
    pub code_blocks: Vec<EmbeddedSpan>,
    pub mermaid_blocks: Vec<EmbeddedSpan>,
    pub math_spans: Vec<EmbeddedSpan>,
    pub math_blocks: Vec<EmbeddedSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmbeddedSpan {
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: Option<String>,
    pub language_or_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct StructureCounts {
    pub words: u32,
    pub bytes: u32,
    pub sentences: u32,
    pub paragraphs: u32,
    pub headings: u32,
    pub links: u32,
    pub images: u32,
    pub code_blocks: u32,
    pub mermaid_blocks: u32,
    pub math_spans: u32,
    pub math_blocks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadingFact {
    pub level: u8,
    pub text: String,
    pub slug: String,
    pub duplicate_index: u32,
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnchorSource { Heading, ExplicitId, Footnote }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Paragraph,
    Heading,
    Blockquote,
    List,
    ListItem,
    Table,
    TableRow,
    TableCell,
    CodeBlock,
    HtmlBlock,
    FootnoteDefinition,
    Rule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrontmatterFormat { Yaml, Toml }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrontmatterSyntax { Valid, Malformed, UnsupportedFormat }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Fragment,
    LocalMarkdown,
    LocalFile,
    ExternalUrl,
    Mailto,
    Reference,
    UnknownScheme,
}

impl LinkKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fragment => "fragment",
            Self::LocalMarkdown => "local_markdown",
            Self::LocalFile => "local_file",
            Self::ExternalUrl => "external_url",
            Self::Mailto => "mailto",
            Self::Reference => "reference",
            Self::UnknownScheme => "unknown_scheme",
        }
    }
}

impl BlockKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Paragraph => "paragraph",
            Self::Heading => "heading",
            Self::Blockquote => "blockquote",
            Self::List => "list",
            Self::ListItem => "list_item",
            Self::Table => "table",
            Self::TableRow => "table_row",
            Self::TableCell => "table_cell",
            Self::CodeBlock => "code_block",
            Self::HtmlBlock => "html_block",
            Self::FootnoteDefinition => "footnote_definition",
            Self::Rule => "rule",
        }
    }
}
```

`pmd-app` wraps this with identity:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentFacts {
    pub doc_id: u64,
    pub version: u64,
    #[serde(flatten)]
    pub core: CoreDocumentFacts,
}
```

### App Diagnostics

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentDiagnostics {
    pub doc_id: u64,
    pub version: u64,
    pub phase: DiagnosticPhase,
    pub issues: Vec<DocumentIssue>,
    pub resources: ResourcePolicyReport,
    pub link_summary: LinkValidationSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentIssue {
    pub id: String,
    pub severity: IssueSeverity,
    pub category: IssueCategory,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub block_id: Option<String>,
    pub message: String,
    pub detail: Option<String>,
    pub primary_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticPhase { Initial, Enriched }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity { Error, Blocked, Warning, Info }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    Link,
    Anchor,
    Image,
    ResourcePolicy,
    Frontmatter,
    Security,
    Accessibility,
    Filesystem,
    Command,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResourcePolicyReport {
    pub doc_id: u64,
    pub version: u64,
    pub allowed_roots: Vec<String>,
    pub loaded_resources: Vec<String>,
    pub decisions: Vec<ResourceDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResourceDecision {
    pub source_target: String,
    pub normalized_target: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub kind: ResourceKind,
    pub decision: ResourceDecisionKind,
    pub reason: ResourceReason,
    pub safe_url: Option<String>,
    pub placeholder_id: Option<String>,
    pub alt_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind { Image, Link, DataUri, EmbeddedRenderer }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceDecisionKind { Allowed, Blocked, Missing, Unchecked }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceReason {
    AllowedLocalScope,
    RemoteBlocked,
    FileUrlBlocked,
    OutsideAllowedRoots,
    MissingFile,
    InvalidProtocol,
    UnsafeDataUri,
    ExternalLinkRequiresConfirmation,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LinkValidationSummary {
    pub checked: u32,
    pub errors: u32,
    pub warnings: u32,
    pub unchecked_external: u32,
    pub pending_async: u32,
}

impl DiagnosticPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Enriched => "enriched",
        }
    }
}

impl IssueSeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Blocked => "blocked",
            Self::Warning => "warning",
            Self::Info => "info",
        }
    }
}

impl IssueCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::Anchor => "anchor",
            Self::Image => "image",
            Self::ResourcePolicy => "resource_policy",
            Self::Frontmatter => "frontmatter",
            Self::Security => "security",
            Self::Accessibility => "accessibility",
            Self::Filesystem => "filesystem",
            Self::Command => "command",
        }
    }
}

impl ResourceDecisionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Blocked => "blocked",
            Self::Missing => "missing",
            Self::Unchecked => "unchecked",
        }
    }
}

impl ResourceReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AllowedLocalScope => "allowed_local_scope",
            Self::RemoteBlocked => "remote_blocked",
            Self::FileUrlBlocked => "file_url_blocked",
            Self::OutsideAllowedRoots => "outside_allowed_roots",
            Self::MissingFile => "missing_file",
            Self::InvalidProtocol => "invalid_protocol",
            Self::UnsafeDataUri => "unsafe_data_uri",
            Self::ExternalLinkRequiresConfirmation => "external_link_requires_confirmation",
            Self::NotApplicable => "not_applicable",
        }
    }
}
```

### TypeScript Contracts

```ts
export interface RenderResult {
  doc_id: number;
  version: number;
  html: string;
  source_map: Array<[number, number]>;
  render_nonce: string;
  facts: DocumentFacts;
  diagnostics: DocumentDiagnostics;
}

export interface DocumentIssue {
  id: string;
  severity: "error" | "blocked" | "warning" | "info";
  category:
    | "link"
    | "anchor"
    | "image"
    | "resource_policy"
    | "frontmatter"
    | "security"
    | "accessibility"
    | "filesystem"
    | "command";
  line_start: number | null;
  line_end: number | null;
  block_id: string | null;
  message: string;
  detail: string | null;
  primary_action: string | null;
}

export interface DocumentFacts extends CoreDocumentFacts {
  doc_id: number;
  version: number;
}

export interface CoreDocumentFacts {
  headings: HeadingFact[];
  anchors: AnchorFact[];
  links: LinkFact[];
  reference_definitions: ReferenceDefinitionFact[];
  images: ImageFact[];
  frontmatter: FrontmatterFact | null;
  blocks: BlockFact[];
  embedded: EmbeddedFacts;
  counts: StructureCounts;
}

export interface HeadingFact {
  level: number;
  text: string;
  slug: string;
  duplicate_index: number;
  line_start: number;
  line_end: number;
  block_id: string;
}

export interface AnchorFact {
  slug: string;
  line_start: number;
  line_end: number;
  block_id: string;
  source: "heading" | "explicit_id" | "footnote";
}

export interface LinkFact {
  target: string | null;
  title: string | null;
  label_text: string;
  reference_label: string | null;
  definition_id: string | null;
  line_start: number;
  line_end: number;
  kind: "fragment" | "local_markdown" | "local_file" | "external_url" | "mailto" | "reference" | "unknown_scheme";
}

export interface ReferenceDefinitionFact {
  id: string;
  label: string;
  target: string;
  title: string | null;
  line_start: number;
  line_end: number;
  duplicate_index: number;
}

export interface ImageFact {
  target: string | null;
  alt_text: string;
  title: string | null;
  reference_label: string | null;
  definition_id: string | null;
  line_start: number;
  line_end: number;
}

export interface BlockFact {
  id: string;
  kind: "paragraph" | "heading" | "blockquote" | "list" | "list_item" | "table" | "table_row" | "table_cell" | "code_block" | "html_block" | "footnote_definition" | "rule";
  line_start: number;
  line_end: number;
  parent_id: string | null;
}

export interface FrontmatterFact {
  format: "yaml" | "toml";
  line_start: number;
  line_end: number;
  raw: string;
  syntax: "valid" | "malformed" | "unsupported_format";
  metadata: CommonFrontmatter;
}

export interface CommonFrontmatter {
  title: string | null;
  description: string | null;
  slug: string | null;
  sidebar_label: string | null;
  sidebar_position: number | null;
  tags: string[];
  draft: boolean | null;
  unknown: Record<string, string>;
}

export interface EmbeddedFacts {
  code_blocks: EmbeddedSpan[];
  mermaid_blocks: EmbeddedSpan[];
  math_spans: EmbeddedSpan[];
  math_blocks: EmbeddedSpan[];
}

export interface EmbeddedSpan {
  line_start: number;
  line_end: number;
  block_id: string | null;
  language_or_kind: string | null;
}

export interface StructureCounts {
  words: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
  headings: number;
  links: number;
  images: number;
  code_blocks: number;
  mermaid_blocks: number;
  math_spans: number;
  math_blocks: number;
}

export interface DocumentDiagnostics {
  doc_id: number;
  version: number;
  phase: "initial" | "enriched";
  issues: DocumentIssue[];
  resources: ResourcePolicyReport;
  link_summary: LinkValidationSummary;
}

export interface ResourcePolicyReport {
  doc_id: number;
  version: number;
  allowed_roots: string[];
  loaded_resources: string[];
  decisions: ResourceDecision[];
}

export interface ResourceDecision {
  source_target: string;
  normalized_target: string | null;
  line_start: number;
  line_end: number;
  kind: "image" | "link" | "data_uri" | "embedded_renderer";
  decision: "allowed" | "blocked" | "missing" | "unchecked";
  reason: "allowed_local_scope" | "remote_blocked" | "file_url_blocked" | "outside_allowed_roots" | "missing_file" | "invalid_protocol" | "unsafe_data_uri" | "external_link_requires_confirmation" | "not_applicable";
  safe_url: string | null;
  placeholder_id: string | null;
  alt_text: string | null;
}

export interface LinkValidationSummary {
  checked: number;
  errors: number;
  warnings: number;
  unchecked_external: number;
  pending_async: number;
}
```

### Frontmatter Parser Decision

Use `yaml-rust2` 0.11.0 for YAML frontmatter parsing. It is a pure-Rust YAML 1.2 parser and avoids the deprecated `serde_yaml` crate and the advised-against `serde_yml` crate. The frontmatter parser reads YAML into `yaml_rust2::Yaml` and extracts the common string/bool/integer/list metadata fields manually; this slice does not require Serde YAML deserialization.

`crates/pmd-core/Cargo.toml` addition:

```toml
yaml-rust2 = { version = "0.11.0", default-features = false }
```

The worker must document the dependency choice in the block commit message and verify:

```bash
cargo tree -p pmd-core --invert yaml-rust2
if command -v cargo-deny >/dev/null 2>&1; then
    cargo deny check advisories
else
    echo "cargo-deny skipped (not installed)"
fi
```

If `cargo-deny` is not installed, the worker records that advisory verification was skipped locally and includes `yaml-rust2 = 0.11.0` in the code-review prompt. If `cargo deny check advisories` fails, the dependency choice is blocked until fixed or explicitly redesigned.

## Implementation Blocks

## Block 0: Execution Setup

**Worktree:** `.worktrees/dit-setup`

**Files:** no production files.

- [ ] **Step 0.1: Create the setup worktree**

```bash
INTEGRATION_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_BRANCH="$(git branch --show-current)"
case "$INTEGRATION_ROOT" in
    */.worktrees/*)
        echo "Run implementation from the merged integration checkout, not from a linked plan worktree." >&2
        exit 1
        ;;
esac
test -f "$INTEGRATION_ROOT/docs/superpowers/plans/2026-05-30-document-intelligence-visible-trust.md"
cd "$INTEGRATION_ROOT"
git switch "$INTEGRATION_BRANCH"
git pull --ff-only
git worktree add .worktrees/dit-setup -b work/dit-setup HEAD
cd .worktrees/dit-setup
```

- [ ] **Step 0.2: Run the non-e2e baseline**

```bash
just check
```

Expected: all non-WebDriver gates pass. If this fails before any feature edits, stop and either fix the baseline on a separate branch or ask the user whether to proceed over the known failure.

- [ ] **Step 0.3: Record worker branch names**

Create no file. Use these branch names unless a branch already exists:

```text
work/dit-core-facts
work/dit-app-authority
work/dit-validation
work/dit-actions-keybindings
work/dit-outline
work/dit-diagnostics-trust
work/dit-asset-grants
work/dit-accessibility-e2e
```

## Block 1: Core Contracts and Empty Fact Plumbing

**Worktree:** `.worktrees/dit-core-facts`

**Owner:** `pmd-core` facts worker.

**Files:**

- Create: `crates/pmd-core/src/facts/mod.rs`
- Modify: `crates/pmd-core/src/lib.rs`
- Modify: `crates/pmd-core/src/emit.rs`
- Test: `crates/pmd-core/tests/document_facts_headings.rs`
- Test: `crates/pmd-app/tests/cmd_render.rs`
- Integration-owner modify: `ui/src/main.ts`

- [ ] **Step 1.1: Write a failing core contract test**

`crates/pmd-core/tests/document_facts_headings.rs`:

```rust
use pmd_core::emit::render_string;

#[test]
fn render_result_includes_empty_fact_sets_for_plain_text() {
    let result = render_string("plain paragraph");

    assert!(result.facts.headings.is_empty());
    assert!(result.facts.links.is_empty());
    assert_eq!(result.facts.counts.paragraphs, 1);
    assert_eq!(result.facts.counts.words, 2);
}
```

- [ ] **Step 1.2: Run the failing test**

```bash
cargo test -p pmd-core --test document_facts_headings -j 2
```

Expected: compile failure because `RenderResult.facts` does not exist.

- [ ] **Step 1.3: Add the public core fact contracts**

Create `crates/pmd-core/src/facts/mod.rs` with the shared contracts from the spec. Include `CoreDocumentFacts::empty()` and `StructureCounts::default()`.

Required enums use `#[serde(rename_all = "snake_case")]`:

```rust
pub enum AnchorSource { Heading, ExplicitId, Footnote }
pub enum BlockKind { Paragraph, Heading, Blockquote, List, ListItem, Table, TableRow, TableCell, CodeBlock, HtmlBlock, FootnoteDefinition, Rule }
pub enum FrontmatterFormat { Yaml, Toml }
pub enum FrontmatterSyntax { Valid, Malformed, UnsupportedFormat }
pub enum LinkKind { Fragment, LocalMarkdown, LocalFile, ExternalUrl, Mailto, Reference, UnknownScheme }
```

- [ ] **Step 1.4: Wire facts into `RenderResult`**

Modify `crates/pmd-core/src/emit.rs`:

```rust
use crate::facts::CoreDocumentFacts;

pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
    pub render_nonce: String,
    pub facts: CoreDocumentFacts,
}
```

At the end of `render_string`, return `facts` from a minimal builder that counts paragraphs and words. Preserve existing `html`, `source_map`, and `render_nonce` behavior.

- [ ] **Step 1.5: Export the module**

Modify `crates/pmd-core/src/lib.rs`:

```rust
pub mod facts;
```

- [ ] **Step 1.6: Update app and UI compile surfaces**

Update `crates/pmd-app/tests/cmd_render.rs` to assert `result.facts.counts.words > 0`.

Update the `RenderResult` interface in `ui/src/main.ts` to include the fields needed by the first compile pass:

```ts
facts: {
  headings: unknown[];
  links: unknown[];
  images: unknown[];
  blocks: unknown[];
  counts: {
    words: number;
    paragraphs: number;
  };
};
diagnostics?: null;
```

This is temporary compile plumbing; Block 9 replaces the local shape with `ui/src/document_contracts.ts`.

- [ ] **Step 1.7: Verify**

```bash
cargo test -p pmd-core --test document_facts_headings -j 2
cargo test -p pmd-app --test cmd_render -j 2
just test-golden
```

Expected: all commands pass.

- [ ] **Step 1.8: Commit**

```bash
git add crates/pmd-core/src/lib.rs crates/pmd-core/src/emit.rs crates/pmd-core/src/facts/mod.rs crates/pmd-core/tests/document_facts_headings.rs crates/pmd-app/tests/cmd_render.rs ui/src/main.ts
git commit -m "feat(core): add document fact render contract"
```

## Block 2: Deterministic Parse Facts

**Worktree:** `.worktrees/dit-core-facts` (same `dit-core-facts` workstream as Block 1)

**Owner:** `pmd-core` facts worker.

**Files:**

- Create: `crates/pmd-core/src/facts/builder.rs`
- Create: `crates/pmd-core/src/facts/slug.rs`
- Create: `crates/pmd-core/src/facts/frontmatter.rs`
- Create: `crates/pmd-core/src/facts/links.rs`
- Create: `crates/pmd-core/src/facts/counts.rs`
- Modify: `crates/pmd-core/src/facts/mod.rs`
- Modify: `crates/pmd-core/src/emit.rs`
- Modify: `crates/pmd-core/src/parse.rs`
- Modify: `crates/pmd-core/src/source_map.rs`
- Modify: `crates/pmd-core/Cargo.toml`
- Modify: `Cargo.lock`
- Test: all `crates/pmd-core/tests/document_facts_*.rs`

- [ ] **Step 2.1: Write heading and slug tests**

`crates/pmd-core/tests/document_facts_headings.rs` must include:

```rust
#[test]
fn headings_have_github_style_duplicate_slugs() {
    let result = pmd_core::emit::render_string("# Hello, World!\n\n## Hello World\n\n# Hello World");
    let headings = &result.facts.headings;

    assert_eq!(headings.len(), 3);
    assert_eq!(headings[0].slug, "hello-world");
    assert_eq!(headings[0].duplicate_index, 0);
    assert_eq!(headings[1].slug, "hello-world-1");
    assert_eq!(headings[1].duplicate_index, 1);
    assert_eq!(headings[2].slug, "hello-world-2");
    assert_eq!(headings[2].duplicate_index, 2);
    assert_eq!(headings[0].line_start, 1);
}
```

- [ ] **Step 2.2: Write link/image/reference tests**

Create tests in `crates/pmd-core/tests/document_facts_links.rs` for:

```rust
#[test]
fn classifies_inline_reference_mailto_fragment_and_image_facts() {
    let markdown = "[frag](#title) [doc](other.md#section) [site](https://example.com) [mail](mailto:a@example.com) [ref][missing]\n\n![alt](./img.png \"Logo\")";
    let result = pmd_core::emit::render_string(markdown);

    let kinds: Vec<_> = result.facts.links.iter().map(|link| link.kind.as_str()).collect();
    assert_eq!(kinds, ["fragment", "local_markdown", "external_url", "mailto", "reference"]);
    assert_eq!(result.facts.images[0].target.as_deref(), Some("./img.png"));
    assert_eq!(result.facts.images[0].alt_text, "alt");
}
```

Use helper methods or enum assertions if the final enum does not expose `as_str()`.

- [ ] **Step 2.3: Write frontmatter tests**

Create tests in `crates/pmd-core/tests/document_facts_frontmatter.rs` for YAML, TOML, malformed YAML, and absence:

```rust
#[test]
fn yaml_frontmatter_preserves_raw_range_and_common_metadata() {
    let markdown = "---\ntitle: My Doc\ntags:\n  - rust\n  - markdown\ndraft: true\n---\n# Body\n";
    let result = pmd_core::emit::render_string(markdown);
    let frontmatter = result.facts.frontmatter.as_ref().expect("frontmatter");

    assert_eq!(frontmatter.line_start, 1);
    assert_eq!(frontmatter.line_end, 6);
    assert_eq!(frontmatter.metadata.title.as_deref(), Some("My Doc"));
    assert_eq!(frontmatter.metadata.tags, vec!["rust", "markdown"]);
    assert_eq!(frontmatter.metadata.draft, Some(true));
}
```

- [ ] **Step 2.4: Write block and embedded/count tests**

Create tests in `crates/pmd-core/tests/document_facts_blocks.rs` and `document_facts_embedded_counts.rs` that assert:

- headings, paragraphs, blockquotes, lists, list items, code blocks, tables, footnote definitions, and rules receive stable `block_id` values.
- block children include `parent_id` when nested.
- fenced `mermaid`, fenced code, inline math, display math, and raw math spans appear in `EmbeddedFacts`.
- counts match facts for headings, links, images, code blocks, Mermaid blocks, math spans, and math blocks.

`crates/pmd-core/tests/document_facts_blocks.rs` includes:

```rust
#[test]
fn blocks_have_stable_ids_kinds_lines_and_parents() {
    let md = "# Title\n\n> quote\n\n- item\n\n```rust\nfn main() {}\n```\n\n| A |\n| - |\n| B |\n\n[^n]: note\n\n---\n";
    let result = pmd_core::emit::render_string(md);
    let blocks = &result.facts.blocks;

    assert!(blocks.iter().any(|b| b.id == "block-1" && b.kind.as_str() == "heading" && b.line_start == 1));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "blockquote"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "list_item" && b.parent_id.is_some()));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "code_block"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "table"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "footnote_definition"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "rule"));
}
```

`crates/pmd-core/tests/document_facts_embedded_counts.rs` includes:

```rust
#[test]
fn embedded_facts_and_counts_match_rendered_document() {
    let md = "# H\n\nText with $x$ and [link](file.md).\n\n![alt](img.png)\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\ny = 1\n$$\n\n```rust\nfn main() {}\n```\n";
    let result = pmd_core::emit::render_string(md);

    assert_eq!(result.facts.counts.headings, 1);
    assert_eq!(result.facts.counts.links, result.facts.links.len() as u32);
    assert_eq!(result.facts.counts.images, result.facts.images.len() as u32);
    assert_eq!(result.facts.counts.code_blocks, 2);
    assert_eq!(result.facts.counts.mermaid_blocks, 1);
    assert_eq!(result.facts.embedded.mermaid_blocks.len(), 1);
    assert_eq!(result.facts.embedded.code_blocks.len(), 2);
    assert_eq!(result.facts.embedded.math_spans.len(), 1);
    assert_eq!(result.facts.embedded.math_blocks.len(), 1);
}
```

- [ ] **Step 2.5: Implement fact builder integrated with the existing event walk**

Move the line helper from `emit.rs` into `crates/pmd-core/src/source_map.rs`:

```rust
#[derive(Debug, Clone)]
pub struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    pub fn new(source: &str) -> Self {
        let starts = std::iter::once(0)
            .chain(source.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        Self { starts }
    }

    pub fn byte_to_line(&self, byte: usize) -> u32 {
        self.starts.partition_point(|&start| start <= byte) as u32
    }

    pub fn byte_range_to_lines(&self, range: std::ops::Range<usize>) -> (u32, u32) {
        (self.byte_to_line(range.start), self.byte_to_line(range.end))
    }
}
```

`crates/pmd-core/src/facts/builder.rs` exposes this exact shape. The worker may split helper methods below this block, but the public constructor/observer/finish API and the field names stay stable so `emit.rs` integration is mechanical:

```rust
use std::collections::BTreeMap;
use pulldown_cmark::{CodeBlockKind, Event, LinkType, Tag, TagEnd};
use crate::facts::{
    AnchorFact, AnchorSource, BlockFact, BlockKind, CoreDocumentFacts, EmbeddedSpan,
    HeadingFact, ImageFact, LinkFact, LinkKind, ReferenceDefinitionFact, StructureCounts,
};
use crate::source_map::LineIndex;

struct OpenBlock {
    id: String,
    kind: BlockKind,
    line_start: u32,
    parent_id: Option<String>,
}

struct OpenHeading {
    level: u8,
    text: String,
    explicit_id: Option<String>,
    line_start: u32,
    block_id: String,
}

struct OpenLink {
    target: Option<String>,
    title: Option<String>,
    reference_label: Option<String>,
    kind: LinkKind,
    label_text: String,
    line_start: u32,
}

struct OpenImage {
    target: Option<String>,
    title: Option<String>,
    reference_label: Option<String>,
    alt_text: String,
    line_start: u32,
}

pub struct FactBuilder<'a> {
    source: &'a str,
    line_index: &'a LineIndex,
    facts: CoreDocumentFacts,
    block_stack: Vec<OpenBlock>,
    next_block_id: u32,
    heading_slug_counts: BTreeMap<String, u32>,
    open_heading: Option<OpenHeading>,
    open_link: Option<OpenLink>,
    open_image: Option<OpenImage>,
    paragraph_line_start: Option<u32>,
    code_block_line_start: Option<(u32, Option<String>)>,
}

impl<'a> FactBuilder<'a> {
    pub fn new(source: &'a str, line_index: &'a LineIndex) -> Self {
        let mut facts = CoreDocumentFacts::empty();
        facts.reference_definitions = scan_reference_definitions(source, line_index);
        facts.frontmatter = scan_frontmatter(source, line_index);
        Self {
            source,
            line_index,
            facts,
            block_stack: Vec::new(),
            next_block_id: 1,
            heading_slug_counts: BTreeMap::new(),
            open_heading: None,
            open_link: None,
            open_image: None,
            paragraph_line_start: None,
            code_block_line_start: None,
        }
    }

    pub fn observe(&mut self, event: &Event<'_>, range: std::ops::Range<usize>) {
        let (line_start, line_end) = self.line_index.byte_range_to_lines(range);
        match event {
            Event::Start(tag) => self.start_tag(tag, line_start),
            Event::End(tag_end) => self.end_tag(tag_end, line_end),
            Event::Text(text) => {
                self.add_visible_words(text);
                if let Some(heading) = &mut self.open_heading {
                    heading.text.push_str(text);
                }
                if let Some(link) = &mut self.open_link {
                    link.label_text.push_str(text);
                }
                if let Some(image) = &mut self.open_image {
                    image.alt_text.push_str(text);
                }
            }
            Event::Code(code) => {
                self.facts.embedded.code_blocks.push(EmbeddedSpan {
                    line_start,
                    line_end,
                    block_id: self.current_block_id(),
                    language_or_kind: Some("inline".to_string()),
                });
                self.add_visible_words(code);
            }
            Event::Html(_) | Event::InlineHtml(_) => {
                self.push_block(BlockKind::HtmlBlock, line_start);
                self.close_block(line_end);
            }
            Event::FootnoteReference(label) => {
                self.facts.anchors.push(AnchorFact {
                    slug: format!("fnref-{}", slugify(label)),
                    line_start,
                    line_end,
                    block_id: self.ensure_inline_block(line_start),
                    source: AnchorSource::Footnote,
                });
            }
            Event::SoftBreak | Event::HardBreak => {}
            Event::Rule => {
                self.push_block(BlockKind::Rule, line_start);
                self.close_block(line_end);
            }
            Event::TaskListMarker(_) => {}
        }
    }

    pub fn finish(mut self) -> CoreDocumentFacts {
        self.facts.counts.bytes = self.source.len() as u32;
        while !self.block_stack.is_empty() {
            let fallback_end = self.line_index.byte_to_line(self.source.len());
            self.close_block(fallback_end);
        }
        self.facts
    }

    fn start_tag(&mut self, tag: &Tag<'_>, line_start: u32) {
        match tag {
            Tag::Paragraph => {
                self.paragraph_line_start = Some(line_start);
                self.push_block(BlockKind::Paragraph, line_start);
            }
            Tag::Heading { level, id, .. } => {
                let block_id = self.push_block(BlockKind::Heading, line_start);
                self.open_heading = Some(OpenHeading {
                    level: *level as u8,
                    text: String::new(),
                    explicit_id: id.as_ref().map(ToString::to_string),
                    line_start,
                    block_id,
                });
            }
            Tag::BlockQuote => { self.push_block(BlockKind::Blockquote, line_start); }
            Tag::List(_) => { self.push_block(BlockKind::List, line_start); }
            Tag::Item => { self.push_block(BlockKind::ListItem, line_start); }
            Tag::Table(_) => { self.push_block(BlockKind::Table, line_start); }
            Tag::TableRow | Tag::TableHead => { self.push_block(BlockKind::TableRow, line_start); }
            Tag::TableCell => { self.push_block(BlockKind::TableCell, line_start); }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().map(str::to_string),
                    CodeBlockKind::Indented => Some("text".to_string()),
                };
                self.code_block_line_start = Some((line_start, language));
                self.push_block(BlockKind::CodeBlock, line_start);
            }
            Tag::HtmlBlock => { self.push_block(BlockKind::HtmlBlock, line_start); }
            Tag::FootnoteDefinition(label) => {
                let block_id = self.push_block(BlockKind::FootnoteDefinition, line_start);
                self.facts.anchors.push(AnchorFact {
                    slug: format!("fn-{}", slugify(label)),
                    line_start,
                    line_end: line_start,
                    block_id,
                    source: AnchorSource::Footnote,
                });
            }
            Tag::Link { link_type, dest_url, title, id } => {
                self.open_link = Some(OpenLink {
                    target: empty_to_none(dest_url),
                    title: empty_to_none(title),
                    reference_label: reference_label(*link_type, id),
                    kind: classify_link(*link_type, dest_url),
                    label_text: String::new(),
                    line_start,
                });
            }
            Tag::Image { link_type, dest_url, title, id } => {
                self.open_image = Some(OpenImage {
                    target: empty_to_none(dest_url),
                    title: empty_to_none(title),
                    reference_label: reference_label(*link_type, id),
                    alt_text: String::new(),
                    line_start,
                });
            }
            Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::MetadataBlock(_) => {}
        }
    }

    fn end_tag(&mut self, tag_end: &TagEnd, line_end: u32) {
        match tag_end {
            TagEnd::Paragraph => {
                self.facts.counts.paragraphs += 1;
                self.paragraph_line_start = None;
                self.close_block(line_end);
            }
            TagEnd::Heading(_) => {
                if let Some(open) = self.open_heading.take() {
                    let base_slug = open.explicit_id.clone().unwrap_or_else(|| slugify(&open.text));
                    let duplicate_index = next_duplicate_index(&mut self.heading_slug_counts, &base_slug);
                    let slug = if duplicate_index == 0 { base_slug } else { format!("{base_slug}-{duplicate_index}") };
                    self.facts.headings.push(HeadingFact {
                        level: open.level,
                        text: open.text,
                        slug: slug.clone(),
                        duplicate_index,
                        line_start: open.line_start,
                        line_end,
                        block_id: open.block_id.clone(),
                    });
                    self.facts.anchors.push(AnchorFact {
                        slug,
                        line_start: open.line_start,
                        line_end,
                        block_id: open.block_id,
                        source: if open.explicit_id.is_some() { AnchorSource::ExplicitId } else { AnchorSource::Heading },
                    });
                    self.facts.counts.headings += 1;
                }
                self.close_block(line_end);
            }
            TagEnd::CodeBlock => {
                if let Some((line_start, language)) = self.code_block_line_start.take() {
                    let lower = language.as_deref().unwrap_or("text").to_ascii_lowercase();
                    let span = EmbeddedSpan { line_start, line_end, block_id: self.current_block_id(), language_or_kind: language };
                    if lower == "mermaid" {
                        self.facts.embedded.mermaid_blocks.push(span);
                        self.facts.counts.mermaid_blocks += 1;
                    } else if lower == "math" {
                        self.facts.embedded.math_blocks.push(span);
                        self.facts.counts.math_blocks += 1;
                    } else {
                        self.facts.embedded.code_blocks.push(span);
                        self.facts.counts.code_blocks += 1;
                    }
                }
                self.close_block(line_end);
            }
            TagEnd::Link => {
                if let Some(open) = self.open_link.take() {
                    let definition_id = open.reference_label.as_ref().and_then(|label| {
                        self.facts.reference_definitions.iter().find(|definition| definition.label.eq_ignore_ascii_case(label)).map(|definition| definition.id.clone())
                    });
                    self.facts.links.push(LinkFact {
                        target: open.target,
                        title: open.title,
                        label_text: open.label_text,
                        reference_label: open.reference_label,
                        definition_id,
                        line_start: open.line_start,
                        line_end,
                        kind: open.kind,
                    });
                    self.facts.counts.links += 1;
                }
            }
            TagEnd::Image => {
                if let Some(open) = self.open_image.take() {
                    let definition_id = open.reference_label.as_ref().and_then(|label| {
                        self.facts.reference_definitions.iter().find(|definition| definition.label.eq_ignore_ascii_case(label)).map(|definition| definition.id.clone())
                    });
                    self.facts.images.push(ImageFact {
                        target: open.target,
                        alt_text: open.alt_text,
                        title: open.title,
                        reference_label: open.reference_label,
                        definition_id,
                        line_start: open.line_start,
                        line_end,
                    });
                    self.facts.counts.images += 1;
                }
            }
            TagEnd::BlockQuote | TagEnd::List(_) | TagEnd::Item | TagEnd::Table | TagEnd::TableHead | TagEnd::TableRow | TagEnd::TableCell | TagEnd::HtmlBlock | TagEnd::FootnoteDefinition => {
                self.close_block(line_end);
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::MetadataBlock(_) => {}
        }
    }

    fn push_block(&mut self, kind: BlockKind, line_start: u32) -> String {
        let id = format!("block-{}", self.next_block_id);
        self.next_block_id += 1;
        let parent_id = self.current_block_id();
        self.block_stack.push(OpenBlock { id: id.clone(), kind, line_start, parent_id });
        id
    }

    fn close_block(&mut self, line_end: u32) {
        if let Some(open) = self.block_stack.pop() {
            self.facts.blocks.push(BlockFact {
                id: open.id,
                kind: open.kind,
                line_start: open.line_start,
                line_end,
                parent_id: open.parent_id,
            });
        }
    }

    fn current_block_id(&self) -> Option<String> {
        self.block_stack.last().map(|block| block.id.clone())
    }

    fn ensure_inline_block(&mut self, line_start: u32) -> String {
        self.current_block_id().unwrap_or_else(|| self.push_block(BlockKind::Paragraph, line_start))
    }

    fn add_visible_words(&mut self, text: &str) {
        self.facts.counts.words += text.split_whitespace().count() as u32;
    }
}

fn next_duplicate_index(counts: &mut BTreeMap<String, u32>, slug: &str) -> u32 {
    let entry = counts.entry(slug.to_string()).or_insert(0);
    let index = *entry;
    *entry += 1;
    index
}

fn empty_to_none(value: &str) -> Option<String> {
    if value.is_empty() { None } else { Some(value.to_string()) }
}

fn reference_label(link_type: LinkType, id: &str) -> Option<String> {
    if matches!(
        link_type,
        LinkType::Reference
            | LinkType::ReferenceUnknown
            | LinkType::Collapsed
            | LinkType::CollapsedUnknown
            | LinkType::Shortcut
            | LinkType::ShortcutUnknown
    ) && !id.is_empty() {
        Some(id.to_string())
    } else {
        None
    }
}

fn classify_link(link_type: LinkType, target: &str) -> LinkKind {
    if matches!(
        link_type,
        LinkType::Reference
            | LinkType::ReferenceUnknown
            | LinkType::Collapsed
            | LinkType::CollapsedUnknown
            | LinkType::Shortcut
            | LinkType::ShortcutUnknown
    ) {
        return LinkKind::Reference;
    }
    if target.starts_with('#') { LinkKind::Fragment }
    else if is_markdown_link_target(target) { LinkKind::LocalMarkdown }
    else if target.starts_with("http://") || target.starts_with("https://") { LinkKind::ExternalUrl }
    else if target.starts_with("mailto:") { LinkKind::Mailto }
    else if target.contains(':') || target.starts_with("//") { LinkKind::UnknownScheme }
    else { LinkKind::LocalFile }
}

fn is_markdown_link_target(target: &str) -> bool {
    let without_fragment = target.split_once('#').map_or(target, |(path, _)| path);
    let without_query = without_fragment.split_once('?').map_or(without_fragment, |(path, _)| path);
    without_query.ends_with(".md") || without_query.ends_with(".markdown")
}
```

In `crates/pmd-core/src/emit.rs`, keep the existing `Vec<(u32, u32)>` source-map shape and integrate the builder in the existing `into_offset_iter()` loop:

```rust
let line_index = crate::source_map::LineIndex::new(md);
let parser = Parser::new_ext(md, opts).into_offset_iter();
let mut facts = crate::facts::builder::FactBuilder::new(md, &line_index);
let mut source_map = Vec::<(u32, u32)>::new();

for (event, range) in parser {
    facts.observe(&event, range.clone());
    let (start_line, end_line) = line_index.byte_range_to_lines(range);
    source_map.push((start_line, end_line));
    // Existing HTML emission match over `event` remains here.
}

let facts = facts.finish();
```

`scan_reference_definitions`, `scan_frontmatter`, and `slugify` live in `facts/builder.rs` as private helpers. `scan_reference_definitions` reads source lines with `LineIndex` and emits duplicate-indexed definitions for `[label]: target "title"` before the pulldown event loop. `scan_frontmatter` recognizes only leading `---` YAML and `+++` TOML fences, leaves malformed data in `FrontmatterFact { syntax: Malformed, raw, metadata: Default::default() }`, and never removes frontmatter bytes from the source passed to pulldown, so source-map line numbers do not shift.

- [ ] **Step 2.6: Add and verify the YAML parser dependency**

Add this exact dependency to `crates/pmd-core/Cargo.toml` and update `Cargo.lock`:

```toml
yaml-rust2 = { version = "0.11.0", default-features = false }
```

Do not use `serde_yaml` or `serde_yml`.

Run:

```bash
cargo tree -p pmd-core --invert yaml-rust2
if command -v cargo-deny >/dev/null 2>&1; then
    cargo deny check advisories
else
    echo "cargo-deny skipped (not installed)"
fi
```

Expected: `yaml-rust2 v0.11.0` appears only through `pmd-core`. If `cargo-deny` is installed, there are no advisory failures for `yaml-rust2`. If `cargo-deny` is not installed, record the skipped advisory command in the Block 2 cx-review prompt and include `yaml-rust2 = 0.11.0`.

- [ ] **Step 2.7: Verify**

```bash
cargo test -p pmd-core --test document_facts_headings -j 2
cargo test -p pmd-core --test document_facts_links -j 2
cargo test -p pmd-core --test document_facts_frontmatter -j 2
cargo test -p pmd-core --test document_facts_blocks -j 2
cargo test -p pmd-core --test document_facts_embedded_counts -j 2
just test-golden
just test-prop
```

Expected: all commands pass.

- [ ] **Step 2.8: Commit**

```bash
git add crates/pmd-core/Cargo.toml Cargo.lock crates/pmd-core/src/facts crates/pmd-core/src/emit.rs crates/pmd-core/src/parse.rs crates/pmd-core/src/source_map.rs crates/pmd-core/tests/document_facts_*.rs
git commit -m "feat(core): derive markdown document facts"
```

## Block 3: Render Security Markers and Sanitizer Hardening

**Worktree:** `.worktrees/dit-core-facts` (same `dit-core-facts` workstream as Blocks 1-2)

**Owner:** `pmd-core` facts worker with security reviewer subagent.

**Files:**

- Modify: `crates/pmd-core/src/emit.rs`
- Modify: `crates/pmd-core/src/sanitize/allowlist.rs`
- Modify: `crates/pmd-core/tests/security.rs`
- Modify: `crates/pmd-core/tests/alerts_footnotes.rs`

- [ ] **Step 3.1: Add failing security tests**

Add tests proving source-authored link/image HTML cannot spoof backend ids:

```rust
#[test]
fn raw_html_cannot_spoof_backend_link_or_resource_ids() {
    let html = pmd_core::emit::render_string(r#"<a href="https://evil.test" data-pmd-link-id="link-1" target="_blank" ping="https://evil.test/p">x</a>"#)
        .html;

    assert!(!html.contains("data-pmd-link-id=\"link-1\""));
    assert!(!html.contains("target="));
    assert!(!html.contains("ping="));
}
```

Add tests proving source-authored Markdown links/images are inert markers:

```rust
#[test]
fn markdown_links_are_inert_backend_markers() {
    let html = pmd_core::emit::render_string("[site](https://example.com)").html;

    assert!(html.contains("data-pmd-link-id="));
    assert!(!html.contains("href=\"https://example.com\""));
}
```

Add a paired test proving renderer-created markers survive while raw HTML markers are stripped:

```rust
#[test]
fn markdown_markers_survive_but_raw_html_markers_do_not() {
    let markdown_html = pmd_core::emit::render_string("[site](https://example.com)").html;
    let raw_html = pmd_core::emit::render_string(r#"<a data-pmd-link-id="link-0">spoof</a>"#).html;

    assert!(markdown_html.contains("data-pmd-link-id="));
    assert!(!raw_html.contains("data-pmd-link-id="));
}
```

Add spoof-attempt tests for every reserved marker namespace:

```rust
#[test]
fn raw_html_nonce_looking_pmd_markers_are_stripped() {
    let html = pmd_core::emit::render_string(
        r#"<span data-pmd-link-id="link-0" data-pmd-image-id="image-0" data-pmd-resource-id="resource-0" data-render-nonce="looks-real">spoof</span>"#,
    )
    .html;

    assert!(!html.contains("data-pmd-link-id="));
    assert!(!html.contains("data-pmd-image-id="));
    assert!(!html.contains("data-pmd-resource-id="));
    assert!(!html.contains("looks-real"));
}

#[test]
fn mixed_trusted_and_untrusted_shapes_do_not_preserve_pmd_markers() {
    let html = pmd_core::emit::render_string(
        r#"<code data-pmd-link-id="link-0" data-render-nonce="looks-real" class="language-mermaid">graph TD; A-->B</code>"#,
    )
    .html;

    assert!(!html.contains("data-pmd-link-id="));
}
```

- [ ] **Step 3.2: Run failing tests**

```bash
cargo test -p pmd-core --test security -j 2
```

Expected: new tests fail because current output still preserves safe `href` values and raw data attributes.

- [ ] **Step 3.3: Emit trusted inert markers for source-authored links and images**

Use one fixed trust boundary: only `pulldown-cmark` `Tag::Link` and `Tag::Image` events emitted by `pmd-core` may create `data-pmd-link-id` or `data-pmd-image-id`. Raw HTML events are sanitized before append, and sanitizer strips every source-authored `data-pmd-*`, `target`, `download`, and `ping` attribute regardless of nonce-looking text or CSS class.

Change the renderer so Markdown links render as inert elements with stable ids and no browser-navigation attributes. Raw Markdown targets are stored in `DocumentFacts`, not in the DOM. Current-document generated footnote controls may keep safe fragment behavior only if they cannot carry source-authored targets.

Required marker fields:

```html
<a data-pmd-link-id="link-0" role="link" tabindex="0">
<span data-pmd-image-id="image-0" class="pmd-image-placeholder">
```

Do not put the raw Markdown target in `href`, `src`, `target`, `download`, `ping`, or a drag-enabled attribute.

- [ ] **Step 3.4: Harden sanitizer allowlist**

Strip source-authored:

- every source-authored `data-pmd-*` attribute.
- `target`.
- `download`.
- `ping`.
- direct source-authored `src`/`href` values that the app authority layer must resolve.

Preserve trusted renderer attributes only when they are injected after sanitization or carry the current render nonce and trusted shape already used by Mermaid/KaTeX tests. The security tests must prove Markdown-generated markers survive and raw HTML spoofed link ids, image ids, resource ids, nonce-looking attributes, and mixed trusted/untrusted element shapes do not.

- [ ] **Step 3.5: Verify**

```bash
cargo test -p pmd-core --test security -j 2
cargo test -p pmd-core --test alerts_footnotes -j 2
just test-golden
```

Expected: all commands pass and golden changes are reviewed.

- [ ] **Step 3.6: Review and merge core branch**

```bash
ccc --yolo @cx-reviewer "Review the pmd-core document facts and inert marker diff for security, parser correctness, and plan compliance. Return PASS or concrete blockers."
```

Repeat until `PASS`, then:

```bash
git add crates/pmd-core/src/emit.rs crates/pmd-core/src/sanitize/allowlist.rs crates/pmd-core/tests/security.rs crates/pmd-core/tests/alerts_footnotes.rs
git commit -m "fix(core): make source links and images authority-ready"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-core-facts
```

## Block 4: App Preview Authority and Diagnostics Shell

**Worktree:** `.worktrees/dit-app-authority`

**Owner:** `pmd-app` authority worker.

**Files:**

- Create: `crates/pmd-app/src/preview/mod.rs`
- Create: `crates/pmd-app/src/preview/contracts.rs`
- Create: `crates/pmd-app/src/preview/render_pipeline.rs`
- Create: `crates/pmd-app/src/preview/resource_policy.rs`
- Modify: `crates/pmd-app/src/lib.rs`
- Integration-owner modify: `crates/pmd-app/src/main.rs`
- Modify: `crates/pmd-app/src/cmd/mod.rs`
- Modify: `crates/pmd-app/src/cmd/render.rs`
- Modify: `crates/pmd-app/src/doc/registry.rs`
- Test: `crates/pmd-app/tests/cmd_render.rs`

- [ ] **Step 4.1: Write failing render contract tests**

Extend `crates/pmd-app/tests/cmd_render.rs`:

```rust
#[tokio::test]
async fn render_returns_identity_facts_and_initial_diagnostics() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "# Title\n\n[bad](missing.md)").unwrap();

    let result = pmd_app_lib::cmd::render::render_cmd_for_test(7, 12, Some(&doc_path), "# Title\n\n[bad](missing.md)".into())
        .await
        .expect("render");

    assert_eq!(result.doc_id, 7);
    assert_eq!(result.version, 12);
    assert_eq!(result.facts.doc_id, 7);
    assert_eq!(result.facts.version, 12);
    assert_eq!(result.diagnostics.doc_id, 7);
    assert_eq!(result.diagnostics.version, 12);
    assert_eq!(result.diagnostics.phase, pmd_app_lib::preview::contracts::DiagnosticPhase::Initial);
}

#[tokio::test]
async fn malformed_frontmatter_returns_diagnostic_without_blank_preview() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "---\ntitle: [unterminated\n---\n# Body\n";
    std::fs::write(&doc_path, markdown).unwrap();

    let result = pmd_app_lib::cmd::render::render_cmd_for_test(7, 13, Some(&doc_path), markdown.into())
        .await
        .expect("render");

    assert!(result.html.contains("Body"));
    assert!(result.diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "frontmatter"
            && issue.severity.as_str() == "warning"
            && issue.message.contains("Frontmatter could not be parsed")
    }));
}
```

- [ ] **Step 4.2: Run failing test**

```bash
cargo test -p pmd-app --test cmd_render -j 2
```

Expected: compile failure because `render_cmd_for_test` and the preview authority contracts do not exist.

- [ ] **Step 4.3: Add app-facing contracts**

Create `preview/contracts.rs` by moving the app-facing shared contracts from the Shared Contracts section into real Rust code. The file imports `pmd_core::facts::{CoreDocumentFacts, FrontmatterSyntax}`, preserves the current tuple source-map serialization, and includes enum `as_str()` helpers used by tests:

```rust
use pmd_core::facts::{CoreDocumentFacts, FrontmatterSyntax};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub doc_id: u64,
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
    pub render_nonce: String,
    pub facts: DocumentFacts,
    pub diagnostics: DocumentDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentFacts {
    pub doc_id: u64,
    pub version: u64,
    #[serde(flatten)]
    pub core: CoreDocumentFacts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentDiagnostics {
    pub doc_id: u64,
    pub version: u64,
    pub phase: DiagnosticPhase,
    pub issues: Vec<DocumentIssue>,
    pub resources: ResourcePolicyReport,
    pub link_summary: LinkValidationSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentIssue {
    pub id: String,
    pub severity: IssueSeverity,
    pub category: IssueCategory,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub block_id: Option<String>,
    pub message: String,
    pub detail: Option<String>,
    pub primary_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticPhase { Initial, Enriched }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity { Error, Blocked, Warning, Info }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory { Link, Anchor, Image, ResourcePolicy, Frontmatter, Security, Accessibility, Filesystem, Command }
```

Copy the already-defined `ResourcePolicyReport`, `ResourceDecision`, `ResourceDecisionKind`, `ResourceReason`, `ResourceKind`, and `LinkValidationSummary` definitions from this plan's Shared Contracts section into `preview/contracts.rs` without changing field names or enum rename rules. Keep `#[serde(rename_all = "snake_case")]` on all enums and implement `as_str()` for `DiagnosticPhase`, `IssueSeverity`, `IssueCategory`, `ResourceKind`, `ResourceDecisionKind`, and `ResourceReason` with the exact string values shown in Shared Contracts.

Add test-oriented constructors used by later blocks:

```rust
impl ResourcePolicyReport {
    pub fn empty(doc_id: u64, version: u64) -> Self {
        Self { doc_id, version, allowed_roots: Vec::new(), loaded_resources: Vec::new(), decisions: Vec::new() }
    }
}

impl LinkValidationSummary {
    pub fn empty() -> Self {
        Self { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 }
    }
}

impl DocumentDiagnostics {
    pub fn empty_initial(doc_id: u64, version: u64) -> Self {
        Self {
            doc_id,
            version,
            phase: DiagnosticPhase::Initial,
            issues: Vec::new(),
            resources: ResourcePolicyReport::empty(doc_id, version),
            link_summary: LinkValidationSummary::empty(),
        }
    }

    pub fn enriched(doc_id: u64, version: u64, issues: Vec<DocumentIssue>, resources: ResourcePolicyReport) -> Self {
        Self {
            doc_id,
            version,
            phase: DiagnosticPhase::Enriched,
            issues,
            resources,
            link_summary: LinkValidationSummary::empty(),
        }
    }
}

impl RenderResult {
    pub fn from_core_and_policy(
        doc_id: u64,
        version: u64,
        core: pmd_core::emit::RenderResult,
        policy: crate::preview::resource_policy::ResourcePolicyResolution,
    ) -> Self {
        let mut issues = frontmatter_issues(doc_id, version, &core.facts);
        issues.extend(policy.issues);
        let facts = DocumentFacts { doc_id, version, core: core.facts };
        let diagnostics = DocumentDiagnostics {
            doc_id,
            version,
            phase: DiagnosticPhase::Initial,
            issues,
            resources: policy.report,
            link_summary: LinkValidationSummary::empty(),
        };
        Self {
            doc_id,
            version,
            html: policy.safe_html,
            source_map: core.source_map,
            render_nonce: core.render_nonce,
            facts,
            diagnostics,
        }
    }
}

fn frontmatter_issues(doc_id: u64, version: u64, facts: &CoreDocumentFacts) -> Vec<DocumentIssue> {
    let Some(frontmatter) = &facts.frontmatter else { return Vec::new(); };
    if frontmatter.syntax != FrontmatterSyntax::Malformed {
        return Vec::new();
    }
    vec![DocumentIssue {
        id: format!("frontmatter:{doc_id}:{version}:{}", frontmatter.line_start),
        severity: IssueSeverity::Warning,
        category: IssueCategory::Frontmatter,
        line_start: Some(frontmatter.line_start),
        line_end: Some(frontmatter.line_end),
        block_id: None,
        message: "Frontmatter could not be parsed; previewing body content without frontmatter metadata.".to_string(),
        detail: Some("Fix the YAML/TOML frontmatter delimiter or syntax.".to_string()),
        primary_action: None,
    }]
}
```

- [ ] **Step 4.4: Update render command signature**

Change `render_cmd` to:

```rust
#[tauri::command]
pub async fn render_cmd(
    doc_id: u64,
    version: u64,
    markdown: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<RenderResult, String>
```

Add a test helper with the same render path but an explicit path snapshot:

```rust
pub async fn render_cmd_for_test(
    doc_id: u64,
    version: u64,
    doc_path: Option<&std::path::Path>,
    markdown: String,
) -> Result<RenderResult, String>
```

The synchronous path must:

- call `pmd_core::emit::render_string`.
- resolve `doc_path` and initial `allowed_roots` from `state.docs.preview_snapshot(doc_id)` before building HTML for the webview.
- wrap core facts with `doc_id` and `version`.
- create initial diagnostics with `phase = initial`.
- return safe HTML from the render pipeline, even before resource decisions are fully implemented.

Modify `crates/pmd-app/src/doc/registry.rs` to expose the snapshot used by the command:

```rust
pub struct PreviewDocumentSnapshot {
    pub doc_id: u64,
    pub path: Option<std::path::PathBuf>,
    pub allowed_roots: Vec<std::path::PathBuf>,
}

impl DocRegistry {
    pub fn preview_snapshot(&self, doc_id: u64) -> Result<PreviewDocumentSnapshot, String> {
        let docs = self.lock();
        let doc = docs.get(&crate::doc::state::DocId(doc_id)).ok_or_else(|| "Unknown document".to_string())?;
        let path = doc.path.clone();
        let allowed_roots = path
            .as_ref()
            .and_then(|path| path.parent())
            .and_then(|parent| parent.canonicalize().ok())
            .map(|parent| vec![parent])
            .unwrap_or_default();
        Ok(PreviewDocumentSnapshot { doc_id, path, allowed_roots })
    }
}
```

`preview/render_pipeline.rs` owns the shared implementation:

```rust
pub struct RenderRequest<'a> {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: Option<&'a std::path::Path>,
    pub allowed_roots: Vec<std::path::PathBuf>,
    pub markdown: String,
}

pub fn render_document(request: RenderRequest<'_>) -> Result<RenderResult, String> {
    let core = pmd_core::emit::render_string(&request.markdown);
    let policy = crate::preview::resource_policy::resolve_resources(crate::preview::resource_policy::ResourcePolicyContext {
        doc_id: request.doc_id,
        version: request.version,
        doc_path: request.doc_path,
        markdown: &request.markdown,
        rendered_html: &core.html,
        allowed_roots: request.allowed_roots,
    })?;
    Ok(RenderResult::from_core_and_policy(request.doc_id, request.version, core, policy))
}
```

Create `preview/resource_policy.rs` in Block 4 with the `ResourcePolicyContext`, `ResourcePolicyResolution`, and `resolve_resources` signatures shown in Block 5. Its Block 4 body may return an empty report for non-load-bearing documents so the render command compiles; Block 5 must replace that body before `dit-app-authority` is reviewed or merged.

- [ ] **Step 4.5: Update Tauri registration and frontend call**

Modify `ui/src/main.ts` render invocation to send:

```ts
const active = store.activeDoc();
if (!active) return;

invoke<RenderResult>("render_cmd", {
  docId: active.docId,
  version,
  markdown,
});
```

Drop any render result whose `doc_id` does not match `tab.docId` or whose `version` does not match the latest render version for that tab.

- [ ] **Step 4.6: Verify**

```bash
cargo test -p pmd-app --test cmd_render -j 2
cd ui && npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 4.7: Commit**

```bash
git add crates/pmd-app/src/preview/mod.rs crates/pmd-app/src/preview/contracts.rs crates/pmd-app/src/preview/render_pipeline.rs crates/pmd-app/src/preview/resource_policy.rs crates/pmd-app/src/lib.rs crates/pmd-app/src/main.rs crates/pmd-app/src/cmd/mod.rs crates/pmd-app/src/cmd/render.rs crates/pmd-app/src/doc/registry.rs crates/pmd-app/tests/cmd_render.rs ui/src/main.ts
git commit -m "feat(app): add versioned preview authority contract"
```

## Block 5: Synchronous Resource Policy

**Worktree:** `.worktrees/dit-app-authority` (same `dit-app-authority` workstream as Block 4)

**Owner:** `pmd-app` authority worker with security reviewer subagent.

**Files:**

- Modify: `crates/pmd-app/src/preview/resource_policy.rs`
- Modify: `crates/pmd-app/src/preview/render_pipeline.rs`
- Integration-owner modify: `crates/pmd-app/src/preview/contracts.rs`
- Modify: `crates/pmd-app/src/path_scope.rs`
- Test: `crates/pmd-app/tests/resource_policy.rs`

- [ ] **Step 5.1: Write failing resource policy tests**

Create `crates/pmd-app/tests/resource_policy.rs` with concrete tests for allowed local image, blocked outside-root image, missing image, remote image, `file://` URL, and untitled document behavior:

```rust
#[test]
fn blocked_local_image_becomes_placeholder_and_issue() {
    let temp = tempfile::tempdir().unwrap();
    let docs = temp.path().join("docs");
    std::fs::create_dir(&docs).unwrap();
    std::fs::write(temp.path().join("secret.png"), b"png").unwrap();
    let doc_path = docs.join("doc.md");
    std::fs::write(&doc_path, "![secret](../secret.png)").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        2,
        &doc_path,
        "![secret](../secret.png)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "blocked");
    assert_eq!(resolution.report.decisions[0].reason.as_str(), "outside_allowed_roots");
    assert!(resolution.safe_html.contains("pmd-image-placeholder"));
    assert!(!resolution.safe_html.contains("../secret.png"));
}

#[test]
fn allowed_local_image_rewrites_to_asset_url() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let image_path = temp.path().join("ok.png");
    std::fs::write(&doc_path, "![ok](ok.png)").unwrap();
    std::fs::write(&image_path, b"png").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        3,
        &doc_path,
        "![ok](ok.png)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "allowed");
    assert_eq!(resolution.report.decisions[0].reason.as_str(), "allowed_local_scope");
    assert!(resolution.safe_html.contains("asset://localhost/"));
    assert!(resolution.safe_html.contains("alt=\"ok\""));
}

#[test]
fn missing_local_image_becomes_error_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![missing](missing.png)").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        4,
        &doc_path,
        "![missing](missing.png)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "missing");
    assert!(resolution.issues.iter().any(|issue| {
        issue.severity.as_str() == "error"
            && issue.category.as_str() == "image"
            && issue.message.contains("Image missing")
    }));
}

#[test]
fn unresolved_reference_image_becomes_error_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![logo][missing-ref]\n").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        45,
        &doc_path,
        "![logo][missing-ref]\n",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "missing");
    assert!(resolution.issues.iter().any(|issue| {
        issue.severity.as_str() == "error"
            && issue.category.as_str() == "image"
            && issue.message.contains("Image reference unresolved")
    }));
}

#[test]
fn remote_image_is_blocked_without_fetchable_src() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![remote](https://example.com/i.png)").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        5,
        &doc_path,
        "![remote](https://example.com/i.png)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].reason.as_str(), "remote_blocked");
    assert!(!resolution.safe_html.contains("https://example.com/i.png"));
    assert!(resolution.safe_html.contains("Content Blocked"));
}

#[test]
fn external_links_are_confirmable_not_remote_resource_blocks() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[site](https://example.com)").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        6,
        &doc_path,
        "[site](https://example.com)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].kind.as_str(), "link");
    assert_eq!(resolution.report.decisions[0].reason.as_str(), "external_link_requires_confirmation");
    assert!(!resolution.issues.iter().any(|issue| issue.message.contains("Remote image blocked")));
    assert!(!resolution.safe_html.contains("href=\"https://example.com\""));
}

#[test]
fn file_url_image_is_blocked_without_fetchable_src() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![file](file:///etc/passwd)").unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_for_test(
        1,
        6,
        &doc_path,
        "![file](file:///etc/passwd)",
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].reason.as_str(), "file_url_blocked");
    assert!(!resolution.safe_html.contains("file:///etc/passwd"));
}

#[test]
fn untitled_document_blocks_relative_resource_until_saved() {
    let core = pmd_core::emit::render_string("![draft](draft.png)");
    let resolution = pmd_app_lib::preview::resource_policy::resolve_resources(
        pmd_app_lib::preview::resource_policy::ResourcePolicyContext {
            doc_id: 1,
            version: 7,
            doc_path: None,
            markdown: "![draft](draft.png)",
            rendered_html: &core.html,
            allowed_roots: Vec::new(),
        },
    )
    .expect("policy");

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "blocked");
    assert_eq!(resolution.report.decisions[0].reason.as_str(), "outside_allowed_roots");
    assert!(resolution.safe_html.contains("pmd-image-placeholder"));
}
```

- [ ] **Step 5.2: Run failing tests**

```bash
cargo test -p pmd-app --test resource_policy -j 2
```

Expected: test failure because Block 4 created `resource_policy.rs` with the stable API but returns an empty report and does not yet block unsafe resource targets.

- [ ] **Step 5.3: Implement canonical resource decisions**

`preview/resource_policy.rs` exposes a testable return type that keeps rewritten HTML separate from the report DTO:

```rust
use std::path::{Path, PathBuf};
use crate::preview::contracts::{
    DocumentIssue, IssueCategory, IssueSeverity, ResourceDecision, ResourceDecisionKind,
    ResourceKind, ResourcePolicyReport, ResourceReason,
};

pub struct ResourcePolicyResolution {
    pub safe_html: String,
    pub report: ResourcePolicyReport,
    pub issues: Vec<DocumentIssue>,
}

pub struct ResourcePolicyContext<'a> {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: Option<&'a Path>,
    pub markdown: &'a str,
    pub rendered_html: &'a str,
    pub allowed_roots: Vec<PathBuf>,
}

pub fn resolve_resources(context: ResourcePolicyContext<'_>) -> Result<ResourcePolicyResolution, String> {
    let mut report = ResourcePolicyReport::empty(context.doc_id, context.version);
    report.allowed_roots = context
        .allowed_roots
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let decisions = collect_decisions(&context)?;
    let issues = decisions_to_issues(context.doc_id, context.version, &decisions);
    let safe_html = rewrite_html_with_placeholders(context.rendered_html, &decisions)?;
    report.decisions = decisions;
    Ok(ResourcePolicyResolution { safe_html, report, issues })
}

pub fn resolve_for_test(
    doc_id: u64,
    version: u64,
    doc_path: &Path,
    markdown: &str,
) -> Result<ResourcePolicyResolution, String> {
    let core = pmd_core::emit::render_string(markdown);
    resolve_resources(ResourcePolicyContext {
        doc_id,
        version,
        doc_path: Some(doc_path),
        markdown,
        rendered_html: &core.html,
        allowed_roots: vec![doc_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf()],
    })
}
```

Add these private helpers in the same file. They are deliberately pure and synchronous; async validation may check existence later, but no raw URL can reach the WebView before this pass finishes:

```rust
fn collect_decisions(context: &ResourcePolicyContext<'_>) -> Result<Vec<ResourceDecision>, String> {
    let facts = pmd_core::emit::render_string(context.markdown).facts;
    let mut decisions = Vec::new();
    for (index, image) in facts.images.into_iter().enumerate() {
        let Some(target) = image.target.clone() else {
            decisions.push(ResourceDecision {
                source_target: image
                    .reference_label
                    .as_ref()
                    .map(|label| format!("reference:{label}"))
                    .unwrap_or_else(|| "reference:<missing>".to_string()),
                normalized_target: None,
                line_start: image.line_start,
                line_end: image.line_end,
                kind: ResourceKind::Image,
                decision: ResourceDecisionKind::Missing,
                reason: ResourceReason::MissingFile,
                safe_url: None,
                placeholder_id: Some(format!("image-{index}")),
                alt_text: Some(image.alt_text.clone()),
            });
            continue;
        };
        decisions.push(classify_resource_target(
            context,
            &target,
            image.line_start,
            image.line_end,
            ResourceKind::Image,
            Some(format!("image-{index}")),
            Some(image.alt_text.clone()),
        )?);
    }
    for link in facts.links {
        let target = link.target.clone().unwrap_or_default();
        if is_browser_load_candidate(&target) {
            decisions.push(classify_resource_target(
                context,
                &target,
                link.line_start,
                link.line_end,
                ResourceKind::Link,
                None,
                None,
            )?);
        }
    }
    Ok(decisions)
}

fn classify_resource_target(
    context: &ResourcePolicyContext<'_>,
    target: &str,
    line_start: u32,
    line_end: u32,
    kind: ResourceKind,
    marker_id: Option<String>,
    alt_text: Option<String>,
) -> Result<ResourceDecision, String> {
    let mut decision = ResourceDecision {
        source_target: target.to_string(),
        normalized_target: None,
        line_start,
        line_end,
        kind,
        decision: ResourceDecisionKind::Blocked,
        reason: ResourceReason::InvalidProtocol,
        safe_url: None,
        placeholder_id: marker_id.or_else(|| Some(format!("pmd-resource-{line_start}-{line_end}"))),
        alt_text,
    };

    if target.starts_with("http://") || target.starts_with("https://") {
        decision.reason = if decision.kind == ResourceKind::Image {
            ResourceReason::RemoteBlocked
        } else {
            ResourceReason::ExternalLinkRequiresConfirmation
        };
        return Ok(decision);
    }
    if target.starts_with("file://") {
        decision.reason = ResourceReason::FileUrlBlocked;
        return Ok(decision);
    }
    if target.starts_with("//") || target.contains(':') && !target.starts_with("data:") {
        decision.reason = ResourceReason::InvalidProtocol;
        return Ok(decision);
    }
    if target.starts_with("data:") {
        if decision.kind != ResourceKind::Image {
            decision.kind = ResourceKind::DataUri;
        }
        if is_safe_data_image(target) {
            decision.decision = ResourceDecisionKind::Allowed;
            decision.reason = ResourceReason::AllowedLocalScope;
            decision.safe_url = Some(target.to_string());
        } else {
            decision.reason = ResourceReason::UnsafeDataUri;
        }
        return Ok(decision);
    }

    let Some(doc_path) = context.doc_path else {
        decision.reason = ResourceReason::OutsideAllowedRoots;
        return Ok(decision);
    };
    let base = doc_path.parent().unwrap_or_else(|| Path::new("."));
    let candidate = normalize_path(base.join(target))?;
    decision.normalized_target = Some(candidate.display().to_string());
    if !candidate.exists() {
        decision.decision = ResourceDecisionKind::Missing;
        decision.reason = ResourceReason::MissingFile;
        return Ok(decision);
    }
    let absolute = canonical_existing_path(&candidate)?;
    let allowed_roots = canonical_allowed_roots(&context.allowed_roots)?;
    let allowed = allowed_roots.iter().any(|root| absolute.starts_with(root));
    if !allowed {
        decision.reason = ResourceReason::OutsideAllowedRoots;
        return Ok(decision);
    }
    decision.normalized_target = Some(absolute.display().to_string());
    decision.decision = ResourceDecisionKind::Allowed;
    decision.reason = ResourceReason::AllowedLocalScope;
    decision.safe_url = Some(format!("asset://localhost/{}", percent_encode_path(&absolute)));
    Ok(decision)
}

fn decisions_to_issues(doc_id: u64, version: u64, decisions: &[ResourceDecision]) -> Vec<DocumentIssue> {
    decisions
        .iter()
        .filter(|decision| matches!(decision.decision, ResourceDecisionKind::Blocked | ResourceDecisionKind::Missing))
        .filter(|decision| decision.reason != ResourceReason::ExternalLinkRequiresConfirmation)
        .map(|decision| DocumentIssue {
            id: format!("resource:{}:{}:{}", doc_id, version, decision.placeholder_id.as_deref().unwrap_or("unknown")),
            severity: if decision.decision == ResourceDecisionKind::Missing { IssueSeverity::Error } else { IssueSeverity::Blocked },
            category: if decision.kind == ResourceKind::Image { IssueCategory::Image } else { IssueCategory::ResourcePolicy },
            line_start: Some(decision.line_start),
            line_end: Some(decision.line_end),
            block_id: None,
            message: issue_message(decision),
            detail: decision.normalized_target.clone(),
            primary_action: grant_action_for(decision),
        })
        .collect()
}

fn rewrite_html_with_placeholders(rendered_html: &str, decisions: &[ResourceDecision]) -> Result<String, String> {
    let mut safe_html = rendered_html.to_string();
    for decision in decisions {
        match decision.decision {
            ResourceDecisionKind::Allowed => {
                if decision.kind == ResourceKind::Image {
                    if let (Some(marker_id), Some(safe_url)) = (&decision.placeholder_id, &decision.safe_url) {
                        let alt = decision.alt_text.as_deref().unwrap_or("");
                        let replacement = format!(
                            "<img src=\"{}\" data-pmd-image-id=\"{}\" alt=\"{}\">",
                            html_escape(safe_url),
                            html_escape(marker_id),
                            html_escape(alt)
                        );
                        safe_html = rewrite_image_marker(&safe_html, marker_id, &replacement)?;
                    }
                }
            }
            ResourceDecisionKind::Blocked | ResourceDecisionKind::Missing => {
                if decision.kind == ResourceKind::Image {
                    let marker_id = decision.placeholder_id.as_deref().unwrap_or("pmd-resource");
                    let label = if decision.decision == ResourceDecisionKind::Missing { "Image missing" } else { "Image blocked" };
                    let status = if decision.decision == ResourceDecisionKind::Missing { "Missing File" } else { "Content Blocked" };
                    let alt = decision.alt_text.as_deref().unwrap_or("image");
                    let replacement = format!(
                        "<span data-pmd-image-id=\"{}\" data-pmd-placeholder-id=\"{}\" class=\"pmd-image-placeholder\" data-pmd-resource-state=\"{}\" role=\"img\" aria-label=\"{}: {}\"><span class=\"pmd-image-placeholder-title\">{}</span><span class=\"pmd-image-placeholder-status\">{}</span></span>",
                        html_escape(marker_id),
                        html_escape(marker_id),
                        decision.decision.as_str(),
                        html_escape(label),
                        html_escape(alt),
                        html_escape(label),
                        html_escape(status)
                    );
                    safe_html = rewrite_image_marker(&safe_html, marker_id, &replacement)?;
                } else {
                    safe_html = strip_link_navigation_fields(&safe_html, decision)?;
                }
            }
            ResourceDecisionKind::Unchecked => {}
        }
    }
    Ok(safe_html)
}

fn rewrite_image_marker(html: &str, marker_id: &str, replacement_html: &str) -> Result<String, String> {
    let needle = format!("data-pmd-image-id=\"{}\"", html_escape(marker_id));
    let Some(marker_pos) = html.find(&needle) else { return Ok(html.to_string()); };
    let open_start = html[..marker_pos].rfind('<').ok_or_else(|| format!("image marker {marker_id} had no opening tag"))?;
    let open_end = html[marker_pos..].find('>').map(|offset| marker_pos + offset).ok_or_else(|| format!("image marker {marker_id} had no closing bracket"))?;
    let original_open_tag = &html[open_start..=open_end];
    let replace_end = if original_open_tag.starts_with("<span") {
        html[open_end + 1..]
            .find("</span>")
            .map(|offset| open_end + 1 + offset + "</span>".len())
            .unwrap_or(open_end + 1)
    } else {
        open_end + 1
    };
    let mut next = String::new();
    next.push_str(&html[..open_start]);
    next.push_str(replacement_html);
    next.push_str(&html[replace_end..]);
    Ok(next)
}

fn strip_link_navigation_fields(html: &str, _decision: &ResourceDecision) -> Result<String, String> {
    Ok(html
        .replace(" href=", " data-pmd-stripped-href=")
        .replace(" target=", " data-pmd-stripped-target=")
        .replace(" download=", " data-pmd-stripped-download=")
        .replace(" ping=", " data-pmd-stripped-ping="))
}

fn is_browser_load_candidate(target: &str) -> bool {
    target.starts_with("http://") || target.starts_with("https://") || target.starts_with("file://") || target.starts_with("//")
}

fn is_safe_data_image(target: &str) -> bool {
    target.starts_with("data:image/png;base64,") || target.starts_with("data:image/jpeg;base64,") || target.starts_with("data:image/gif;base64,")
}

fn normalize_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.as_ref().components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Path escapes above the document root".to_string());
                }
            }
            std::path::Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

fn canonical_existing_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|err| format!("Could not canonicalize {}: {err}", path.display()))
}

fn canonical_allowed_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    roots.iter().map(|root| canonical_existing_path(root)).collect()
}

fn percent_encode_path(path: &Path) -> String {
    path.as_os_str()
        .as_encoded_bytes()
        .iter()
        .flat_map(|byte| match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'-' | b'_' => vec![*byte as char],
            other => format!("%{other:02X}").chars().collect(),
        })
        .collect()
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn issue_message(decision: &ResourceDecision) -> String {
    if decision.kind == ResourceKind::Image && decision.source_target.starts_with("reference:") {
        return "Image reference unresolved: define the reference or use an inline path.".to_string();
    }
    match decision.reason {
        ResourceReason::RemoteBlocked => "Remote image blocked: use a local file or open the URL outside the preview.".to_string(),
        ResourceReason::FileUrlBlocked => "file:// resource blocked: use a relative local path and grant the containing folder.".to_string(),
        ResourceReason::OutsideAllowedRoots => "Image blocked: grant the containing folder or move it under the document folder.".to_string(),
        ResourceReason::MissingFile => "Image missing: fix the path or move the file next to the document.".to_string(),
        ResourceReason::UnsafeDataUri => "Unsafe data URI blocked: use a PNG, JPEG, or GIF data image.".to_string(),
        ResourceReason::InvalidProtocol => "Resource blocked: unsupported or unsafe URL scheme.".to_string(),
        ResourceReason::ExternalLinkRequiresConfirmation => "External link requires confirmation before opening outside the app.".to_string(),
        ResourceReason::AllowedLocalScope | ResourceReason::NotApplicable => "Resource allowed.".to_string(),
    }
}

fn grant_action_for(decision: &ResourceDecision) -> Option<String> {
    if decision.kind == ResourceKind::Image
        && matches!(decision.reason, ResourceReason::OutsideAllowedRoots | ResourceReason::FileUrlBlocked)
    {
        Some("asset.grantFolder".to_string())
    } else {
        None
    }
}
```

`collect_decisions`, `decisions_to_issues`, and `rewrite_html_with_placeholders`:

- treats the document directory as the default local image root for saved files.
- treats untitled relative resources as blocked or unchecked with a diagnostic.
- canonicalizes paths before comparing allowed roots.
- distinguishes `missing` from `blocked`.
- blocks remote images, `file://`, protocol-relative, unknown schemes, unsafe data URIs, and outside-root local paths.
- classifies external `http`/`https` links as `external_link_requires_confirmation`, strips browser navigation fields, and leaves user-facing confirmation to Block 6 instead of surfacing them as remote image blocks.
- rewrites allowed local images to backend-issued safe asset URLs.
- never accepts a renderer-supplied path as permission.

- [ ] **Step 5.4: Produce initial diagnostics from policy**

For every blocked or missing load-bearing resource, add a `DocumentIssue` with:

- `severity = blocked` for intentional policy blocks.
- `severity = error` for missing local files.
- `category = image` or `resource_policy`.
- one-line actionable `message`, such as `Image blocked: grant the containing folder or move it under the document folder.`
- `primary_action = Some("asset.grantFolder")` when a folder grant could resolve the issue.

- [ ] **Step 5.5: Verify**

```bash
cargo test -p pmd-app --test resource_policy -j 2
cargo test -p pmd-app --test cmd_render -j 2
cargo check -p pmd-e2e --tests -j 2
just test-ipc
```

Expected: all commands pass. Security PASS for document-originated navigation remains provisional until Block 12 adds and runs `crates/pmd-e2e/tests/navigation_policy.rs` through `just e2e`.

- [ ] **Step 5.6: Commit**

```bash
git add crates/pmd-app/src/preview/resource_policy.rs crates/pmd-app/src/preview/render_pipeline.rs crates/pmd-app/src/preview/contracts.rs crates/pmd-app/src/path_scope.rs crates/pmd-app/tests/resource_policy.rs crates/pmd-app/tests/cmd_render.rs
git commit -m "feat(app): resolve preview resources before insertion"
```

## Block 6: Backend-Mediated Link Activation

**Worktree:** `.worktrees/dit-app-authority` (same `dit-app-authority` workstream as Blocks 4-5)

**Owner:** `pmd-app` authority worker plus UI link handler worker.

**Files:**

- Create: `crates/pmd-app/src/preview/link_activation.rs`
- Modify: `crates/pmd-app/src/preview/mod.rs`
- Modify: `crates/pmd-app/src/preview/render_pipeline.rs`
- Modify: `crates/pmd-app/src/cmd/render.rs`
- Integration-owner modify: `crates/pmd-app/src/preview/contracts.rs`
- Modify: `crates/pmd-app/src/cmd/reveal.rs`
- Integration-owner modify: `crates/pmd-app/src/main.rs`
- Create: `ui/src/link_activation.ts`
- Integration-owner modify: `ui/src/main.ts`
- Modify: `ui/tsconfig.json`
- Test: `crates/pmd-app/tests/link_activation.rs`
- Test: `ui/src/link_activation.test.ts`

- [ ] **Step 6.1: Write backend link activation tests**

`crates/pmd-app/tests/link_activation.rs` must cover fragment jumps, local Markdown links, local files, external confirmation, mailto confirmation, unknown scheme denial, stale link ids, backend-issued confirmation token binding, single-use tokens, stale-version rejection, and renderer URL-swap rejection.

Example:

```rust
#[test]
fn external_link_requires_confirmation_with_normalized_parts() {
    let mut state = pmd_app_lib::preview::link_activation::test_state();
    state.insert_link_for_test(7, 12, "link-0", "https://example.com/path?q=1", "safe label");

    let action = state
        .prepare_link_activation(7, 12, "link-0", pmd_app_lib::preview::link_activation::ActivationKind::Primary)
        .expect("action");

    assert_eq!(action.kind.as_str(), "external_confirmation");
    assert_eq!(action.normalized_url.as_deref(), Some("https://example.com/path?q=1"));
    assert_eq!(action.scheme.as_deref(), Some("https"));
    assert_eq!(action.host.as_deref(), Some("example.com"));
    assert!(action.action_token.is_some());
}

#[test]
fn external_confirmation_token_is_bound_single_use_and_not_renderer_swappable() {
    let mut state = pmd_app_lib::preview::link_activation::test_state();
    state.insert_link_for_test(7, 12, "link-0", "https://example.com/path?q=1", "safe label");
    let token = state
        .prepare_link_activation(7, 12, "link-0", pmd_app_lib::preview::link_activation::ActivationKind::Primary)
        .unwrap()
        .action_token
        .unwrap();

    assert!(state.confirm_external_open(7, 99, &token).is_err());
    assert!(state.confirm_external_open_with_renderer_url_for_test(7, 12, &token, "https://evil.test").is_err());
    assert!(state.confirm_external_open(7, 12, &token).is_ok());
    assert!(state.confirm_external_open(7, 12, &token).is_err());
}

#[tokio::test]
async fn render_registers_production_link_targets_for_backend_activation() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[Open](https://example.com/path?q=1)").unwrap();
    let store = pmd_app_lib::preview::link_activation::LinkActivationStore::default();

    let result = pmd_app_lib::cmd::render::render_cmd_for_test_with_links(
        7,
        12,
        Some(&doc_path),
        "[Open](https://example.com/path?q=1)".to_string(),
        &store,
    )
    .await
    .expect("render");

    assert!(result.html.contains("data-pmd-link-id=\"link-0\""));
    assert!(!result.html.contains("href=\"https://example.com/path?q=1\""));

    let action = store
        .prepare_link_activation(7, 12, "link-0", pmd_app_lib::preview::link_activation::ActivationKind::Primary)
        .expect("stored production link target");
    assert_eq!(action.kind.as_str(), "external_confirmation");
    assert_eq!(action.normalized_url.as_deref(), Some("https://example.com/path?q=1"));
}
```

- [ ] **Step 6.2: Write UI inert link tests**

Create tests in `ui/src/link_activation.test.ts` that assert:

- click on `[data-pmd-link-id]` calls the backend command.
- Enter on focused link calls the same command.
- middle-click, context-menu open, and dragstart call the backend command with an activation kind and never read raw `href`.
- stale render ids are ignored by the UI store.

Include:

```ts
test("preview links activate through backend command only", async () => {
  const calls: unknown[] = [];
  const root = document.createElement("div");
  root.innerHTML = '<a data-pmd-link-id="link-0" role="link" tabindex="0">Open</a>';
  attachPreviewLinkActivation(root, {
    currentDoc: () => ({ doc_id: 7, version: 12 }),
    invoke: async (command, payload) => calls.push({ command, payload }),
  });

  root.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  root.querySelector("a")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  assert.deepEqual(calls, [
    { command: "prepare_link_activation", payload: { docId: 7, version: 12, linkId: "link-0", activationKind: "primary" } },
    { command: "prepare_link_activation", payload: { docId: 7, version: 12, linkId: "link-0", activationKind: "keyboard" } },
  ]);
});

test("middle click context menu and drag route through backend mediation", async () => {
  const calls: unknown[] = [];
  const root = document.createElement("div");
  root.innerHTML = '<a data-pmd-link-id="link-0" href="https://evil.test">Open</a>';
  attachPreviewLinkActivation(root, {
    currentDoc: () => ({ doc_id: 7, version: 12 }),
    invoke: async (command, payload) => calls.push({ command, payload }),
  });

  root.querySelector("a")!.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
  root.querySelector("a")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  root.querySelector("a")!.dispatchEvent(new Event("dragstart", { bubbles: true }));

  assert.deepEqual(calls, [
    { command: "prepare_link_activation", payload: { docId: 7, version: 12, linkId: "link-0", activationKind: "auxiliary" } },
    { command: "prepare_link_activation", payload: { docId: 7, version: 12, linkId: "link-0", activationKind: "context_menu" } },
    { command: "prepare_link_activation", payload: { docId: 7, version: 12, linkId: "link-0", activationKind: "drag" } },
  ]);
  assert.equal(root.querySelector("a")!.getAttribute("href"), null);
});
```

- [ ] **Step 6.3: Implement backend link activation**

Commands:

- `prepare_link_activation(doc_id, version, link_id, activation_kind) -> LinkActivationResponse`
- `confirm_external_open(doc_id, version, action_token) -> Result<(), String>`

`activation_kind` is one of `primary`, `keyboard`, `auxiliary`, `context_menu`, `drag`, or `webview_navigation`. `action_token` is generated only by the backend, is bound to `doc_id`, `version`, `link_id`, `activation_kind`, normalized URL, scheme, host, and label context, and is single-use. `confirm_external_open` rejects stale versions, unknown tokens, reused tokens, and any renderer-supplied URL field.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationKind {
    Primary,
    Keyboard,
    Auxiliary,
    ContextMenu,
    Drag,
    WebviewNavigation,
}
```

`crates/pmd-app/src/preview/link_activation.rs` must own the production link store, not just test helpers. The store is the only place `prepare_link_activation` can resolve a `link_id` to a target:

Export the module from `crates/pmd-app/src/preview/mod.rs`:

```rust
pub mod link_activation;
```

```rust
#[derive(Debug, Clone)]
struct StoredLink {
    target: String,
    label_text: String,
    kind: pmd_core::facts::LinkKind,
    doc_path: Option<std::path::PathBuf>,
    line_start: u32,
    line_end: u32,
}

#[derive(Default)]
pub struct LinkActivationStore {
    links: std::sync::Mutex<std::collections::BTreeMap<(u64, u64, String), StoredLink>>,
    tokens: std::sync::Mutex<std::collections::BTreeMap<String, PendingExternalOpen>>,
}

impl LinkActivationStore {
    pub fn record_render_links(
        &self,
        doc_id: u64,
        version: u64,
        doc_path: Option<&std::path::Path>,
        facts: &crate::preview::contracts::DocumentFacts,
    ) {
        let mut links = self.links.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        links.retain(|(stored_doc, _, _), _| *stored_doc != doc_id);
        for (idx, link) in facts.core.links.iter().enumerate() {
            let Some(target) = &link.target else { continue };
            links.insert(
                (doc_id, version, format!("link-{idx}")),
                StoredLink {
                    target: target.clone(),
                    label_text: link.label_text.clone(),
                    kind: link.kind.clone(),
                    doc_path: doc_path.map(std::path::Path::to_path_buf),
                    line_start: link.line_start,
                    line_end: link.line_end,
                },
            );
        }
    }

    pub fn prepare_link_activation(
        &self,
        doc_id: u64,
        version: u64,
        link_id: &str,
        activation_kind: ActivationKind,
    ) -> Result<LinkActivationResponse, String> {
        let link = self.links
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&(doc_id, version, link_id.to_string()))
            .cloned()
            .ok_or_else(|| "Unknown or stale preview link".to_string())?;
        classify_stored_link(doc_id, version, activation_kind, link, &self.tokens)
    }
}
```

The store derives ids from the same source-authored link order as the inert markers emitted by Block 3 (`link-0`, `link-1`, ...). It never reads a URL from the DOM and never accepts a renderer-supplied target argument.

Modify `crates/pmd-app/src/cmd/render.rs` so production render calls populate the store immediately after safe HTML and facts are produced:

```rust
#[tauri::command]
pub async fn render_cmd(
    state: tauri::State<'_, crate::AppState>,
    links: tauri::State<'_, crate::preview::link_activation::LinkActivationStore>,
    doc_id: u64,
    version: u64,
    markdown: String,
) -> Result<crate::preview::contracts::RenderResult, String> {
    let snapshot = state.docs.preview_snapshot(doc_id)?;
    let result = crate::preview::render_pipeline::render_document(crate::preview::render_pipeline::RenderRequest {
        doc_id,
        version,
        doc_path: snapshot.path.as_deref(),
        allowed_roots: snapshot.allowed_roots,
        markdown,
    })?;
    links.record_render_links(result.doc_id, result.version, snapshot.path.as_deref(), &result.facts);
    Ok(result)
}
```

Register `LinkActivationStore::default()` with Tauri state in `crates/pmd-app/src/main.rs`, and register both activation commands beside `render_cmd`. `render_cmd_for_test_with_links` must exercise the same `record_render_links` path as production so the backend link store cannot drift into test-only behavior.

Backend responses:

- `scroll_to_block` for current-document fragments.
- `open_document` for local Markdown.
- `open_default_app` for allowed local non-Markdown.
- `external_confirmation` for `http`, `https`, and `mailto`.
- `denied` for unknown or unsafe schemes, stale ids, drag attempts that would expose a URL, context-menu open attempts without confirmation, and WebView navigation attempts that are not backed by a current token.

- [ ] **Step 6.4: Implement UI handler**

`ui/src/link_activation.ts` attaches delegated `click`, `keydown`, `auxclick`, `contextmenu`, and `dragstart` listeners to the preview root. It removes `href`, `target`, `download`, and `ping` from source-authored preview links before insertion, prevents default browser behavior for all preview-originated activations, sends only `{ docId, version, linkId, activationKind }` to the backend, and never reads a Markdown URL from the DOM. Block 12 adds the WebView-level navigation interception sentinel for attempts that bypass DOM handlers.

Add `src/link_activation.ts` to `ui/tsconfig.json` `include` before running `npm run typecheck`.

The UI handler must also own the external confirmation handoff. `prepare_link_activation` responses with `kind === "external_confirmation"` open an in-app confirmation dialog; only the confirmation button sends `confirm_external_open(docId, version, actionToken)`. No external URL is rendered as a clickable link inside the dialog.

Add the response handler contract to `ui/src/link_activation.ts`:

```ts
export interface LinkActivationResponse {
  kind: "scroll_to_block" | "open_document" | "open_default_app" | "external_confirmation" | "denied";
  block_id?: string | null;
  opened_document?: OpenedDocumentFromLink | null;
  normalized_url?: string | null;
  scheme?: string | null;
  host?: string | null;
  label_text?: string | null;
  action_token?: string | null;
  message?: string | null;
}

export interface OpenedDocumentFromLink {
  doc_id: number;
  path: string;
  contents: string;
  state: unknown;
}

export interface ExternalConfirmationDialog {
  show(response: LinkActivationResponse, onConfirm: () => Promise<void>): void;
}

export async function handleLinkActivationResponse(options: {
  response: LinkActivationResponse;
  docId: number;
  version: number;
  invoke: (command: string, payload: unknown) => Promise<unknown>;
  scrollToBlock: (blockId: string) => void;
  openDocument: (document: OpenedDocumentFromLink) => void | Promise<void>;
  showMessage: (message: string) => void;
  externalConfirmation: ExternalConfirmationDialog;
}) {
  const { response } = options;
  if (response.kind === "scroll_to_block" && response.block_id) {
    options.scrollToBlock(response.block_id);
    return;
  }
  if (response.kind === "open_document" && response.opened_document) {
    await options.openDocument(response.opened_document);
    return;
  }
  if (response.kind === "open_default_app") {
    options.showMessage(response.message ?? "Opened local file in the default application.");
    return;
  }
  if (response.kind === "denied") {
    options.showMessage(response.message ?? "Preview link blocked.");
    return;
  }
  if (response.kind === "external_confirmation" && response.action_token) {
    options.externalConfirmation.show(response, async () => {
      await options.invoke("confirm_external_open", {
        docId: options.docId,
        version: options.version,
        actionToken: response.action_token,
      });
    });
  }
}
```

The backend must complete local Markdown registration or local default-app opening before returning `open_document` or `open_default_app`. The UI adopts `opened_document` from the backend response and never calls `open_file`, `request_open_file`, or an opener command with a renderer-supplied path.

Add unit tests proving local responses are handled and confirmation is not bypassed:

```ts
test("local open responses use backend-owned payloads", async () => {
  const opened: unknown[] = [];
  const messages: string[] = [];
  await handleLinkActivationResponse({
    response: {
      kind: "open_document",
      opened_document: { doc_id: 8, path: "/trusted/doc.md", contents: "# Linked", state: { kind: "clean" } },
    },
    docId: 7,
    version: 12,
    invoke: async () => assert.fail("should not invoke another open command"),
    scrollToBlock: () => assert.fail("should not scroll"),
    openDocument: async (document) => opened.push(document),
    showMessage: (message) => messages.push(message),
    externalConfirmation: { show: () => assert.fail("should not confirm") },
  });

  assert.equal(opened.length, 1);

  await handleLinkActivationResponse({
    response: { kind: "open_default_app", message: "Opened report.pdf" },
    docId: 7,
    version: 12,
    invoke: async () => assert.fail("should not invoke another open command"),
    scrollToBlock: () => assert.fail("should not scroll"),
    openDocument: async () => assert.fail("should not open a document"),
    showMessage: (message) => messages.push(message),
    externalConfirmation: { show: () => assert.fail("should not confirm") },
  });

  assert.deepEqual(messages, ["Opened report.pdf"]);
});

test("external confirmation waits for explicit confirm before opening", async () => {
  const calls: unknown[] = [];
  let confirm: (() => Promise<void>) | null = null;
  await handleLinkActivationResponse({
    response: {
      kind: "external_confirmation",
      normalized_url: "https://example.com/path",
      scheme: "https",
      host: "example.com",
      label_text: "Open",
      action_token: "token-1",
    },
    docId: 7,
    version: 12,
    invoke: async (command, payload) => calls.push({ command, payload }),
    scrollToBlock: () => assert.fail("should not scroll"),
    openDocument: async () => assert.fail("should not open a document"),
    showMessage: () => assert.fail("should not show denial"),
    externalConfirmation: { show: (_response, onConfirm) => { confirm = onConfirm; } },
  });

  assert.deepEqual(calls, []);
  await confirm!();
  assert.deepEqual(calls, [{
    command: "confirm_external_open",
    payload: { docId: 7, version: 12, actionToken: "token-1" },
  }]);
});
```

In `ui/src/main.ts`, call `handleLinkActivationResponse` with the existing preview scroll function, a status/error display callback, and the confirmation dialog rendered by Block 10's `trust_policy_panel.ts`. Until Block 10 lands, Block 6 must provide a minimal modal in `link_activation.ts` with `data-testid="confirm-external-open"` so the Block 12 WebDriver sentinel can confirm an external open without relying on the later trust panel.

For e2e observability, guard this test-only event behind the probe object so production users never see it:

```ts
if (window.__pmdE2e) {
  document.dispatchEvent(new CustomEvent("pmd-link-activation", { detail: { activationKind } }));
}
```

Inside the `handleLinkActivationResponse` external-confirmation callback, after `confirm_external_open` succeeds, emit the test event from the existing response object:

```ts
if (window.__pmdE2e) {
  document.dispatchEvent(new CustomEvent("pmd-external-open", { detail: { url: response.normalized_url ?? "" } }));
}
```

- [ ] **Step 6.5: Verify**

```bash
cargo test -p pmd-app --test link_activation -j 2
cargo check -p pmd-e2e --tests -j 2
cd ui && npm run test:unit
cd ui && npm run typecheck
```

Expected: all commands pass. Security PASS for external link activation remains provisional until Block 12 adds and runs the WebDriver navigation sentinel through `just e2e`.

- [ ] **Step 6.6: Review and merge app authority branch**

```bash
ccc --yolo @cx-reviewer "Review the app preview authority/resource/link activation diff for filesystem authority, stale-result handling, and document-originated navigation safety. Treat security PASS as provisional until Block 12 WebDriver navigation sentinels run. Return PASS or concrete blockers."
```

Repeat until `PASS`, then:

```bash
git add crates/pmd-app/src/preview/link_activation.rs crates/pmd-app/src/preview/mod.rs crates/pmd-app/src/preview/render_pipeline.rs crates/pmd-app/src/cmd/render.rs crates/pmd-app/src/preview/contracts.rs crates/pmd-app/src/cmd/reveal.rs crates/pmd-app/src/main.rs crates/pmd-app/tests/link_activation.rs ui/src/link_activation.ts ui/src/link_activation.test.ts ui/src/main.ts ui/tsconfig.json
git commit -m "feat(app): mediate preview link activation"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-app-authority
```

## Block 7: Async Local Validation

**Worktree:** `.worktrees/dit-validation`

**Owner:** `pmd-app` validation worker.

**Files:**

- Create: `crates/pmd-app/src/preview/validation.rs`
- Modify: `crates/pmd-app/src/preview/mod.rs`
- Integration-owner modify: `crates/pmd-app/src/preview/contracts.rs`
- Modify: `crates/pmd-app/src/preview/render_pipeline.rs`
- Modify: `crates/pmd-app/src/cmd/render.rs`
- Modify: `crates/pmd-app/src/cmd/doc.rs`
- Modify: `crates/pmd-app/src/watcher.rs`
- Integration-owner modify: `crates/pmd-app/src/main.rs`
- Integration-owner modify: `ui/src/main.ts`
- Modify: `Cargo.toml`
- Modify: `crates/pmd-app/Cargo.toml`
- Test: `crates/pmd-app/tests/async_validation.rs`

Manifest ownership for this block is intentional: production validation uses `tokio::fs` and `tokio::sync`, so update the workspace `tokio` dependency and `pmd-app` manifest before implementation:

```toml
# Cargo.toml
tokio = { version = "1", features = ["macros", "rt-multi-thread", "fs", "sync"] }

# crates/pmd-app/Cargo.toml
[dependencies]
tokio.workspace = true
```

Remove the redundant `tokio.workspace = true` entry from `crates/pmd-app` `[dev-dependencies]`; tests continue to use the production dependency.

- [ ] **Step 7.1: Write failing async validation tests**

Create `crates/pmd-app/tests/async_validation.rs` with the complete test module below. It covers:

- current-file `#fragment` matches generated slugs.
- missing `#fragment` creates `severity = error`, `category = anchor`.
- `other.md#heading` reads only direct linked Markdown files.
- existing local non-Markdown file links pass without opening the file in the WebView.
- missing local non-Markdown file links create `severity = error`, `category = link`.
- existing local image paths produce no validation issue after synchronous resource policy allows them.
- missing local image paths create `severity = error`, `category = image`.
- blocked local image paths keep their synchronous resource-policy `blocked` issue and are not authorized by async validation.
- unresolved reference links create link issues.
- unresolved reference images create image issues instead of being treated as allowed local paths.
- budget exhaustion creates a warning with skipped count.
- stale `(doc_id, version)` results are not emitted.
- cache entries are invalidated by save, file watcher change, folder grant change, and explicit reload.

```rust
#[tokio::test]
async fn cross_file_anchor_validation_reports_missing_heading() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("doc.md"), "[missing](other.md#nope)").unwrap();
    std::fs::write(temp.path().join("other.md"), "# Present\n").unwrap();

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(
        10,
        22,
        &temp.path().join("doc.md"),
        "[missing](other.md#nope)",
    )
    .await
    .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| issue.category.as_str() == "anchor" && issue.severity.as_str() == "error"));
}

#[tokio::test]
async fn local_file_and_image_path_diagnostics_distinguish_missing_from_valid() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(temp.path().join("present.pdf"), b"pdf").unwrap();
    std::fs::write(temp.path().join("ok.png"), b"png").unwrap();
    let markdown = "[ok](present.pdf) [missing](missing.pdf)\n\n![ok](ok.png)\n![missing](missing.png)";

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 23, &doc_path, markdown)
        .await
        .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "link"
            && issue.severity.as_str() == "error"
            && issue.message.contains("missing.pdf")
    }));
    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "image"
            && issue.severity.as_str() == "error"
            && issue.message.contains("missing.png")
    }));
    assert!(!diagnostics.issues.iter().any(|issue| issue.message.contains("present.pdf")));
    assert!(!diagnostics.issues.iter().any(|issue| issue.message.contains("ok.png")));
}

#[tokio::test]
async fn duplicate_heading_slugs_validate_current_and_cross_file_fragments() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let other_path = temp.path().join("other.md");
    std::fs::write(&other_path, "# Title\n\n# Title\n").unwrap();
    let markdown = "# Title\n\n# Title\n\n[local ok](#title-1) [local bad](#title-2) [cross ok](other.md#title-1)";

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 24, &doc_path, markdown)
        .await
        .expect("diagnostics");

    assert!(!diagnostics.issues.iter().any(|issue| issue.message.contains("#title-1")));
    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "anchor"
            && issue.severity.as_str() == "error"
            && issue.message.contains("#title-2")
    }));
}

#[tokio::test]
async fn unresolved_reference_link_creates_link_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "[missing][nope]";

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 25, &doc_path, markdown)
        .await
        .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "link"
            && issue.severity.as_str() == "error"
            && issue.message.contains("nope")
    }));
}

#[tokio::test]
async fn unresolved_reference_image_creates_image_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "![logo][missing-ref]";

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 251, &doc_path, markdown)
        .await
        .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "image"
            && issue.severity.as_str() == "error"
            && issue.message.contains("Image reference unresolved")
    }));
}

#[tokio::test]
async fn validation_does_not_recursively_crawl_linked_markdown() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(temp.path().join("other.md"), "# Present\n\n[nested](nested.md#missing)").unwrap();
    std::fs::write(temp.path().join("nested.md"), "# Different\n").unwrap();
    let markdown = "[direct](other.md#present)";

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 26, &doc_path, markdown)
        .await
        .expect("diagnostics");

    assert!(!diagnostics.issues.iter().any(|issue| issue.message.contains("nested.md")));
}

#[tokio::test]
async fn budget_exhaustion_reports_warning() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = (0..520)
        .map(|idx| format!("[missing-{idx}](missing-{idx}.md)"))
        .collect::<Vec<_>>()
        .join("\n");

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(10, 27, &doc_path, &markdown)
        .await
        .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.severity.as_str() == "warning"
            && issue.category.as_str() == "filesystem"
            && issue.message.contains("512 fact budget")
    }));
}

#[tokio::test]
async fn blocked_local_image_keeps_initial_resource_policy_issue() {
    use std::sync::Arc;
    use pmd_app_lib::preview::contracts::{
        DocumentDiagnostics, DocumentIssue, IssueCategory, IssueSeverity,
    };
    use pmd_app_lib::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "![secret](../secret.png)";
    let mut initial = DocumentDiagnostics::empty_initial(10, 28);
    initial.issues.push(DocumentIssue {
        id: "resource:10:28:image-0".to_string(),
        severity: IssueSeverity::Blocked,
        category: IssueCategory::ResourcePolicy,
        line_start: Some(1),
        line_end: Some(1),
        block_id: None,
        message: "Image blocked: grant the containing folder or move it under the document folder.".to_string(),
        detail: Some("../secret.png".to_string()),
        primary_action: Some("asset.grantFolder".to_string()),
    });

    let mut engine = ValidationEngine::new(ValidationLimits::default());
    let diagnostics = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 28,
        doc_path,
        markdown: markdown.to_string(),
        initial_diagnostics: initial,
        is_current: Arc::new(|_, _| true),
    }).await.expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.severity.as_str() == "blocked"
            && issue.category.as_str() == "resource_policy"
            && issue.message.contains("Image blocked")
    }));
}

#[tokio::test]
async fn stale_validation_worker_result_is_not_emitted() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[missing](missing.md#nope)").unwrap();
    let worker = pmd_app_lib::preview::render_pipeline::ValidationWorker::new();
    worker.observe_render(10, 30);

    let result = worker.validate_current(
        10,
        29,
        doc_path,
        "[missing](missing.md#nope)".to_string(),
        pmd_app_lib::preview::contracts::DocumentDiagnostics::empty_initial(10, 29),
    ).await.expect("validation");

    assert!(result.is_none());
}

#[tokio::test]
async fn invalidation_refreshes_cross_file_anchor_cache() {
    use std::sync::Arc;
    use pmd_app_lib::preview::contracts::DocumentDiagnostics;
    use pmd_app_lib::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let other_path = temp.path().join("other.md");
    std::fs::write(&other_path, "# Old\n").unwrap();
    let markdown = "[linked](other.md#new)";
    let mut engine = ValidationEngine::new(ValidationLimits::default());

    let first = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 31,
        doc_path: doc_path.clone(),
        markdown: markdown.to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(10, 31),
        is_current: Arc::new(|_, _| true),
    }).await.expect("first diagnostics");
    assert!(first.issues.iter().any(|issue| issue.message.contains("#new")));

    std::fs::write(&other_path, "# New\n").unwrap();
    engine.invalidate_for_watcher_change(&other_path);
    let second = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 32,
        doc_path: doc_path.clone(),
        markdown: markdown.to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(10, 32),
        is_current: Arc::new(|_, _| true),
    }).await.expect("second diagnostics");

    assert!(!second.issues.iter().any(|issue| issue.message.contains("#new")));

    std::fs::write(&other_path, "# Save\n").unwrap();
    engine.invalidate_for_save(&other_path);
    let after_save = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 33,
        doc_path: doc_path.clone(),
        markdown: "[linked](other.md#save)".to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(10, 33),
        is_current: Arc::new(|_, _| true),
    }).await.expect("save invalidation diagnostics");
    assert!(!after_save.issues.iter().any(|issue| issue.message.contains("#save")));

    std::fs::write(&other_path, "# Grant\n").unwrap();
    engine.invalidate_for_grant_change(10);
    let after_grant = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 34,
        doc_path: doc_path.clone(),
        markdown: "[linked](other.md#grant)".to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(10, 34),
        is_current: Arc::new(|_, _| true),
    }).await.expect("grant invalidation diagnostics");
    assert!(!after_grant.issues.iter().any(|issue| issue.message.contains("#grant")));

    std::fs::write(&other_path, "# Reload\n").unwrap();
    engine.invalidate_for_reload(10);
    let after_reload = engine.validate(ValidationRequest {
        doc_id: 10,
        version: 35,
        doc_path,
        markdown: "[linked](other.md#reload)".to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(10, 35),
        is_current: Arc::new(|_, _| true),
    }).await.expect("reload invalidation diagnostics");
    assert!(!after_reload.issues.iter().any(|issue| issue.message.contains("#reload")));
}
```

- [ ] **Step 7.2: Implement budgets and cache**

`preview/validation.rs` exposes the concrete engine and request shape below. Tests may use `validate_for_test`, but production code uses `ValidationEngine::validate` so stale cancellation and cache invalidation are testable:

```rust
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use crate::preview::contracts::{
    DocumentDiagnostics, DocumentIssue, IssueCategory, IssueSeverity, LinkValidationSummary,
};

#[derive(Debug, Clone)]
pub struct ValidationLimits {
    pub max_facts_per_render: usize,
    pub max_distinct_cross_file_targets: usize,
    pub max_single_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_concurrent_checks: usize,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            max_facts_per_render: 512,
            max_distinct_cross_file_targets: 64,
            max_single_file_bytes: 1024 * 1024,
            max_total_bytes: 8 * 1024 * 1024,
            max_concurrent_checks: 4,
        }
    }
}

pub struct ValidationRequest {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: PathBuf,
    pub markdown: String,
    pub initial_diagnostics: DocumentDiagnostics,
    pub is_current: Arc<dyn Fn(u64, u64) -> bool + Send + Sync>,
}

#[derive(Default)]
struct CrossFileAnchorCache {
    anchors_by_path: BTreeMap<PathBuf, CachedAnchorFacts>,
    paths_by_doc: BTreeMap<u64, Vec<PathBuf>>,
}

struct CachedAnchorFacts {
    modified: Option<std::time::SystemTime>,
    len: u64,
    anchors: Vec<String>,
}

impl CrossFileAnchorCache {
    async fn get_or_read(
        &mut self,
        path: &Path,
        budget: &mut ValidationBudget<'_>,
        fs_gate: &tokio::sync::Semaphore,
    ) -> Result<Option<Vec<String>>, String> {
        let _permit = fs_gate.acquire().await.map_err(|err| err.to_string())?;
        let canonical = match tokio::fs::canonicalize(path).await {
            Ok(path) => path,
            Err(err) => return Err(err.to_string()),
        };
        if !budget.try_cross_file_target(&canonical) {
            return Ok(None);
        }
        let metadata = tokio::fs::metadata(&canonical).await.map_err(|err| err.to_string())?;
        if !budget.reserve_file_read(metadata.len()) {
            return Ok(None);
        }
        let modified = metadata.modified().ok();
        if let Some(cached) = self.anchors_by_path.get(&canonical) {
            if cached.modified == modified && cached.len == metadata.len() {
                return Ok(Some(cached.anchors.clone()));
            }
        }
        let markdown = tokio::fs::read_to_string(&canonical).await.map_err(|err| err.to_string())?;
        let facts = pmd_core::emit::render_string(&markdown).facts;
        let anchors = facts.anchors.into_iter().map(|anchor| anchor.slug).collect::<Vec<_>>();
        self.anchors_by_path.insert(canonical, CachedAnchorFacts { modified, len: metadata.len(), anchors: anchors.clone() });
        Ok(Some(anchors))
    }

    fn observe_doc_path(&mut self, doc_id: u64, path: PathBuf) {
        let canonical = path.canonicalize().unwrap_or(path);
        self.paths_by_doc.entry(doc_id).or_default().push(canonical);
    }

    fn invalidate_path(&mut self, path: &Path) {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.anchors_by_path.remove(&canonical);
    }

    fn invalidate_doc(&mut self, doc_id: u64) {
        if let Some(paths) = self.paths_by_doc.remove(&doc_id) {
            for path in paths {
                self.anchors_by_path.remove(&path);
            }
        }
    }
}

struct ValidationBudget<'a> {
    limits: &'a ValidationLimits,
    remaining_fact_checks: usize,
    skipped_facts: usize,
    distinct_cross_file_targets: BTreeSet<PathBuf>,
    total_read_bytes: u64,
    skipped_cross_file_targets: usize,
    skipped_oversized_files: usize,
    skipped_total_bytes: usize,
}

impl<'a> ValidationBudget<'a> {
    fn new(limits: &'a ValidationLimits, facts: &pmd_core::facts::CoreDocumentFacts) -> Self {
        let reference_facts = facts.reference_definitions.len();
        let remaining_fact_checks = limits.max_facts_per_render.saturating_sub(reference_facts);
        let skipped_facts = reference_facts.saturating_sub(limits.max_facts_per_render);
        Self {
            limits,
            remaining_fact_checks,
            skipped_facts,
            distinct_cross_file_targets: BTreeSet::new(),
            total_read_bytes: 0,
            skipped_cross_file_targets: 0,
            skipped_oversized_files: 0,
            skipped_total_bytes: 0,
        }
    }

    fn consume_fact(&mut self) -> bool {
        if self.remaining_fact_checks == 0 {
            self.skipped_facts += 1;
            return false;
        }
        self.remaining_fact_checks -= 1;
        true
    }

    fn try_cross_file_target(&mut self, canonical: &Path) -> bool {
        if self.distinct_cross_file_targets.contains(canonical) {
            return true;
        }
        if self.distinct_cross_file_targets.len() >= self.limits.max_distinct_cross_file_targets {
            self.skipped_cross_file_targets += 1;
            return false;
        }
        self.distinct_cross_file_targets.insert(canonical.to_path_buf());
        true
    }

    fn reserve_file_read(&mut self, bytes: u64) -> bool {
        if bytes > self.limits.max_single_file_bytes {
            self.skipped_oversized_files += 1;
            return false;
        }
        if self.total_read_bytes.saturating_add(bytes) > self.limits.max_total_bytes {
            self.skipped_total_bytes += 1;
            return false;
        }
        self.total_read_bytes += bytes;
        true
    }

    fn append_warnings(&self, issues: &mut Vec<DocumentIssue>) {
        if self.skipped_facts > 0 {
            issues.push(issue("validation-budget-facts", IssueSeverity::Warning, IssueCategory::Filesystem, 1, 1, format!("Validation skipped {} link/image/reference facts because this render exceeded the 512 fact budget.", self.skipped_facts)));
        }
        if self.skipped_cross_file_targets > 0 {
            issues.push(issue("validation-budget-targets", IssueSeverity::Warning, IssueCategory::Filesystem, 1, 1, format!("Validation skipped {} cross-file Markdown targets because this render exceeded the 64 target budget.", self.skipped_cross_file_targets)));
        }
        if self.skipped_oversized_files > 0 || self.skipped_total_bytes > 0 {
            issues.push(issue("validation-budget-bytes", IssueSeverity::Warning, IssueCategory::Filesystem, 1, 1, format!("Validation skipped {} oversized files and {} files beyond the 8 MiB total read budget.", self.skipped_oversized_files, self.skipped_total_bytes)));
        }
    }
}

pub struct ValidationEngine {
    limits: ValidationLimits,
    cache: CrossFileAnchorCache,
}

impl ValidationEngine {
    pub fn new(limits: ValidationLimits) -> Self {
        Self { limits, cache: CrossFileAnchorCache::default() }
    }

    pub async fn validate(&mut self, request: ValidationRequest) -> Result<DocumentDiagnostics, String> {
        if !(request.is_current)(request.doc_id, request.version) {
            return Ok(request.initial_diagnostics);
        }
        let facts = pmd_core::emit::render_string(&request.markdown).facts;
        let resources = request.initial_diagnostics.resources;
        let mut issues = request.initial_diagnostics.issues;
        issues.extend(validate_links_images_and_refs(&self.limits, &mut self.cache, request.doc_id, &request.doc_path, &facts).await?);
        if !(request.is_current)(request.doc_id, request.version) {
            return Ok(DocumentDiagnostics::empty_initial(request.doc_id, request.version));
        }
        let mut diagnostics = DocumentDiagnostics::enriched(request.doc_id, request.version, issues, resources);
        diagnostics.link_summary = summarize_links(&diagnostics.issues);
        Ok(diagnostics)
    }

    pub fn invalidate_for_save(&mut self, path: &Path) { self.cache.invalidate_path(path); }
    pub fn invalidate_for_watcher_change(&mut self, path: &Path) { self.cache.invalidate_path(path); }
    pub fn invalidate_for_grant_change(&mut self, doc_id: u64) { self.cache.invalidate_doc(doc_id); }
    pub fn invalidate_for_reload(&mut self, doc_id: u64) { self.cache.invalidate_doc(doc_id); }
}

pub async fn validate_for_test(
    doc_id: u64,
    version: u64,
    doc_path: &Path,
    markdown: &str,
) -> Result<DocumentDiagnostics, String> {
    let mut engine = ValidationEngine::new(ValidationLimits::default());
    engine.validate(ValidationRequest {
        doc_id,
        version,
        doc_path: doc_path.to_path_buf(),
        markdown: markdown.to_string(),
        initial_diagnostics: DocumentDiagnostics::empty_initial(doc_id, version),
        is_current: Arc::new(|_, _| true),
    }).await
}

async fn validate_links_images_and_refs(
    limits: &ValidationLimits,
    cache: &mut CrossFileAnchorCache,
    doc_id: u64,
    doc_path: &Path,
    facts: &pmd_core::facts::CoreDocumentFacts,
) -> Result<Vec<DocumentIssue>, String> {
    let mut issues = Vec::new();
    let doc_dir = doc_path.parent().unwrap_or_else(|| Path::new("."));
    let fs_gate = tokio::sync::Semaphore::new(limits.max_concurrent_checks.max(1));
    let mut budget = ValidationBudget::new(limits, facts);
    for link in &facts.links {
        if !budget.consume_fact() {
            continue;
        }
        let Some(target) = &link.target else {
            if link.reference_label.is_some() && link.definition_id.is_none() {
                issues.push(issue("unresolved-reference", IssueSeverity::Error, IssueCategory::Link, link.line_start, link.line_end, format!("Reference link is not defined: {}", link.reference_label.as_deref().unwrap_or(""))));
            }
            continue;
        };
        if let Some(fragment) = target.strip_prefix('#') {
            if !facts.anchors.iter().any(|anchor| anchor.slug == fragment) {
                issues.push(issue("link", IssueSeverity::Error, IssueCategory::Anchor, link.line_start, link.line_end, format!("Missing anchor #{fragment}")));
            }
        } else if is_markdown_target(target) {
            let (relative_path, fragment) = split_markdown_fragment(target);
            let target_path = doc_dir.join(relative_path);
            if !local_path_exists(&target_path, &fs_gate).await? {
                issues.push(issue("missing-md", IssueSeverity::Error, IssueCategory::Link, link.line_start, link.line_end, format!("Linked Markdown file not found: {target}")));
                continue;
            }
            cache.observe_doc_path(doc_id, target_path.clone());
            if let Some(fragment) = fragment {
                let Some(anchors) = cache.get_or_read(&target_path, &mut budget, &fs_gate).await? else { continue; };
                if !anchors.iter().any(|anchor| anchor == fragment) {
                    issues.push(issue("missing-cross-anchor", IssueSeverity::Error, IssueCategory::Anchor, link.line_start, link.line_end, format!("Linked Markdown anchor not found: #{fragment}")));
                }
            }
        } else if is_local_filesystem_target(target) {
            let target_path = doc_dir.join(target);
            if !local_path_exists(&target_path, &fs_gate).await? {
                issues.push(issue("missing-local-file", IssueSeverity::Error, IssueCategory::Link, link.line_start, link.line_end, format!("Linked local file not found: {target}")));
            }
        }
    }
    for image in &facts.images {
        if !budget.consume_fact() {
            continue;
        }
        let Some(target) = &image.target else {
            issues.push(issue(
                "missing-image-reference",
                IssueSeverity::Error,
                IssueCategory::Image,
                image.line_start,
                image.line_end,
                "Image reference unresolved: define the reference or use an inline path.".to_string(),
            ));
            continue;
        };
        if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("file://") {
            continue;
        }
        let image_path = doc_dir.join(target);
        if !local_path_exists(&image_path, &fs_gate).await? {
            issues.push(issue("missing-image", IssueSeverity::Error, IssueCategory::Image, image.line_start, image.line_end, format!("Image file not found: {target}")));
        }
    }
    budget.append_warnings(&mut issues);
    Ok(issues)
}

async fn local_path_exists(path: &Path, fs_gate: &tokio::sync::Semaphore) -> Result<bool, String> {
    let _permit = fs_gate.acquire().await.map_err(|err| err.to_string())?;
    Ok(tokio::fs::metadata(path).await.is_ok())
}

fn split_markdown_fragment(target: &str) -> (&str, Option<&str>) {
    target.split_once('#').map_or((target, None), |(path, fragment)| (path, Some(fragment)))
}

fn is_markdown_target(target: &str) -> bool {
    let (path, _) = split_markdown_fragment(target);
    let path = path.split_once('?').map_or(path, |(without_query, _)| without_query);
    path.ends_with(".md") || path.ends_with(".markdown")
}

fn is_local_filesystem_target(target: &str) -> bool {
    !target.starts_with("http://")
        && !target.starts_with("https://")
        && !target.starts_with("mailto:")
        && !target.starts_with("file://")
        && !target.starts_with("//")
        && !target.contains(':')
}

fn issue(prefix: &str, severity: IssueSeverity, category: IssueCategory, line_start: u32, line_end: u32, message: String) -> DocumentIssue {
    DocumentIssue {
        id: format!("{prefix}:{line_start}:{line_end}"),
        severity,
        category,
        line_start: Some(line_start),
        line_end: Some(line_end),
        block_id: None,
        message,
        detail: None,
        primary_action: None,
    }
}

fn summarize_links(issues: &[DocumentIssue]) -> LinkValidationSummary {
    LinkValidationSummary {
        checked: issues.iter().filter(|issue| matches!(issue.category, IssueCategory::Link | IssueCategory::Anchor)).count() as u32,
        errors: issues.iter().filter(|issue| issue.severity == IssueSeverity::Error).count() as u32,
        warnings: issues.iter().filter(|issue| issue.severity == IssueSeverity::Warning).count() as u32,
        unchecked_external: 0,
        pending_async: 0,
    }
}
```

Validation limits:

- at most 512 link/image/reference facts per render.
- at most 64 distinct cross-file Markdown targets per render.
- at most 1 MiB read from any single target file.
- at most 8 MiB total per render.
- at most four filesystem checks concurrently.
- cache cross-file anchor facts by canonical path, mtime, and byte length.

Validation produces diagnostics for local file links and local image paths, but it never authorizes load-bearing resources. Image authorization still comes only from the synchronous resource-policy pipeline. Async validation may report `missing_file` or `unchecked` for images and links; it must not convert a blocked image into an allowed image.

- [ ] **Step 7.3: Implement invalidation triggers**

Invalidate cached cross-file facts and pending diagnostics when:

- the active document is saved.
- the file watcher reports a changed linked Markdown target.
- an asset folder grant or revocation changes allowed roots.
- the user runs explicit reload.

Expose invalidation on the managed worker in `crates/pmd-app/src/preview/render_pipeline.rs` so production commands and the watcher can reach the same cache:

```rust
impl ValidationWorker {
    pub async fn invalidate_for_save(&self, path: &std::path::Path) {
        self.engine.lock().await.invalidate_for_save(path);
    }

    pub fn invalidate_for_watcher_change(&self, path: std::path::PathBuf) {
        let engine = self.engine.clone();
        tauri::async_runtime::spawn(async move {
            engine.lock().await.invalidate_for_watcher_change(&path);
        });
    }

    pub async fn invalidate_for_grant_change(&self, doc_id: u64) {
        self.engine.lock().await.invalidate_for_grant_change(doc_id);
    }

    pub async fn invalidate_for_reload(&self, doc_id: u64) {
        self.engine.lock().await.invalidate_for_reload(doc_id);
    }
}
```

Modify `crates/pmd-app/src/cmd/doc.rs::save_doc` to accept `validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>` and invalidate after a successful write before returning:

```rust
validation.invalidate_for_save(&canon).await;
Ok(new_state)
```

Modify `crates/pmd-app/src/cmd/doc.rs::pull_from_disk` from `pub fn` to `pub async fn`, accept the same validation state, and invalidate the active document after `synced_from_disk` succeeds:

```rust
validation.invalidate_for_reload(doc_id.0).await;
Ok(PullResult { contents: disk, state: new_state })
```

Modify `crates/pmd-app/src/watcher.rs` after the watcher computes `disk_event` and before emitting `doc_state_changed`:

```rust
if let Some(validation) = worker_app.try_state::<crate::preview::render_pipeline::ValidationWorker>() {
    validation.invalidate_for_watcher_change(worker_path.clone());
}
```

Block 11's grant commands must also accept `validation: tauri::State<'_, ValidationWorker>` and call the same worker after successful grant or revoke:

```rust
validation.invalidate_for_grant_change(doc_id).await;
```

Expected test behavior: after each invalidation, the next validation reads fresh file metadata/content and emits diagnostics for the current `(doc_id, version)` only.

- [ ] **Step 7.4: Emit full enriched diagnostics replacements**

Async validation sends a full `DocumentDiagnostics { phase: enriched }` replacement that carries forward still-valid initial resource issues and adds validation issues. The UI receives it only when `doc_id` and `version` still match.

`preview/render_pipeline.rs` owns the freshness token passed into `ValidationRequest`. It is cloneable so `cmd/render.rs` can spawn validation without moving the managed Tauri state:

```rust
use std::{collections::BTreeMap, path::PathBuf, sync::{Arc, Mutex}};

use crate::preview::contracts::DocumentDiagnostics;
use crate::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

#[derive(Clone)]
pub struct ValidationWorker {
    latest_versions: Arc<Mutex<BTreeMap<u64, u64>>>,
    engine: Arc<tokio::sync::Mutex<ValidationEngine>>,
}

impl ValidationWorker {
    pub fn new() -> Self {
        Self {
            latest_versions: Arc::new(Mutex::new(BTreeMap::new())),
            engine: Arc::new(tokio::sync::Mutex::new(ValidationEngine::new(ValidationLimits::default()))),
        }
    }

    pub fn observe_render(&self, doc_id: u64, version: u64) {
        let mut latest = self.latest_versions.lock().unwrap();
        if latest.get(&doc_id).copied().unwrap_or(0) < version {
            latest.insert(doc_id, version);
        }
    }

    pub async fn validate_current(&self, doc_id: u64, version: u64, doc_path: PathBuf, markdown: String, initial_diagnostics: DocumentDiagnostics) -> Result<Option<DocumentDiagnostics>, String> {
        let latest_versions = self.latest_versions.clone();
        let is_current = Arc::new(move |candidate_doc: u64, candidate_version: u64| {
            latest_versions.lock().unwrap().get(&candidate_doc).copied() == Some(candidate_version)
        });
        if !is_current(doc_id, version) {
            return Ok(None);
        }
        let request = ValidationRequest { doc_id, version, doc_path, markdown, initial_diagnostics, is_current: is_current.clone() };
        let diagnostics = self.engine.lock().await.validate(request).await?;
        if !is_current(diagnostics.doc_id, diagnostics.version) {
            return Ok(None);
        }
        Ok(Some(diagnostics))
    }
}
```

Register the worker and emit enriched diagnostics from the real render command path. Modify `crates/pmd-app/src/main.rs`:

```rust
.manage(pmd_app_lib::preview::render_pipeline::ValidationWorker::new())
```

Export the module from `crates/pmd-app/src/preview/mod.rs`:

```rust
pub mod validation;
```

Modify `crates/pmd-app/src/cmd/render.rs` so `render_cmd` receives the `Window` and managed worker. This extends the Block 6 render command; keep `LinkActivationStore` registration intact when adding validation:

```rust
#[tauri::command]
pub async fn render_cmd(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    links: tauri::State<'_, crate::preview::link_activation::LinkActivationStore>,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: u64,
    version: u64,
    markdown: String,
) -> Result<RenderResult, String> {
    let snapshot = state.docs.preview_snapshot(doc_id)?;
    let result = crate::preview::render_pipeline::render_document(RenderRequest {
        doc_id,
        version,
        doc_path: snapshot.path.as_deref(),
        allowed_roots: snapshot.allowed_roots,
        markdown: markdown.clone(),
    })?;
    links.record_render_links(result.doc_id, result.version, snapshot.path.as_deref(), &result.facts);
    validation.observe_render(doc_id, version);

    if let Some(doc_path) = snapshot.path {
        let worker = validation.inner().clone();
        let window_for_emit = window.clone();
        let initial_diagnostics = result.diagnostics.clone();
        tauri::async_runtime::spawn(async move {
            match worker.validate_current(doc_id, version, doc_path, markdown, initial_diagnostics).await {
                Ok(Some(diagnostics)) => {
                    let _ = window_for_emit.emit("pmd://diagnostics-enriched", diagnostics);
                }
                Ok(None) => {}
                Err(error) => eprintln!("[preview-md] async validation failed for doc {doc_id} v{version}: {error}"),
            }
        });
    }

    Ok(result)
}
```

Modify `ui/src/main.ts` to listen for the full enriched replacement and drop stale versions against the current active render. Keep this Block 7 listener self-contained so Blocks 7 and 8 still compile before `ui/src/document_contracts.ts` exists; Block 9 later moves the same newest-wins check into `document_facts_store.ts` and replaces the local type with the shared contract import:

```ts
import { listen } from "@tauri-apps/api/event";

type AsyncDocumentDiagnostics = {
  doc_id: number;
  version: number;
  phase: "initial" | "enriched";
  issues: unknown[];
  resources: unknown;
  link_summary: unknown;
};

const latestEnrichedDiagnostics = new Map<number, AsyncDocumentDiagnostics>();
let unlistenDiagnostics: (() => void) | null = null;

function renderDiagnostics(diagnostics: AsyncDocumentDiagnostics): void {
  latestEnrichedDiagnostics.set(diagnostics.doc_id, diagnostics);
}

listen<AsyncDocumentDiagnostics>("pmd://diagnostics-enriched", (event) => {
  const active = store.activeDoc();
  const appliedVersion = Number(previewContent.dataset.versionApplied || "0");
  if (!active || active.docId !== event.payload.doc_id || appliedVersion !== event.payload.version) return;
  renderDiagnostics(event.payload);
}).then((unlisten) => {
  unlistenDiagnostics = unlisten;
}).catch((error) => {
  console.error("Failed to listen for enriched diagnostics", error);
});

window.addEventListener("beforeunload", () => {
  unlistenDiagnostics?.();
});
```

- [ ] **Step 7.5: Verify**

```bash
cargo test -p pmd-app --test async_validation -j 2
cargo test -p pmd-app --test resource_policy -j 2
just test-ipc
```

Expected: all commands pass.

Security PASS for asset-scope release and blocked resource recovery remains provisional until Block 12 runs the WebDriver navigation/fetch sentinel through `just e2e`.

- [ ] **Step 7.6: Review, commit, and merge**

```bash
ccc --yolo @cx-reviewer "Review async validation for budget enforcement, stale result handling, and filesystem authority. Return PASS or blockers."
```

If the reviewer returns anything other than `PASS`, fix the findings and rerun Step 7.6. After `PASS`, run:

```bash
git status --short
git add Cargo.toml crates/pmd-app/Cargo.toml crates/pmd-app/src/preview/validation.rs crates/pmd-app/src/preview/mod.rs crates/pmd-app/src/preview/contracts.rs crates/pmd-app/src/preview/render_pipeline.rs crates/pmd-app/src/cmd/render.rs crates/pmd-app/src/cmd/doc.rs crates/pmd-app/src/watcher.rs crates/pmd-app/src/main.rs crates/pmd-app/tests/async_validation.rs ui/src/main.ts
git commit -m "feat(app): validate local markdown links asynchronously"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-validation
```

## Block 8: Action Registry and Keybinding Persistence

**Worktree:** `.worktrees/dit-actions-keybindings`

**Owner:** action/keybinding worker.

**Files:**

- Create: `ui/src/actions.ts`
- Create: `ui/src/keybindings.ts`
- Create: `ui/src/command_overlay.ts`
- Create: `ui/src/shortcut_editor.ts`
- Create: `ui/src/actions.test.ts`
- Create: `ui/src/keybindings.test.ts`
- Create: `ui/e2e/commands-keybindings.spec.cjs`
- Integration-owner modify: `ui/e2e/helpers.cjs`
- Integration-owner modify: `ui/src/main.ts`
- Modify: `ui/src/hotkeys.ts`
- Modify: `ui/src/chrome.ts`
- Modify: `ui/src/settings_menu.ts`
- Modify: `ui/src/file_browser.ts`
- Modify: `ui/src/tabbar.ts`
- Modify: `ui/src/editor.ts`
- Modify: `ui/src/codemirror-entry.ts`
- Integration-owner modify: `ui/styles/components.css`
- Modify: `ui/tsconfig.json`
- Modify: `crates/pmd-app/src/state/settings.rs`
- Modify: `crates/pmd-app/src/cmd/settings.rs`
- Integration-owner modify: `crates/pmd-app/src/main.rs`
- Test: `crates/pmd-app/tests/cmd_settings.rs`

- [ ] **Step 8.1: Write pure registry tests**

`ui/src/actions.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACTION_SHORTCUTS,
  NO_DEFAULT_ACTION_IDS,
  createActionRegistry,
  defaultActionSpecs,
  searchActions,
} from "./actions.ts";
import { findDefaultShortcutConflicts } from "./keybindings.ts";

test("default action inventory includes every approved shortcut exactly", () => {
  const byId = new Map(defaultActionSpecs.map((action) => [action.id, action]));
  for (const [id, shortcuts] of Object.entries(DEFAULT_ACTION_SHORTCUTS)) {
    assert.deepEqual(byId.get(id)?.defaultShortcuts, shortcuts, id);
  }
  assert.equal(Object.keys(DEFAULT_ACTION_SHORTCUTS).length, 21);
});

test("default shortcuts are conflict free", () => {
  assert.deepEqual(findDefaultShortcutConflicts(defaultActionSpecs), []);
});

test("every registered action has a runnable handler", async () => {
  const ran: string[] = [];
  const registry = createActionRegistry(defaultActionSpecs, {
    run: (id) => ran.push(id),
    isEnabled: () => true,
    isVisible: () => true,
  });

  for (const action of defaultActionSpecs) {
    await registry.runAction(action.id);
  }

  assert.deepEqual(ran.sort(), defaultActionSpecs.map((action) => action.id).sort());
});

test("all no-default actions are registered searchable and unbound", () => {
  const byId = new Map(defaultActionSpecs.map((action) => [action.id, action]));
  for (const id of NO_DEFAULT_ACTION_IDS) {
    const action = byId.get(id);
    assert.ok(action, id);
    assert.deepEqual(action.defaultShortcuts, []);
    assert.equal(searchActions(defaultActionSpecs, action.label)[0].id, id);
    assert.equal(typeof action.run, "function");
  }
  assert.equal(NO_DEFAULT_ACTION_IDS.length, 17);
});
```

- [ ] **Step 8.2: Write keybinding tests**

Create tests in `ui/src/keybindings.test.ts` for:

- normalize `Ctrl+Shift+O`, `Shift+Ctrl+O`, and `ctrl+shift+o` to the same canonical string.
- user overrides can add multiple shortcuts to one action.
- conflict warning blocks saving when another enabled action owns the shortcut.
- no-default actions are searchable but omitted from conflict checks until bound.
- restoring all defaults clears every saved override before the settings command persists the draft.

Include:

```ts
test("shortcut normalization is order and case stable", () => {
  assert.equal(normalizeShortcut("Ctrl+Shift+O"), "Ctrl+Shift+O");
  assert.equal(normalizeShortcut("Shift+Ctrl+O"), "Ctrl+Shift+O");
  assert.equal(normalizeShortcut("ctrl+shift+o"), "Ctrl+Shift+O");
});

test("user override conflicts block saving", () => {
  const conflicts = findUserShortcutConflicts(defaultActionSpecs, {
    "navigate.outline": ["Ctrl+P"],
  }, new Set(["navigate.outline", "navigate.commandOverlay"]));

  assert.deepEqual(conflicts, [{
    shortcut: "Ctrl+P",
    actionIds: ["navigate.commandOverlay", "navigate.outline"],
  }]);
});

test("no default actions are searchable but conflict free until bound", () => {
  const reveal = defaultActionSpecs.find((action) => action.id === "file.revealInFolder")!;
  assert.deepEqual(reveal.defaultShortcuts, []);
  assert.equal(searchActions(defaultActionSpecs, "reveal")[0].id, "file.revealInFolder");
  assert.deepEqual(findDefaultShortcutConflicts([reveal]), []);
});

test("restore all defaults clears every shortcut override", () => {
  assert.deepEqual(restoreAllShortcutDefaults({
    "navigate.commandOverlay": ["Ctrl+K"],
    "navigate.outline": ["Ctrl+Alt+O"],
  }), {});
});
```

- [ ] **Step 8.3: Write settings persistence tests**

Extend `crates/pmd-app/tests/cmd_settings.rs` with:

```rust
#[test]
fn shortcut_overrides_round_trip_without_clearing_theme_settings() {
    let settings = pmd_app_lib::cmd::settings::set_shortcut_overrides_for_test(vec![
        ("navigate.commandOverlay".to_string(), vec!["Ctrl+K".to_string()]),
    ])
    .expect("settings");

    assert_eq!(settings.shortcut_overrides["navigate.commandOverlay"], vec!["Ctrl+K"]);
}
```

The implementation this test drives must add:

```rust
// crates/pmd-app/src/state/settings.rs
use std::collections::BTreeMap;

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
    #[serde(default)]
    pub autosave_mode: AutosaveMode,
    #[serde(default)]
    pub autoreload_mode: AutoreloadMode,
    #[serde(default)]
    pub merge_strategy: MergeStrategy,
    #[serde(default)]
    pub browser_base_dir: Option<PathBuf>,
    #[serde(default)]
    pub gist_enabled: bool,
    #[serde(default)]
    pub diff_mode: DiffMode,
    #[serde(default)]
    pub dont_ask_default_handler: bool,
    #[serde(default)]
    pub mono_font: Option<String>,
    #[serde(default)]
    pub shortcut_overrides: BTreeMap<String, Vec<String>>,
}
```

```rust
// crates/pmd-app/src/cmd/settings.rs
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
    pub autosave_mode: AutosaveMode,
    pub autoreload_mode: AutoreloadMode,
    pub merge_strategy: MergeStrategy,
    pub browser_base_dir: Option<PathBuf>,
    pub gist_enabled: bool,
    pub diff_mode: DiffMode,
    pub dont_ask_default_handler: bool,
    pub mono_font: Option<String>,
    pub shortcut_overrides: BTreeMap<String, Vec<String>>,
}

#[tauri::command]
pub fn set_shortcut_overrides(overrides: BTreeMap<String, Vec<String>>) -> Result<Settings, String> {
    crate::state::settings::rmw(|s| crate::state::settings::Settings {
        shortcut_overrides: overrides,
        ..s
    })
    .map_err(|e| e.to_string())?;
    get_settings()
}

pub fn set_shortcut_overrides_for_test(overrides: Vec<(String, Vec<String>)>) -> Result<Settings, String> {
    set_shortcut_overrides(overrides.into_iter().collect())
}
```

Register `set_shortcut_overrides` in `crates/pmd-app/src/main.rs` beside the existing settings commands. The `From<state::settings::Settings> for cmd::settings::Settings` conversion must copy `shortcut_overrides` without dropping theme, lifecycle, browser, Gist, diff, default-handler, or font settings.

- [ ] **Step 8.4: Implement pure registry and keybinding modules**

`ui/src/actions.ts` owns metadata, handler registration, and dispatch. Its public contract is:

```ts
export type ActionCategory =
  | "File"
  | "Document"
  | "Edit"
  | "View"
  | "Navigate"
  | "Theme"
  | "Diagnostics"
  | "Trust"
  | "Assets"
  | "Share"
  | "Settings";

export interface ActionContext {
  run(id: ActionId): void | Promise<void>;
  isEnabled(id: ActionId): boolean;
  isVisible(id: ActionId): boolean;
}

export type ActionId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.closeTab"
  | "app.quit"
  | "edit.find"
  | "edit.findNext"
  | "edit.findPrevious"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.cycleMode"
  | "view.toggleWordWrap"
  | "navigate.commandOverlay"
  | "navigate.outline"
  | "diagnostics.togglePanel"
  | "theme.pick"
  | "settings.open"
  | "help.shortcuts"
  | "menu.focus"
  | "file.revealInFolder"
  | "file.openDefaultApp"
  | "file.copyPath"
  | "file.copyFilename"
  | "file.copyFileUrl"
  | "file.clearRecent"
  | "document.reloadFromDisk"
  | "document.mergeDiskChanges"
  | "view.setDiffMode"
  | "navigate.fileBrowser"
  | "share.openGist"
  | "share.copyGistMarkdown"
  | "settings.pickBaseFolder"
  | "settings.selectMonoFont"
  | "settings.setDefaultHandler"
  | "asset.grantFolder"
  | "asset.revokeGrant";

export interface ActionSpec {
  id: ActionId;
  label: string;
  category: ActionCategory;
  description: string;
  defaultShortcuts: string[];
  enabledWhen: string;
  visibleWhen: string;
  run: (context: ActionContext) => void | Promise<void>;
}

export const DEFAULT_ACTION_SHORTCUTS: Record<string, string[]> = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["Shift+Ctrl+S"],
  "file.closeTab": ["Ctrl+W"],
  "app.quit": ["Ctrl+Q"],
  "edit.find": ["Ctrl+F"],
  "edit.findNext": ["Ctrl+G"],
  "edit.findPrevious": ["Shift+Ctrl+G"],
  "view.zoomIn": ["Ctrl++"],
  "view.zoomOut": ["Ctrl+-"],
  "view.zoomReset": ["Ctrl+0"],
  "view.cycleMode": ["Ctrl+\\"],
  "view.toggleWordWrap": ["Alt+Z"],
  "navigate.commandOverlay": ["Ctrl+P"],
  "navigate.outline": ["Ctrl+Shift+O"],
  "diagnostics.togglePanel": ["Ctrl+Shift+M"],
  "theme.pick": ["Ctrl+T"],
  "settings.open": ["Ctrl+,"],
  "help.shortcuts": ["Ctrl+?"],
  "menu.focus": ["F10"],
};

export const NO_DEFAULT_ACTION_IDS: ActionId[] = [
  "file.revealInFolder",
  "file.openDefaultApp",
  "file.copyPath",
  "file.copyFilename",
  "file.copyFileUrl",
  "file.clearRecent",
  "document.reloadFromDisk",
  "document.mergeDiskChanges",
  "view.setDiffMode",
  "navigate.fileBrowser",
  "share.openGist",
  "share.copyGistMarkdown",
  "settings.pickBaseFolder",
  "settings.selectMonoFont",
  "settings.setDefaultHandler",
  "asset.grantFolder",
  "asset.revokeGrant",
];

function spec(id: ActionId, label: string, category: ActionCategory, description: string, defaultShortcuts = DEFAULT_ACTION_SHORTCUTS[id] ?? []): ActionSpec {
  return {
    id,
    label,
    category,
    description,
    defaultShortcuts,
    enabledWhen: "default",
    visibleWhen: "default",
    run: (context) => context.run(id),
  };
}

export const defaultActionSpecs: ActionSpec[] = [
  spec("file.new", "New file", "File", "Create a new Markdown file"),
  spec("file.open", "Open file", "File", "Open a Markdown file"),
  spec("file.save", "Save", "File", "Save the active file"),
  spec("file.saveAs", "Save as", "File", "Save the active file to a new path"),
  spec("file.closeTab", "Close tab", "File", "Close the active tab"),
  spec("app.quit", "Quit", "File", "Quit preview-md"),
  spec("edit.find", "Find", "Edit", "Find text in the editor"),
  spec("edit.findNext", "Find next", "Edit", "Move to the next search result"),
  spec("edit.findPrevious", "Find previous", "Edit", "Move to the previous search result"),
  spec("view.zoomIn", "Zoom in", "View", "Increase preview zoom"),
  spec("view.zoomOut", "Zoom out", "View", "Decrease preview zoom"),
  spec("view.zoomReset", "Reset zoom", "View", "Reset preview zoom"),
  spec("view.cycleMode", "Cycle mode", "View", "Cycle source split preview modes"),
  spec("view.toggleWordWrap", "Toggle word wrap", "View", "Toggle editor word wrapping"),
  spec("navigate.commandOverlay", "Command overlay", "Navigate", "Open the command overlay"),
  spec("navigate.outline", "Show outline", "Navigate", "Show document outline"),
  spec("diagnostics.togglePanel", "Toggle diagnostics", "Diagnostics", "Show or hide diagnostics"),
  spec("theme.pick", "Pick theme", "Theme", "Open the theme picker"),
  spec("settings.open", "Settings", "Settings", "Open settings"),
  spec("help.shortcuts", "Keyboard shortcuts", "Settings", "Show keyboard shortcuts"),
  spec("menu.focus", "Focus menu", "Navigate", "Focus the application menu"),
  spec("file.revealInFolder", "Reveal in folder", "File", "Reveal the active file in the file manager"),
  spec("file.openDefaultApp", "Open in default app", "File", "Open the active file in the default application"),
  spec("file.copyPath", "Copy path", "File", "Copy the active file path"),
  spec("file.copyFilename", "Copy filename", "File", "Copy the active file name"),
  spec("file.copyFileUrl", "Copy file URL", "File", "Copy the active file URL"),
  spec("file.clearRecent", "Clear recent files", "File", "Clear the recent file list"),
  spec("document.reloadFromDisk", "Reload from disk", "Document", "Reload the active document"),
  spec("document.mergeDiskChanges", "Merge disk changes", "Document", "Merge disk changes into the active document"),
  spec("view.setDiffMode", "Set diff mode", "View", "Select the diff mode"),
  spec("navigate.fileBrowser", "File browser", "Navigate", "Open the file browser tab"),
  spec("share.openGist", "Open Gist", "Share", "Open the document Gist"),
  spec("share.copyGistMarkdown", "Copy Gist Markdown", "Share", "Copy Gist Markdown"),
  spec("settings.pickBaseFolder", "Pick file-browser folder", "Settings", "Pick the file-browser base folder"),
  spec("settings.selectMonoFont", "Select editor font", "Settings", "Select the editor font"),
  spec("settings.setDefaultHandler", "Set as Markdown default", "Settings", "Set preview-md as the Markdown default handler"),
  spec("asset.grantFolder", "Grant folder", "Assets", "Grant a folder for blocked local assets", []),
  spec("asset.revokeGrant", "Revoke grant", "Assets", "Revoke a local asset folder grant", []),
];

export interface ActionRegistry {
  actions: ActionSpec[];
  runAction(id: ActionId): Promise<boolean>;
}

export function createActionRegistry(actions: ActionSpec[], context: ActionContext): ActionRegistry {
  const byId = new Map(actions.map((action) => [action.id, action]));
  return {
    actions,
    runAction: async (id: ActionId) => {
      const action = byId.get(id);
      if (!action || !context.isVisible(id) || !context.isEnabled(id)) return false;
      await action.run(context);
      return true;
    },
  };
}

export function searchActions(actions: ActionSpec[], query: string): ActionSpec[] {
  const needle = query.trim().toLowerCase();
  return actions.filter((action) =>
    [action.id, action.label, action.category, action.description].some((value) =>
      value.toLowerCase().includes(needle)
    )
  );
}
```

`ui/src/keybindings.ts` owns:

- `normalizeShortcut(eventOrString)`.
- `findDefaultShortcutConflicts(actions)`.
- `mergeShortcutOverrides(defaults, overrides)`.
- `findUserShortcutConflicts(actions, overrides, enabledActionIds)`.
- `restoreAllShortcutDefaults(overrides)` returns an empty override map and is used by the global Restore All button.

Include the concrete restore helper in `ui/src/keybindings.ts`:

```ts
export type ShortcutOverrides = Record<string, string[]>;

export function restoreAllShortcutDefaults(_overrides: ShortcutOverrides): ShortcutOverrides {
  return {};
}
```

- [ ] **Step 8.5: Move global listeners into action dispatch**

Remove direct global shortcut handling from `ui/src/main.ts` and `ui/src/hotkeys.ts`. Register these existing shortcuts through the action system:

- `Ctrl+N`
- `Ctrl+O`
- `Ctrl+S`
- `Shift+Ctrl+S`
- `Ctrl+W`
- `Ctrl+Q`
- `Ctrl+F`
- `Ctrl+G`
- `Shift+Ctrl+G`
- `Ctrl++`
- `Ctrl+-`
- `Ctrl+0`
- `Ctrl+\`
- `Alt+Z`
- `Ctrl+P`
- `Ctrl+Shift+O`
- `Ctrl+Shift+M`
- `Ctrl+T`
- `Ctrl+,`
- `Ctrl+?`
- `F10`
- `Ctrl+/` only if it is explicitly modeled as the same action as `Ctrl+?`; do not leave it as an invisible legacy listener.

Every shortcut in `DEFAULT_ACTION_SHORTCUTS` must route through the action registry, including actions whose concrete UI lands in later blocks. For later-block actions such as `navigate.outline` and `diagnostics.togglePanel`, Block 8 registers the action id and shortcut, then the later block replaces the temporary disabled/no-op handler with the real handler in the same action registry. No default shortcut may remain as an unregistered document-level listener.

- [ ] **Step 8.6: Build command overlay and shortcut editor**

Create `ui/src/command_overlay.ts`:

```ts
import type { ActionId, ActionSpec, ActionRegistry } from "./actions.ts";
import { searchActions } from "./actions.ts";

export interface CommandOverlayController {
  open(): void;
  close(): void;
  isOpen(): boolean;
  element: HTMLElement;
}

export function createCommandOverlay(
  actions: ActionSpec[],
  registry: ActionRegistry,
  options: { isVisible: (id: ActionId) => boolean }
): CommandOverlayController {
  let previouslyFocused: HTMLElement | null = null;
  const dialog = document.createElement("div");
  dialog.className = "pmd-command-overlay";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Command overlay");
  dialog.hidden = true;

  const input = document.createElement("input");
  input.className = "pmd-command-overlay-search";
  input.type = "search";
  input.setAttribute("aria-label", "Search commands");
  const list = document.createElement("div");
  list.className = "pmd-command-overlay-list";
  list.setAttribute("role", "listbox");
  dialog.append(input, list);

  function render() {
    const visible = searchActions(actions, input.value).filter((action) => options.isVisible(action.id));
    list.replaceChildren(
      ...visible.map((action) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "pmd-command-row";
        row.setAttribute("role", "option");
        row.dataset.actionId = action.id;
        row.textContent = `${action.label} ${action.category}`;
        row.addEventListener("click", async () => {
          await registry.runAction(action.id);
          controller.close();
        });
        return row;
      })
    );
  }

  input.addEventListener("input", render);
  dialog.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
    }
    if (event.key === "Enter") {
      const first = list.querySelector<HTMLButtonElement>(".pmd-command-row");
      if (first?.dataset.actionId) {
        event.preventDefault();
        await registry.runAction(first.dataset.actionId as ActionId);
        controller.close();
      }
    }
  });

  const controller: CommandOverlayController = {
    element: dialog,
    isOpen: () => !dialog.hidden,
    open: () => {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.hidden = false;
      input.value = "";
      render();
      input.focus();
    },
    close: () => {
      dialog.hidden = true;
      previouslyFocused?.focus();
    },
  };
  return controller;
}
```

Create `ui/src/shortcut_editor.ts`:

```ts
import type { ActionId, ActionSpec } from "./actions.ts";
import { findUserShortcutConflicts, normalizeShortcut, restoreAllShortcutDefaults } from "./keybindings.ts";

export type ShortcutOverrides = Record<string, string[]>;

export interface ShortcutEditorController {
  open(): void;
  close(): void;
  element: HTMLElement;
}

export function createShortcutEditor(options: {
  actions: ActionSpec[];
  loadOverrides: () => ShortcutOverrides;
  saveOverrides: (overrides: ShortcutOverrides) => Promise<void>;
  enabledActionIds: () => Set<ActionId>;
}): ShortcutEditorController {
  let previouslyFocused: HTMLElement | null = null;
  let draft: ShortcutOverrides = {};
  const dialog = document.createElement("div");
  dialog.className = "pmd-shortcut-editor";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Keyboard shortcuts");
  dialog.hidden = true;
  const list = document.createElement("div");
  list.className = "pmd-shortcut-editor-list";
  const error = document.createElement("p");
  error.className = "pmd-shortcut-editor-error";
  error.setAttribute("role", "alert");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  const restoreAll = document.createElement("button");
  restoreAll.type = "button";
  restoreAll.textContent = "Restore All";
  restoreAll.setAttribute("aria-label", "Restore all default shortcuts");
  dialog.append(list, error, restoreAll, save);

  function render() {
    list.replaceChildren(...options.actions.map((action) => rowFor(action)));
    const conflicts = findUserShortcutConflicts(options.actions, draft, options.enabledActionIds());
    error.textContent = conflicts.length ? `Shortcut conflict: ${conflicts[0].shortcut}` : "";
    save.disabled = conflicts.length > 0;
  }

  function rowFor(action: ActionSpec): HTMLElement {
    const row = document.createElement("section");
    row.className = "pmd-shortcut-row";
    row.dataset.actionId = action.id;
    const label = document.createElement("h3");
    label.textContent = action.label;
    const input = document.createElement("input");
    input.value = (draft[action.id] ?? action.defaultShortcuts).join(", ");
    input.setAttribute("aria-label", `${action.label} shortcuts`);
    input.addEventListener("change", () => {
      draft[action.id] = input.value.split(",").map((part) => normalizeShortcut(part.trim())).filter(Boolean);
      render();
    });
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => {
      delete draft[action.id];
      render();
    });
    row.append(label, input, restore);
    return row;
  }

  save.addEventListener("click", async () => {
    await options.saveOverrides(draft);
    controller.close();
  });

  restoreAll.addEventListener("click", () => {
    draft = restoreAllShortcutDefaults(draft);
    render();
  });

  const controller: ShortcutEditorController = {
    element: dialog,
    open: () => {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      draft = structuredClone(options.loadOverrides());
      dialog.hidden = false;
      render();
      dialog.querySelector<HTMLInputElement>("input")?.focus();
    },
    close: () => {
      dialog.hidden = true;
      previouslyFocused?.focus();
    },
  };
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
    }
  });
  return controller;
}
```

Wire the created controllers in `ui/src/main.ts` from the integration owner branch: append both `element`s to `document.body`, register `navigate.commandOverlay` to `commandOverlay.open()`, register `help.shortcuts` to `shortcutEditor.open()`, and route `Ctrl+P` through the action registry instead of a direct listener.

- [ ] **Step 8.7: Write command and keybinding e2e tests**

Create `ui/e2e/commands-keybindings.spec.cjs` with explicit e2e coverage for command execution, shortcut-editor persistence/conflicts, and standard shortcut dispatch:

```js
const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

async function openEditor(page) {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function openCommandOverlay(page) {
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
}

async function runCommand(page, query) {
  await openCommandOverlay(page);
  await page.getByRole('searchbox', { name: 'Search commands' }).fill(query);
  await page.keyboard.press('Enter');
}

async function setShortcutInput(page, label, value) {
  const input = page.getByLabel(`${label} shortcuts`);
  await input.fill(value);
  await input.evaluate((node) => node.dispatchEvent(new Event('change', { bubbles: true })));
}

test('command overlay runs actions from the keyboard', async ({ page }) => {
  await openEditor(page);

  await runCommand(page, 'Keyboard shortcuts');

  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

test('shortcut editor detects conflicts and persists a usable override', async ({ page }) => {
  await openEditor(page);
  await runCommand(page, 'Keyboard shortcuts');

  await setShortcutInput(page, 'Keyboard shortcuts', 'Ctrl+P');
  await expect(page.getByRole('alert')).toContainText('Shortcut conflict: Ctrl+P');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.getByRole('button', { name: 'Restore all default shortcuts' }).click();
  await setShortcutInput(page, 'Command overlay', 'Ctrl+K');
  await expect(page.getByRole('alert')).toBeEmpty();
  await page.getByRole('button', { name: 'Save' }).click();

  const saved = await page.evaluate(() => {
    const calls = window.__pmdInvocations.filter((call) => call.cmd === 'set_shortcut_overrides');
    return calls.at(-1)?.args?.overrides ?? null;
  });
  expect(saved).toEqual({ 'navigate.commandOverlay': ['Ctrl+K'] });

  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
});

test('standard shortcuts dispatch their visible actions', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.keyboard.press('Control+N');
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();

  await page.keyboard.press('Alt+z');
  await expect(content).not.toHaveClass(/cm-lineWrapping/);
  await page.keyboard.press('Alt+z');
  await expect(content).toHaveClass(/cm-lineWrapping/);

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+T');
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('F10');
  await expect(page.getByRole('menubar')).toBeFocused();
});

test('every default shortcut reaches the action registry', async ({ page }) => {
  await openEditor(page);
  const cases = [
    ['Control+N', 'file.new'],
    ['Control+O', 'file.open'],
    ['Control+S', 'file.save'],
    ['Shift+Control+S', 'file.saveAs'],
    ['Control+W', 'file.closeTab'],
    ['Control+Q', 'app.quit'],
    ['Control+F', 'edit.find'],
    ['Control+G', 'edit.findNext'],
    ['Shift+Control+G', 'edit.findPrevious'],
    ['Control+Equal', 'view.zoomIn'],
    ['Control+Minus', 'view.zoomOut'],
    ['Control+0', 'view.zoomReset'],
    ['Control+\\\\', 'view.cycleMode'],
    ['Alt+z', 'view.toggleWordWrap'],
    ['Control+P', 'navigate.commandOverlay'],
    ['Control+Shift+O', 'navigate.outline'],
    ['Control+Shift+M', 'diagnostics.togglePanel'],
    ['Control+T', 'theme.pick'],
    ['Control+,', 'settings.open'],
    ['Control+/', 'help.shortcuts'],
    ['F10', 'menu.focus'],
  ];

  for (const [shortcut] of cases) {
    await page.keyboard.press(shortcut);
    await page.keyboard.press('Escape');
  }

  const actionIds = await page.evaluate(() => window.__pmdE2eActions ?? []);
  expect(actionIds).toEqual(cases.map(([, actionId]) => actionId));
});
```

Extend the existing `ui/e2e/helpers.cjs` mock settings branch so this spec can prove persistence without a real Tauri backend:

```js
let shortcutOverrides = {};
window.__pmdE2e = true;
window.__pmdE2eActions = [];

function settingsPayload() {
  return {
    active_theme: null,
    light_theme: null,
    dark_theme: null,
    auto_switch: false,
    default_mode: null,
    autosave_mode: 'off',
    autoreload_mode: 'when_clean',
    merge_strategy: 'raise_conflict',
    browser_base_dir: null,
    gist_enabled: false,
    diff_mode: 'none',
    dont_ask_default_handler: true,
    mono_font: null,
    shortcut_overrides: shortcutOverrides,
  };
}

if (cmd === 'get_settings') return settingsPayload();
if (cmd === 'set_shortcut_overrides') {
  shortcutOverrides = structuredClone(args.overrides ?? {});
  return settingsPayload();
}
```

The implementation must apply saved shortcut overrides immediately after `set_shortcut_overrides` succeeds, so `Ctrl+K` opens the command overlay in the same session without restarting the app.

Add this test-only observation inside the action-dispatch path in `ui/src/main.ts`; `app.quit` must be observed but not executed when the e2e probe is active:

```ts
declare global {
  interface Window {
    __pmdE2e?: boolean;
    __pmdE2eActions?: string[];
  }
}

function recordActionForE2e(actionId: ActionId): boolean {
  if (!window.__pmdE2e) return false;
  window.__pmdE2eActions = window.__pmdE2eActions ?? [];
  window.__pmdE2eActions.push(actionId);
  return actionId === "app.quit";
}
```

Call `if (recordActionForE2e(id)) return;` at the top of the registry-backed `ActionContext.run` implementation before the concrete action switch.

- [ ] **Step 8.8: Verify**

```bash
cargo test -p pmd-app --test cmd_settings -j 2
cd ui && npm run test:unit
cd ui && npm run typecheck
cd ui && npm run build
cd ui && npm run test:e2e:playwright -- e2e/commands-keybindings.spec.cjs
```

Expected: all commands pass.

- [ ] **Step 8.9: Review, commit, and merge**

```bash
ccc --yolo @cx-reviewer "Review action registry, shortcut persistence, command overlay, and keyboard migration for plan compliance and accessibility regressions. Return PASS or blockers."
```

If the reviewer returns anything other than `PASS`, fix the findings and rerun Step 8.9. After `PASS`, run:

```bash
git status --short
git add ui/src/actions.ts ui/src/keybindings.ts ui/src/command_overlay.ts ui/src/shortcut_editor.ts ui/src/actions.test.ts ui/src/keybindings.test.ts ui/e2e/commands-keybindings.spec.cjs ui/e2e/helpers.cjs ui/src/main.ts ui/src/hotkeys.ts ui/src/chrome.ts ui/src/settings_menu.ts ui/src/file_browser.ts ui/src/tabbar.ts ui/src/editor.ts ui/src/codemirror-entry.ts ui/styles/components.css ui/tsconfig.json crates/pmd-app/src/state/settings.rs crates/pmd-app/src/cmd/settings.rs crates/pmd-app/src/main.rs crates/pmd-app/tests/cmd_settings.rs
git commit -m "feat(ui): add command registry and rebindable shortcuts"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-actions-keybindings
```

## Block 9: UI Facts Store and Outline Panel

**Worktree:** `.worktrees/dit-outline`

**Owner:** outline UI worker.

**Files:**

- Create: `ui/src/document_contracts.ts`
- Create: `ui/src/document_facts_store.ts`
- Create: `ui/src/document_facts_store.test.ts`
- Create: `ui/src/outline_panel.ts`
- Integration-owner modify: `ui/src/main.ts`
- Integration-owner modify: `ui/src/actions.ts`
- Integration-owner modify: `ui/styles/components.css`
- Integration-owner modify: `ui/styles/base.css`
- Integration-owner modify: `ui/e2e/helpers.cjs`
- Modify: `ui/tsconfig.json`
- Create: `ui/e2e/document-intelligence.spec.cjs`

This block must append `src/document_contracts.ts`, `src/document_facts_store.ts`, and `src/outline_panel.ts` to `ui/tsconfig.json` `include` before the `npm run typecheck` gate.

- [ ] **Step 9.1: Write facts store tests**

`ui/src/document_facts_store.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentFactsStore } from "./document_facts_store.ts";

test("drops stale facts for older render versions", () => {
  const store = createDocumentFactsStore();
  store.accept({ doc_id: 1, version: 2, headings: [], diagnostics: null });
  store.accept({ doc_id: 1, version: 1, headings: [{ text: "Old" }], diagnostics: null });

  assert.equal(store.current(1)?.version, 2);
});
```

- [ ] **Step 9.2: Write outline e2e tests**

First extend the existing `ui/e2e/helpers.cjs` `installTauriMock` setup to return complete render contracts when an outline test supplies facts. Change the `addInitScript` destructuring to include `renderFacts`:

```js
await page.addInitScript(({ initialPath, themes, renderHtml, renderFacts }) => {
```

Place `emptyDiagnostics` beside the existing `renderMarkdown` helper inside `addInitScript`, then replace the current `render_cmd` branch with the branch below:

```js
function emptyDiagnostics(docId, version) {
  return {
    doc_id: docId,
    version,
    phase: "initial",
    issues: [],
    resources: { doc_id: docId, version, allowed_roots: [], loaded_resources: [], decisions: [] },
    link_summary: { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 },
  };
}

if (cmd === 'render_cmd') {
  const docId = args.docId ?? args.doc_id ?? 1;
  const version = args.version ?? 0;
  return {
    doc_id: docId,
    version,
    html: renderHtml ?? renderMarkdown(args.markdown ?? ''),
    source_map: [],
    render_nonce: '',
    facts: {
      doc_id: docId,
      version,
      headings: renderFacts?.headings ?? [],
      anchors: [],
      links: [],
      reference_definitions: [],
      images: [],
      frontmatter: null,
      blocks: [],
      embedded: { code_blocks: [], mermaid_blocks: [], math_spans: [], math_blocks: [] },
      counts: { words: 0, bytes: 0, sentences: 0, paragraphs: 0, headings: renderFacts?.headings?.length ?? 0, links: 0, images: 0, code_blocks: 0, mermaid_blocks: 0, math_spans: 0, math_blocks: 0 },
    },
    diagnostics: emptyDiagnostics(docId, version),
  };
}
```

Finally add `renderFacts` to the argument object passed to `addInitScript`:

```js
{
  initialPath: options.initialPath ?? null,
  themes: options.themes ?? themes,
  renderHtml: options.renderHtml ?? null,
  renderFacts: options.renderFacts ?? null,
}
```

Keep the existing non-render command cases in `invoke`.

Create `ui/e2e/document-intelligence.spec.cjs` with concrete outline coverage:

```js
const { test, expect } = require('@playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

const headings = [
  { level: 1, text: 'Alpha', slug: 'alpha', duplicate_index: 0, line_start: 1, line_end: 1, block_id: 'block-alpha' },
  { level: 2, text: 'Beta', slug: 'beta', duplicate_index: 0, line_start: 3, line_end: 3, block_id: 'block-beta' },
  { level: 2, text: 'Deep Dive', slug: 'deep-dive', duplicate_index: 0, line_start: 5, line_end: 5, block_id: 'block-deep' },
];

async function openOutlineFixture(page) {
  await installTauriMock(page, {
    renderFacts: { headings },
    renderHtml: [
      '<article class="pmd-preview">',
      '<h1 data-pmd-block-id="block-alpha">Alpha</h1>',
      '<h2 data-pmd-block-id="block-beta">Beta</h2>',
      '<div style="height: 1200px"></div>',
      '<h2 data-pmd-block-id="block-deep">Deep Dive</h2>',
      '</article>',
    ].join(''),
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  await page.waitForSelector('.cm-editor');
  await page.evaluate(() => {
    const view = document.querySelector('.cm-editor')?.cmView?.view;
    if (!view) throw new Error('CodeMirror view not found');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Alpha\n\n## Beta\n\n## Deep Dive\n' } });
  });
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
}

test('outline opens, filters, jumps, tracks active heading, and restores focus', async ({ page }) => {
  await openOutlineFixture(page);
  await page.keyboard.press('Control+Shift+O');

  const outline = page.getByRole('dialog', { name: 'Outline' });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Alpha' })).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveAttribute('aria-level', '2');

  await outline.getByRole('searchbox', { name: 'Filter headings' }).fill('Deep');
  await expect(outline.getByRole('treeitem', { name: 'Deep Dive' })).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveCount(0);

  await outline.getByRole('searchbox', { name: 'Filter headings' }).fill('');
  await outline.getByRole('tree').press('ArrowDown');
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pmd-block-id="block-beta"]')).toBeInViewport();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');

  await page.locator('[data-pmd-block-id="block-deep"]').scrollIntoViewIfNeeded();
  await expect(outline.getByRole('treeitem', { name: 'Deep Dive' })).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(outline).toBeHidden();
  await expect(page.locator('.cm-content')).toBeFocused();
});
```

- [ ] **Step 9.3: Implement TypeScript contracts**

Move the temporary `unknown` render fields from `main.ts` into `ui/src/document_contracts.ts`, mirroring the Rust contract names and snake_case fields. Export at least:

```ts
export interface RenderResult {
  doc_id: number;
  version: number;
  html: string;
  source_map: Array<[number, number]>;
  render_nonce: string;
  facts: DocumentFacts;
  diagnostics: DocumentDiagnostics;
}

export interface DocumentFacts extends CoreDocumentFacts {
  doc_id: number;
  version: number;
}

export interface DocumentDiagnostics {
  doc_id: number;
  version: number;
  phase: "initial" | "enriched";
  issues: DocumentIssue[];
  resources: ResourcePolicyReport;
  link_summary: LinkValidationSummary;
}
```

Copy the already-defined `CoreDocumentFacts`, `DocumentIssue`, `ResourcePolicyReport`, `ResourceDecision`, and `LinkValidationSummary` TypeScript definitions from this plan's Shared Contracts section into `ui/src/document_contracts.ts` without renaming snake_case backend fields.

- [ ] **Step 9.4: Implement newest-wins facts store**

`ui/src/document_facts_store.ts` exports this concrete newest-wins store:

```ts
import type { DocumentDiagnostics, DocumentFacts, HeadingFact } from "./document_contracts.js";

export interface FactsSnapshot {
  doc_id: number;
  version: number;
  headings: HeadingFact[];
  facts?: DocumentFacts;
  diagnostics: DocumentDiagnostics | null;
}

export function createDocumentFactsStore() {
  const byDoc = new Map<number, FactsSnapshot>();
  let activeDocId: number | null = null;

  return {
    setActiveDoc(docId: number | null) {
      activeDocId = docId;
    },
    accept(snapshot: FactsSnapshot) {
      const current = byDoc.get(snapshot.doc_id);
      if (activeDocId !== null && snapshot.doc_id !== activeDocId) return false;
      if (current && snapshot.version < current.version) return false;
      byDoc.set(snapshot.doc_id, snapshot);
      return true;
    },
    acceptDiagnostics(diagnostics: DocumentDiagnostics) {
      const current = byDoc.get(diagnostics.doc_id);
      if (!current || current.version !== diagnostics.version) return false;
      byDoc.set(diagnostics.doc_id, { ...current, diagnostics });
      return true;
    },
    current(docId: number) {
      return byDoc.get(docId) ?? null;
    },
  };
}
```

- [ ] **Step 9.5: Implement outline panel**

`ui/src/outline_panel.ts` exposes a DOM boundary that the integration owner wires from `main.ts`:

```ts
import type { HeadingFact } from "./document_contracts.js";

export type OutlineMode = "collapsed" | "overlay" | "docked";

export interface OutlinePanel {
  element: HTMLElement;
  setHeadings(headings: HeadingFact[]): void;
  setMode(mode: OutlineMode): void;
  setFilter(query: string): void;
  setActiveBlock(blockId: string | null): void;
  focusSearch(): void;
  destroy(): void;
}

export function createOutlinePanel(options: {
  onJump(blockId: string): void;
  restoreFocus(): void;
}): OutlinePanel {
  const element = document.createElement("aside");
  element.dataset.panel = "outline";
  let headings: HeadingFact[] = [];
  let filter = "";
  let mode: OutlineMode = "collapsed";
  let activeBlockId: string | null = null;
  let focusedIndex = 0;

  function visibleHeadings() {
    const needle = filter.trim().toLowerCase();
    return needle.length === 0
      ? headings
      : headings.filter((heading) => heading.text.toLowerCase().includes(needle));
  }

  function applyModeAttributes() {
    if (mode === "overlay") {
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-label", "Outline");
      element.setAttribute("aria-modal", "false");
    } else {
      element.setAttribute("role", "navigation");
      element.setAttribute("aria-label", "Document outline");
      element.removeAttribute("aria-modal");
    }
  }

  function focusTreeItem(index: number) {
    const items = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'));
    if (items.length === 0) return;
    focusedIndex = Math.max(0, Math.min(index, items.length - 1));
    items[focusedIndex].focus();
  }

  function activate(heading: HeadingFact) {
    activeBlockId = heading.block_id;
    options.onJump(heading.block_id);
    render();
    focusTreeItem(visibleHeadings().findIndex((item) => item.block_id === heading.block_id));
  }

  function closeOverlayIfNeeded() {
    if (mode !== "overlay") return;
    mode = "collapsed";
    render();
    options.restoreFocus();
  }

  function onTreeKeydown(event: KeyboardEvent, visible: HeadingFact[]) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusTreeItem(focusedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusTreeItem(focusedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTreeItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTreeItem(visible.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const heading = visible[focusedIndex];
      if (heading) activate(heading);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeOverlayIfNeeded();
    }
  }

  function render() {
    applyModeAttributes();
    element.hidden = mode === "collapsed";
    element.innerHTML = "";

    const label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = "pmd-outline-filter";
    label.textContent = "Filter headings";

    const search = document.createElement("input");
    search.id = "pmd-outline-filter";
    search.type = "search";
    search.setAttribute("aria-label", "Filter headings");
    search.value = filter;
    search.addEventListener("input", () => {
      filter = search.value;
      focusedIndex = 0;
      render();
      element.querySelector<HTMLInputElement>("#pmd-outline-filter")?.focus();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlayIfNeeded();
      }
    });

    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    tree.tabIndex = 0;
    const visible = visibleHeadings();
    tree.addEventListener("keydown", (event) => onTreeKeydown(event, visible));
    visible.forEach((heading, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(heading.level));
      item.setAttribute("aria-selected", heading.block_id === activeBlockId ? "true" : "false");
      item.tabIndex = index === focusedIndex ? 0 : -1;
      item.dataset.blockId = heading.block_id;
      item.textContent = heading.text;
      item.addEventListener("focus", () => { focusedIndex = index; });
      item.addEventListener("click", () => activate(heading));
      tree.append(item);
    });
    element.append(label, search);
    element.append(tree);
  }

  return {
    element,
    setHeadings(next) { headings = next; render(); },
    setMode(next) { mode = next; render(); },
    setFilter(next) { filter = next; render(); },
    setActiveBlock(blockId) { activeBlockId = blockId; render(); },
    focusSearch() { element.querySelector<HTMLInputElement>("#pmd-outline-filter")?.focus(); },
    destroy() { element.remove(); },
  };
}
```

Register `navigate.outline` through the action registry and add the concrete `ui/src/main.ts` integration below. It updates headings from accepted render facts, scrolls by `block_id`, and tracks the active heading from both preview scroll and editor caret:

```ts
const factsStore = createDocumentFactsStore();
const outlinePanel = createOutlinePanel({
  onJump(blockId) {
    jumpEditorToBlock(blockId);
    previewContent
      .querySelector<HTMLElement>(`[data-pmd-block-id="${CSS.escape(blockId)}"]`)
      ?.scrollIntoView({ block: "start" });
    editor?.focus();
  },
  restoreFocus() {
    editor?.focus();
  },
});
document.body.append(outlinePanel.element);

let outlineObserver: IntersectionObserver | null = null;

function jumpEditorToBlock(blockId: string) {
  const active = store.activeDoc();
  if (!active || !editor) return;
  const snapshot = factsStore.current(active.docId);
  const heading = snapshot?.headings.find((item) => item.block_id === blockId);
  if (!heading) return;
  const lineNumber = Math.max(1, Math.min(editor.view.state.doc.lines, heading.line_start));
  const line = editor.view.state.doc.line(lineNumber);
  editor.view.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  });
}

function applyOutlineRender(result: RenderResult) {
  if (!factsStore.accept({
    doc_id: result.doc_id,
    version: result.version,
    headings: result.facts.headings,
    facts: result.facts,
    diagnostics: result.diagnostics,
  })) {
    return;
  }
  outlinePanel.setHeadings(result.facts.headings);
  observePreviewHeadings(result.facts.headings);
  updateOutlineFromEditorCaret();
}

function observePreviewHeadings(headings: HeadingFact[]) {
  outlineObserver?.disconnect();
  outlineObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    const blockId = visible?.target.getAttribute("data-pmd-block-id") ?? null;
    if (blockId) outlinePanel.setActiveBlock(blockId);
  }, { root: previewPane, rootMargin: "0px 0px -70% 0px", threshold: 0.01 });
  for (const heading of headings) {
    const node = previewContent.querySelector(`[data-pmd-block-id="${CSS.escape(heading.block_id)}"]`);
    if (node) outlineObserver.observe(node);
  }
}

function updateOutlineFromEditorCaret() {
  const active = store.activeDoc();
  if (!active || !editor) return;
  const snapshot = factsStore.current(active.docId);
  if (!snapshot) return;
  const line = editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number;
  const heading = [...snapshot.headings].reverse().find((item) => item.line_start <= line);
  outlinePanel.setActiveBlock(heading?.block_id ?? null);
}

let outlineCaretListenersInstalled = false;

function installOutlineCaretListeners() {
  if (!editor || outlineCaretListenersInstalled) return;
  editor.view.dom.addEventListener("keyup", updateOutlineFromEditorCaret);
  editor.view.dom.addEventListener("mouseup", updateOutlineFromEditorCaret);
  outlineCaretListenersInstalled = true;
}

function runOutlineAction(id: ActionId): boolean {
  if (id === "navigate.outline") {
    outlinePanel.setMode("overlay");
    outlinePanel.focusSearch();
    return true;
  }
  return false;
}
```

Call `installOutlineCaretListeners()` after `ensureEditor()` creates the editor, and call `applyOutlineRender(result)` immediately after `previewContent.innerHTML = result.html` in `processRenderQueue`, while the same newest-wins guard that accepted the render result is still in scope. Outline jumps must always move the editor selection by source line and then scroll the matching preview block when it exists, so click-to-jump works in source, split, and preview modes. In the existing `ActionContext.run` body from Block 8, call `if (runOutlineAction(id)) return;` before falling through to the existing action cases. The file browser remains its existing separate tab in this slice; optional VS Code-style folder tree work is reserved for a later design.

- [ ] **Step 9.6: Verify**

```bash
cd ui && npm run test:unit
cd ui && npm run typecheck
cd ui && npm run test:e2e:playwright -- e2e/document-intelligence.spec.cjs --grep "outline"
```

Expected: all commands pass.

- [ ] **Step 9.7: Review, commit, and merge**

```bash
ccc --yolo @cx-reviewer "Review the document facts store and outline panel for stale-result handling, keyboard behavior, and layout regressions. Return PASS or blockers."
```

If the reviewer returns anything other than `PASS`, fix the findings and rerun Step 9.7. After `PASS`, run:

```bash
git status --short
git add ui/src/document_contracts.ts ui/src/document_facts_store.ts ui/src/document_facts_store.test.ts ui/src/outline_panel.ts ui/src/main.ts ui/src/actions.ts ui/styles/components.css ui/styles/base.css ui/e2e/helpers.cjs ui/e2e/document-intelligence.spec.cjs ui/tsconfig.json
git commit -m "feat(ui): add document outline navigation"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-outline
```

## Block 10: Diagnostics Panel, Inline Issues, and Trust Status

**Worktree:** `.worktrees/dit-diagnostics-trust`

**Owner:** diagnostics/trust UI worker.

**Files:**

- Create: `ui/src/diagnostics.ts`
- Create: `ui/src/diagnostics.test.ts`
- Create: `ui/src/diagnostics_panel.ts`
- Create: `ui/src/inline_issues.ts`
- Create: `ui/src/resource_policy.ts`
- Create: `ui/src/resource_policy.test.ts`
- Create: `ui/src/trust_policy_panel.ts`
- Integration-owner modify: `ui/src/main.ts`
- Integration-owner modify: `ui/src/actions.ts`
- Modify: `ui/src/settings_menu.ts`
- Modify: `ui/src/chrome.ts`
- Integration-owner modify: `ui/styles/components.css`
- Integration-owner modify: `ui/styles/base.css`
- Create: `ui/e2e/trust-policy.spec.cjs`
- Integration-owner modify: `ui/e2e/helpers.cjs`
- Modify: `ui/tsconfig.json`

This block must append `src/diagnostics.ts`, `src/diagnostics_panel.ts`, `src/inline_issues.ts`, `src/resource_policy.ts`, and `src/trust_policy_panel.ts` to `ui/tsconfig.json` `include` before the `npm run typecheck` gate.

- [ ] **Step 10.1: Write diagnostics unit tests**

Create `ui/src/diagnostics.test.ts` with these tests:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveDiagnosticsPresentation } from "./diagnostics.js";
import type { DocumentDiagnostics, DocumentIssue } from "./document_contracts.js";

function issue(id: string, severity: DocumentIssue["severity"], category: DocumentIssue["category"], detail: string | null = "fix the path"): DocumentIssue {
  return { id, severity, category, message: `${category} ${severity}`, line_start: 1, line_end: 1, block_id: null, detail, primary_action: null };
}

function emptyResourcePolicyReport(doc_id: number, version: number) {
  return { doc_id, version, allowed_roots: [], loaded_resources: [], decisions: [] };
}

function emptyLinkSummary() {
  return { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 };
}

function diagnostics(issues: DocumentIssue[]): DocumentDiagnostics {
  return {
    doc_id: 1,
    version: 1,
    phase: "enriched",
    issues,
    resources: emptyResourcePolicyReport(1, 1),
    link_summary: emptyLinkSummary(),
  };
}

test("clean diagnostics hide the panel", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([]), { inlineDetail: true, panelExpanded: false });

  assert.equal(state.panelVisible, false);
  assert.equal(state.collapsedIndicatorVisible, false);
});

test("issues show collapsed indicator when panel is collapsed", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([issue("missing", "error", "image")]), { inlineDetail: true, panelExpanded: false });

  assert.equal(state.panelVisible, false);
  assert.equal(state.collapsedIndicatorVisible, true);
  assert.equal(state.counts.error, 1);
});

test("expanded panel groups by severity and category", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([
    issue("missing-image", "error", "image"),
    issue("blocked-image", "blocked", "resource_policy"),
    issue("frontmatter", "warning", "frontmatter"),
    issue("info", "info", "link"),
  ]), { inlineDetail: true, panelExpanded: true });

  assert.equal(state.panelVisible, true);
  assert.deepEqual(state.counts, { error: 1, blocked: 1, warning: 1, info: 1 });
  assert.deepEqual(state.groups.map((group) => `${group.severity}:${group.category}`), [
    "error:image",
    "blocked:resource_policy",
    "warning:frontmatter",
    "info:link",
  ]);
});

test("inline detail can be hidden while keeping one-line markers", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([issue("missing", "error", "image", "longer detail")]), { inlineDetail: false, panelExpanded: false });

  assert.equal(state.inlineIssues[0].message, "image error");
  assert.equal(state.inlineIssues[0].detail, null);
});
```

- [ ] **Step 10.2: Write trust/resource tests**

Create tests in `ui/src/resource_policy.test.ts` that assert:

- no trust/resource issues shows `Safe Preview`.
- blocked resource shows `Content Blocked`.
- resource panel lists raw HTML stripped, scripts disabled, remote images blocked, local images scoped, Mermaid strict, and KaTeX untrusted.
- external confirmation UI includes normalized URL, scheme, host, and label context.

Include:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExternalConfirmationModel, deriveTrustStatus, describeResourcePolicy } from "./resource_policy.js";

function emptyResourcePolicyReport(doc_id: number, version: number) {
  return { doc_id, version, allowed_roots: [], loaded_resources: [], decisions: [] };
}

test("trust status distinguishes clean and blocked documents", () => {
  assert.equal(deriveTrustStatus(emptyResourcePolicyReport(1, 1), []), "Safe Preview");
  assert.equal(
    deriveTrustStatus(emptyResourcePolicyReport(1, 1), [
      { id: "image-1", severity: "blocked", category: "resource_policy", message: "Remote image blocked", line_start: 3, line_end: 3, block_id: null, detail: null, primary_action: null },
    ]),
    "Content Blocked"
  );
});

test("resource policy panel lists active restrictions", () => {
  const rows = describeResourcePolicy(emptyResourcePolicyReport(1, 1));
  assert.deepEqual(rows.map((row) => row.label), [
    "Raw HTML stripped",
    "Scripts disabled",
    "Remote images blocked",
    "Local images scoped",
    "Mermaid strict",
    "KaTeX untrusted",
  ]);
});

test("external confirmation exposes normalized destination context", () => {
  const model = buildExternalConfirmationModel({
    normalized_url: "https://example.com/path?q=1",
    scheme: "https",
    host: "example.com",
    label_text: "Download report",
  });

  assert.equal(model.normalizedUrl, "https://example.com/path?q=1");
  assert.equal(model.scheme, "https");
  assert.equal(model.host, "example.com");
  assert.equal(model.labelText, "Download report");
});
```

- [ ] **Step 10.3: Write e2e tests**

Create tests in `ui/e2e/trust-policy.spec.cjs` for:

- broken image shows one-line inline issue and diagnostics row.
- broken local Markdown link shows one-line inline issue and diagnostics row.
- clean document hides diagnostics panel.
- blocked remote image shows `Content Blocked`.
- resource policy panel explains the block reason.
- external link click opens confirmation instead of navigating WebView.
- malformed frontmatter appears as a warning row and does not blank the preview.

Replace the existing `renderMarkdown` helper and `cmd === 'render_cmd'` branch in `ui/e2e/helpers.cjs` with a mock that returns the full Block 9 render contract used by diagnostics/trust tests:

```js
const emptyLinkSummary = () => ({
  checked: 0,
  errors: 0,
  warnings: 0,
  unchecked_external: 0,
  pending_async: 0,
});

function issue(id, severity, category, message, detail = null, primary_action = null) {
  return { id, severity, category, line_start: 1, line_end: 1, block_id: null, message, detail, primary_action };
}

function factsForMarkdown(markdown, docId, version) {
  const headings = Array.from(markdown.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match, index) => ({
    level: match[0].match(/^#+/)?.[0].length ?? 1,
    text: match[1],
    slug: match[1].toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-"),
    duplicate_index: 0,
    line_start: index + 1,
    line_end: index + 1,
    block_id: `block-${index}`,
  }));
  return {
    doc_id: docId,
    version,
    headings,
    anchors: headings.map((heading) => ({ slug: heading.slug, line_start: heading.line_start, line_end: heading.line_end, block_id: heading.block_id, source: "heading" })),
    links: [],
    reference_definitions: [],
    images: [],
    frontmatter: null,
    blocks: [],
    embedded: { code_blocks: [], mermaid_blocks: [], math_spans: [], math_blocks: [] },
    counts: { words: markdown.trim().split(/\s+/).filter(Boolean).length, bytes: markdown.length, sentences: 0, paragraphs: 1, headings: headings.length, links: 0, images: 0, code_blocks: 0, mermaid_blocks: 0, math_spans: 0, math_blocks: 0 },
  };
}

function diagnosticsForMarkdown(markdown, docId, version) {
  const issues = [];
  const decisions = [];
  if (markdown.startsWith('---\ntitle: [unterminated')) {
    issues.push(issue("frontmatter:1", "warning", "frontmatter", "Frontmatter could not be parsed", "Fix the YAML/TOML frontmatter syntax."));
  }
  if (/!\[[^\]]*\]\(https?:\/\//.test(markdown)) {
    issues.push(issue("remote-image:1", "blocked", "resource_policy", "Remote image blocked: use a local file or open the URL outside the preview.", null, null));
    decisions.push({ source_target: "https://example.com/image.png", normalized_target: null, line_start: 1, line_end: 1, kind: "image", decision: "blocked", reason: "remote_blocked", safe_url: null, placeholder_id: "image-0", alt_text: "remote" });
  }
  if (/!\[[^\]]+\]\(missing\.png\)/.test(markdown)) {
    issues.push(issue("missing-image:1", "error", "image", "Image missing: fix the path or move the file next to the document.", "missing.png", null));
    decisions.push({ source_target: "missing.png", normalized_target: "missing.png", line_start: 1, line_end: 1, kind: "image", decision: "missing", reason: "missing_file", safe_url: null, placeholder_id: "image-0", alt_text: "missing" });
  }
  if (/\[[^\]]+\]\(missing\.md\)/.test(markdown)) {
    issues.push(issue("missing-md:1", "error", "link", "Linked Markdown file not found: missing.md", "missing.md", null));
  }
  if (/!\[[^\]]+\]\(\.\.\/assets\/outside\.png\)/.test(markdown)) {
    issues.push(issue("blocked-image:1", "blocked", "resource_policy", "Image blocked: grant the containing folder or move it under the document folder.", null, "asset.grantFolder"));
    decisions.push({ source_target: "../assets/outside.png", normalized_target: "../assets/outside.png", line_start: 1, line_end: 1, kind: "image", decision: "blocked", reason: "outside_allowed_roots", safe_url: null, placeholder_id: "image-0", alt_text: "outside" });
  }
  return {
    doc_id: docId,
    version,
    phase: "initial",
    issues,
    resources: { doc_id: docId, version, allowed_roots: [], loaded_resources: [], decisions },
    link_summary: emptyLinkSummary(),
  };
}

const renderMarkdown = (markdown, diagnostics) => {
  const withoutFrontmatter = String(markdown).replace(/^---[\s\S]*?---\n/, "");
  const heading = withoutFrontmatter.match(/^#\s+(.+)$/m)?.[1] ?? "Untitled";
  const escaped = withoutFrontmatter.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const blocked = diagnostics.issues.some((item) => item.category === "resource_policy")
    ? '<span class="pmd-image-placeholder">Image blocked<span>Content Blocked</span></span>'
    : diagnostics.issues.some((item) => item.category === "image")
    ? '<span class="pmd-image-placeholder" data-pmd-resource-state="missing">Image missing</span>'
    : '';
  return `<article class="pmd-preview"><h1>${heading}</h1><p>${escaped}</p>${blocked}</article>`;
};

if (cmd === 'render_cmd') {
  const docId = args.docId ?? args.doc_id ?? 1;
  const version = args.version ?? 0;
  const markdown = args.markdown ?? '';
  const diagnostics = diagnosticsForMarkdown(markdown, docId, version);
  return {
    doc_id: docId,
    version,
    html: renderHtml ?? renderMarkdown(markdown, diagnostics),
    source_map: [],
    render_nonce: '',
    facts: factsForMarkdown(markdown, docId, version),
    diagnostics,
  };
}
```

Add the shared `openMarkdown` helper before writing these specs:

```js
async function openMarkdown(page, markdown, options = {}) {
  await installTauriMock(page, options);
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  await page.waitForSelector('.cm-editor');
  await page.evaluate((source) => {
    const view = document.querySelector('.cm-editor')?.cmView?.view;
    if (!view) throw new Error('CodeMirror view not found');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }, markdown);
  await page.waitForTimeout(250);
}

module.exports = {
  appUrl,
  installTauriMock,
  openMarkdown,
  screenshotPath,
  themes,
};
```

Include:

```js
const { openMarkdown } = require('./helpers.cjs');

test('broken local image shows missing state without blocked trust status', async ({ page }) => {
  await openMarkdown(page, '# Broken\n\n![missing](missing.png)');
  await expect(page.getByText('Image missing: fix the path or move the file next to the document.')).toBeVisible();
  await expect(page.locator('[data-pmd-resource-state="missing"]')).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toContainText('Image missing: fix the path or move the file next to the document.');
  await expect(page.getByText('Content Blocked')).toHaveCount(0);
});

test('broken local link shows inline issue and diagnostics row', async ({ page }) => {
  await openMarkdown(page, '# Broken Link\n\n[missing](missing.md)');
  await expect(page.getByText('Linked Markdown file not found: missing.md')).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toContainText('Linked Markdown file not found: missing.md');
  await expect(page.getByText('Content Blocked')).toHaveCount(0);
});

test('blocked remote image shows content blocked and policy reason', async ({ page }) => {
  await openMarkdown(page, '# Remote\n\n![remote](https://example.com/image.png)');
  await expect(page.getByText('Remote image blocked')).toBeVisible();
  await expect(page.getByText('Content Blocked')).toBeVisible();
});

test('malformed frontmatter shows a warning and keeps preview content', async ({ page }) => {
  await openMarkdown(page, '---\ntitle: [unterminated\n---\n# Body\n');
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();
  await expect(page.getByText('Frontmatter could not be parsed')).toBeVisible();
});
```

- [ ] **Step 10.4: Implement diagnostics panel and inline issues**

`ui/src/diagnostics.ts` owns pure presentation derivation:

```ts
import type { DocumentDiagnostics, DocumentIssue } from "./document_contracts.js";

export interface DiagnosticsSettings {
  inlineDetail: boolean;
  panelExpanded: boolean;
}

export interface DiagnosticsPresentation {
  panelVisible: boolean;
  collapsedIndicatorVisible: boolean;
  counts: Record<"error" | "blocked" | "warning" | "info", number>;
  groups: Array<{ severity: string; category: string; issues: DocumentIssue[] }>;
  inlineIssues: DocumentIssue[];
}

export function deriveDiagnosticsPresentation(diagnostics: DocumentDiagnostics, settings: DiagnosticsSettings): DiagnosticsPresentation {
  const counts = { error: 0, blocked: 0, warning: 0, info: 0 };
  for (const issue of diagnostics.issues) counts[issue.severity] += 1;
  const groups = groupIssues(diagnostics.issues);
  return {
    panelVisible: diagnostics.issues.length > 0 && settings.panelExpanded,
    collapsedIndicatorVisible: diagnostics.issues.length > 0 && !settings.panelExpanded,
    counts,
    groups,
    inlineIssues: settings.inlineDetail ? diagnostics.issues : diagnostics.issues.map((issue) => ({ ...issue, detail: null })),
  };
}
```

`ui/src/diagnostics_panel.ts` renders a labelled region when `panelVisible` is true and a compact button with counts when `collapsedIndicatorVisible` is true. `ui/src/inline_issues.ts` renders one-line actionable messages next to editor/source lines and backend-provided placeholders, with no raw unsafe URL attributes.

- [ ] **Step 10.5: Implement trust status and panel**

`ui/src/resource_policy.ts` owns trust derivation and external confirmation models:

```ts
import type { DocumentIssue, ResourcePolicyReport } from "./document_contracts.js";

export type TrustStatus = "Safe Preview" | "Content Blocked";

export function deriveTrustStatus(report: ResourcePolicyReport, issues: DocumentIssue[]): TrustStatus {
  return report.decisions.some((decision) => decision.decision === "blocked")
    || issues.some((issue) => issue.severity === "blocked" && issue.category === "resource_policy")
    ? "Content Blocked"
    : "Safe Preview";
}

export function describeResourcePolicy(report: ResourcePolicyReport) {
  return [
    { label: "Raw HTML stripped", status: "enabled" },
    { label: "Scripts disabled", status: "enabled" },
    { label: "Remote images blocked", status: "enabled" },
    { label: "Local images scoped", status: "enabled" },
    { label: "Mermaid strict", status: "enabled" },
    { label: "KaTeX untrusted", status: "enabled" },
    ...report.allowed_roots.map((root) => ({ label: root, status: "allowed_root" })),
  ];
}

export function buildExternalConfirmationModel(action: { normalized_url: string; scheme: string; host: string; label_text: string }) {
  return {
    normalizedUrl: action.normalized_url,
    scheme: action.scheme,
    host: action.host,
    labelText: action.label_text,
  };
}
```

`ui/src/trust_policy_panel.ts` renders the trust status, policy rows, allowed roots, active grants, and external confirmation contents. It never renders a clickable external URL until `confirm_external_open` succeeds.

Wire diagnostics and trust presentation from `ui/src/main.ts` in the integration-owner pass. Delete the temporary `latestEnrichedDiagnostics` map from Block 7 after this wiring lands; the document facts store becomes the only newest-wins gate for both render facts and diagnostics.

```ts
import { deriveDiagnosticsPresentation, type DiagnosticsSettings } from "./diagnostics.ts";
import { createDiagnosticsPanel } from "./diagnostics_panel.ts";
import { renderInlineIssues } from "./inline_issues.ts";
import { deriveTrustStatus } from "./resource_policy.ts";
import { createTrustPolicyPanel } from "./trust_policy_panel.ts";

const diagnosticsSettings: DiagnosticsSettings = { inlineDetail: true, panelExpanded: false };

function rerenderCurrentDiagnostics(): void {
  const current = factsStore.current(store.activeDoc()?.docId ?? -1)?.diagnostics;
  if (current) applyDocumentDiagnostics(current);
}

function toggleDiagnosticsPanel(): void {
  diagnosticsSettings.panelExpanded = !diagnosticsSettings.panelExpanded;
  rerenderCurrentDiagnostics();
}

const diagnosticsPanel = createDiagnosticsPanel({
  onToggleExpanded: () => {
    toggleDiagnosticsPanel();
  },
  onToggleInlineDetail: () => {
    diagnosticsSettings.inlineDetail = !diagnosticsSettings.inlineDetail;
    rerenderCurrentDiagnostics();
  },
});
const trustPolicyPanel = createTrustPolicyPanel();

function runDiagnosticsAction(id: ActionId): boolean {
  if (id === "diagnostics.togglePanel") {
    toggleDiagnosticsPanel();
    return true;
  }
  return false;
}

function applyDocumentDiagnostics(diagnostics: DocumentDiagnostics) {
  const presentation = deriveDiagnosticsPresentation(diagnostics, diagnosticsSettings);
  diagnosticsPanel.render(presentation);
  renderInlineIssues(previewContent, presentation.inlineIssues);
  trustPolicyPanel.render({
    status: deriveTrustStatus(diagnostics.resources, diagnostics.issues),
    report: diagnostics.resources,
    issues: diagnostics.issues,
  });
}

function acceptRenderDiagnostics(result: RenderResult): boolean {
  const accepted = factsStore.accept({
    doc_id: result.doc_id,
    version: result.version,
    headings: result.facts.headings,
    facts: result.facts,
    diagnostics: result.diagnostics,
  });
  if (accepted) applyDocumentDiagnostics(result.diagnostics);
  return accepted;
}

listen<DocumentDiagnostics>("pmd://diagnostics-enriched", (event) => {
  if (!factsStore.acceptDiagnostics(event.payload)) return;
  applyDocumentDiagnostics(event.payload);
}).catch((error) => {
  console.error("Failed to listen for enriched diagnostics", error);
});
```

Call `acceptRenderDiagnostics(result)` immediately after the existing render-result newest-wins guard accepts `result` and before any later outline/trust/grant UI reads diagnostics. This is the step that makes enriched diagnostics a full replacement for the current `(doc_id, version)` panel state, inline issues, and trust status. In the existing `ActionContext.run` body from Blocks 8 and 9, call `if (runDiagnosticsAction(id)) return;` alongside the outline action hook before falling through to existing action cases, so `diagnostics.togglePanel` and `Ctrl+Shift+M` replace the temporary Block 8 handler.

- [ ] **Step 10.6: Verify**

```bash
cd ui && npm run test:unit
cd ui && npm run typecheck
cd ui && npm run test:e2e:playwright -- e2e/trust-policy.spec.cjs
```

Expected: all commands pass.

- [ ] **Step 10.7: Review, commit, and merge**

```bash
ccc --yolo @cx-reviewer "Review diagnostics and trust UI for panel visibility rules, one-line inline actionability, security messaging, and accessibility. Return PASS or blockers."
```

If the reviewer returns anything other than `PASS`, fix the findings and rerun Step 10.7. After `PASS`, run:

```bash
git status --short
git add ui/src/diagnostics.ts ui/src/diagnostics.test.ts ui/src/diagnostics_panel.ts ui/src/inline_issues.ts ui/src/resource_policy.ts ui/src/resource_policy.test.ts ui/src/trust_policy_panel.ts ui/src/main.ts ui/src/actions.ts ui/src/settings_menu.ts ui/src/chrome.ts ui/styles/components.css ui/styles/base.css ui/e2e/trust-policy.spec.cjs ui/e2e/helpers.cjs ui/tsconfig.json
git commit -m "feat(ui): surface diagnostics and trust policy"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-diagnostics-trust
```

## Block 11: Session Asset Grants and Recovery Flow

**Worktree:** `.worktrees/dit-asset-grants`

**Owner:** asset grant worker.

**Files:**

- Create: `crates/pmd-app/src/preview/grants.rs`
- Create: `crates/pmd-app/src/preview/asset_scope.rs`
- Modify: `crates/pmd-app/src/preview/mod.rs`
- Modify: `crates/pmd-app/src/preview/resource_policy.rs`
- Integration-owner modify: `crates/pmd-app/src/preview/contracts.rs`
- Modify: `crates/pmd-app/src/cmd/render.rs`
- Integration-owner modify: `crates/pmd-app/src/main.rs`
- Create: `crates/pmd-app/src/preview/image_workflow.rs`
- Create: `crates/pmd-app/tests/asset_grants.rs`
- Create: `ui/src/local_asset_grants.ts`
- Modify: `ui/src/diagnostics_panel.ts`
- Modify: `ui/src/trust_policy_panel.ts`
- Integration-owner modify: `ui/src/actions.ts`
- Integration-owner modify: `ui/src/main.ts`
- Integration-owner modify: `ui/e2e/helpers.cjs`
- Create: `crates/pmd-e2e/tests/asset_grants.rs`
- Integration-owner modify: `ui/e2e/trust-policy.spec.cjs`
- Modify: `ui/tsconfig.json`

This block must append `src/local_asset_grants.ts` to `ui/tsconfig.json` `include` before the `npm run typecheck` gate.

- [ ] **Step 11.1: Write backend grant tests**

Create tests in `crates/pmd-app/tests/asset_grants.rs` that assert:

- grant uses native/portal picker output only.
- recursive canonical grant allows files below the granted folder.
- symlink escape remains blocked after canonicalization.
- revocation removes backend grant and rerender changes image to blocked.
- grants are session-scoped and not written to persistent settings.
- asset-scope mirror receives an allow call only after picker grant succeeds.
- asset-scope mirror receives a revoke call when no active document/grant still needs the canonical root.
- shared asset-scope roots use reference counting so revoking one document's grant does not break another document that still owns the root.
- image workflow foundation exposes future paste/drop destination decisions without copying files in this slice.

Include:

```rust
#[test]
fn grants_are_scoped_by_window_and_document_and_do_not_leak() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    std::fs::create_dir(&root).unwrap();
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror.clone()));

    let grant = grants.grant_for_test("main", 1, &root).expect("grant");

    assert!(grants.is_allowed_for_test("main", 1, &root.join("a.png")));
    assert!(!grants.is_allowed_for_test("main", 2, &root.join("a.png")));
    assert!(!grants.is_allowed_for_test("secondary", 1, &root.join("a.png")));
    grants.revoke_for_test("main", 1, grant.id).expect("revoke");
    assert!(!grants.is_allowed_for_test("main", 1, &root.join("a.png")));
}

#[test]
fn asset_scope_mirror_refcounts_shared_roots() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    std::fs::create_dir(&root).unwrap();
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror.clone()));

    let first = grants.grant_for_test("main", 1, &root).unwrap();
    let second = grants.grant_for_test("main", 2, &root).unwrap();
    grants.revoke_for_test("main", 1, first.id).unwrap();
    assert_eq!(mirror.revoked_roots(), Vec::<std::path::PathBuf>::new());
    grants.revoke_for_test("main", 2, second.id).unwrap();
    assert_eq!(mirror.revoked_roots(), vec![root.canonicalize().unwrap()]);
}

#[test]
fn granted_roots_are_supplied_to_resource_policy() {
    let temp = tempfile::tempdir().unwrap();
    let docs = temp.path().join("docs");
    let assets = temp.path().join("assets");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::create_dir_all(&assets).unwrap();
    std::fs::write(assets.join("outside.png"), b"png").unwrap();
    let doc_path = docs.join("doc.md");
    let markdown = "![outside](../assets/outside.png)";
    let core = pmd_core::emit::render_string(markdown);
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));
    let grant = grants.grant_for_test("main", 1, &assets).unwrap();

    let resolution = pmd_app_lib::preview::resource_policy::resolve_resources(
        pmd_app_lib::preview::resource_policy::ResourcePolicyContext {
            doc_id: 1,
            version: 2,
            doc_path: Some(&doc_path),
            markdown,
            rendered_html: &core.html,
            allowed_roots: vec![docs.canonicalize().unwrap(), grant.canonical_root],
        },
    ).unwrap();

    assert!(resolution.report.allowed_roots.iter().any(|root| root.contains("assets")));
    assert!(resolution.report.decisions.iter().any(|decision| decision.reason.as_str() == "allowed_local_scope"));
}
```

- [ ] **Step 11.2: Write UI/e2e grant recovery tests**

Create the grant recovery e2e test below. It covers:

- blocked image row has `Grant Folder`.
- clicking it calls backend picker command.
- after grant, the document rerenders and resource policy shows the image loaded.
- revocation returns the document to blocked state.

Extend `ui/e2e/helpers.cjs` with a deterministic asset-grant picker mock:

```js
async function grantFolderInMockBackend(page, relativeFolder) {
  await page.evaluate((folder) => {
    window.__pmdNextGrantFolder = folder;
  }, relativeFolder);
}
```

Place this state beside the existing `callbackId` and `nextDocId` variables inside `installTauriMock`:

```js
let nextGrantId = 1;
const assetGrants = [];
```

Extend the Block 10 mock render helpers so the grant recovery test sees the same rerender transition as production:

```js
function hasOutsideAssetGrant(docId) {
  return assetGrants.some((grant) => grant.doc_id === docId && grant.canonical_root === '../assets');
}

function grantAwareDiagnosticsForMarkdown(markdown, docId, version) {
  const diagnostics = diagnosticsForMarkdown(markdown, docId, version);
  if (markdown.includes('../assets/outside.png') && hasOutsideAssetGrant(docId)) {
    diagnostics.issues = diagnostics.issues.filter((item) => item.id !== 'blocked-image:1');
    diagnostics.resources.decisions = [{
      source_target: "../assets/outside.png",
      normalized_target: "../assets/outside.png",
      line_start: 1,
      line_end: 1,
      kind: "image",
      decision: "allowed",
      reason: "allowed_local_scope",
      safe_url: "asset://localhost/outside.png",
      placeholder_id: "image-0",
      alt_text: "outside",
    }];
    diagnostics.resources.loaded_resources = ["../assets/outside.png"];
    diagnostics.resources.allowed_roots = ["../assets"];
  }
  return diagnostics;
}

const renderMarkdownAfterGrants = (markdown, diagnostics) => {
  if (diagnostics.resources.decisions.some((decision) => decision.decision === "allowed" && decision.alt_text === "outside")) {
    return '<article class="pmd-preview"><img src="asset://localhost/outside.png" alt="outside"></article>';
  }
  return renderMarkdown(markdown, diagnostics);
};

if (cmd === 'render_cmd') {
  const docId = args.docId ?? args.doc_id ?? 1;
  const version = args.version ?? 0;
  const markdown = args.markdown ?? '';
  const diagnostics = grantAwareDiagnosticsForMarkdown(markdown, docId, version);
  return {
    doc_id: docId,
    version,
    html: renderHtml ?? renderMarkdownAfterGrants(markdown, diagnostics),
    source_map: [],
    render_nonce: '',
    facts: factsForMarkdown(markdown, docId, version),
    diagnostics,
  };
}
```

Extend the `installTauriMock` `invoke` handler with the commands below:

```js
if (cmd === 'grant_asset_folder' || cmd === 'grant_asset_folder_for_test') {
  const docId = args.docId ?? args.doc_id;
  const version = args.version ?? 0;
  const root = window.__pmdNextGrantFolder ?? args.pickedRoot ?? args.picked_root;
  if (!root) throw new Error('No mocked asset folder selected');
  const grant = {
    id: nextGrantId++,
    window_label: 'main',
    doc_id: docId,
    canonical_root: root,
  };
  window.__pmdNextGrantFolder = null;
  assetGrants.push(grant);
  return {
    grants: assetGrants.filter((item) => item.doc_id === docId),
    rerender_doc_id: docId,
    rerender_version: version + 1,
  };
}

if (cmd === 'revoke_asset_grant' || cmd === 'revoke_asset_grant_for_test') {
  const docId = args.docId ?? args.doc_id;
  const grantId = args.grantId ?? args.grant_id;
  const index = assetGrants.findIndex((item) => item.id === grantId);
  if (index >= 0) assetGrants.splice(index, 1);
  return {
    grants: assetGrants.filter((item) => item.doc_id === docId),
    rerender_doc_id: docId,
    rerender_version: 0,
  };
}

if (cmd === 'list_asset_grants' || cmd === 'list_asset_grants_for_test') {
  const docId = args.docId ?? args.doc_id;
  return assetGrants.filter((item) => item.doc_id === docId);
}
```

Update the helper exports:

```js
module.exports = {
  appUrl,
  grantFolderInMockBackend,
  installTauriMock,
  openMarkdown,
  screenshotPath,
  themes,
};
```

Include:

```js
const { grantFolderInMockBackend, openMarkdown } = require('./helpers.cjs');

test('Grant Folder recovers and revocation re-blocks a local image', async ({ page }) => {
  await openMarkdown(page, '![outside](../assets/outside.png)');
  await expect(page.getByText('Image blocked')).toBeVisible();

  await grantFolderInMockBackend(page, '../assets');
  await page.getByRole('button', { name: 'Grant Folder' }).click();
  await expect.poll(async () => page.evaluate(() => window.__pmdInvocations.map((call) => call.cmd))).toEqual(expect.arrayContaining(['grant_asset_folder']));
  await expect(page.getByAltText('outside')).toBeVisible();
  await expect(page.getByText('Content Blocked')).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke grant' }).click();
  await expect(page.getByText('Image blocked')).toBeVisible();
});
```

- [ ] **Step 11.3: Implement grant store**

`preview/grants.rs` owns `AssetGrantId`, canonical granted root, owning window/document context, recursive matching after canonicalization, revocation, and Tauri asset-scope mirroring:

```rust
use std::{collections::BTreeMap, path::{Path, PathBuf}, sync::Arc};

use crate::preview::asset_scope::AssetScopeMirror;

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
pub struct AssetGrantId(u64);

#[derive(Debug, Clone, serde::Serialize)]
pub struct AssetGrant {
    pub id: AssetGrantId,
    pub window_label: String,
    pub doc_id: u64,
    pub canonical_root: PathBuf,
}

#[derive(Debug, Clone)]
struct GrantKey {
    window_label: String,
    doc_id: u64,
}

pub struct GrantStore {
    next_id: u64,
    grants: BTreeMap<AssetGrantId, AssetGrant>,
    root_refcounts: BTreeMap<PathBuf, usize>,
    mirror: Arc<dyn AssetScopeMirror + Send + Sync>,
}

impl GrantStore {
    pub fn with_mirror(mirror: Box<dyn AssetScopeMirror + Send + Sync>) -> Self {
        Self { next_id: 1, grants: BTreeMap::new(), root_refcounts: BTreeMap::new(), mirror: mirror.into() }
    }

    pub fn grant_root(&mut self, window_label: &str, doc_id: u64, root: &Path) -> Result<AssetGrant, String> {
        let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
        let id = AssetGrantId(self.next_id);
        self.next_id += 1;
        if self.root_refcounts.get(&canonical_root).copied().unwrap_or(0) == 0 {
            self.mirror.allow_directory(&canonical_root)?;
        }
        *self.root_refcounts.entry(canonical_root.clone()).or_insert(0) += 1;
        let grant = AssetGrant { id, window_label: window_label.to_string(), doc_id, canonical_root };
        self.grants.insert(id, grant.clone());
        Ok(grant)
    }

    pub fn revoke(&mut self, window_label: &str, doc_id: u64, id: AssetGrantId) -> Result<(), String> {
        let grant = self.grants.remove(&id).ok_or_else(|| "Unknown asset grant".to_string())?;
        if grant.window_label != window_label || grant.doc_id != doc_id {
            self.grants.insert(id, grant);
            return Err("Asset grant does not belong to this document".to_string());
        }
        let count = self.root_refcounts.get_mut(&grant.canonical_root).ok_or_else(|| "Missing grant refcount".to_string())?;
        *count -= 1;
        if *count == 0 {
            self.root_refcounts.remove(&grant.canonical_root);
            self.mirror.revoke_directory(&grant.canonical_root)?;
        }
        Ok(())
    }

    pub fn is_allowed(&self, window_label: &str, doc_id: u64, path: &Path) -> bool {
        let Ok(canonical_path) = path.canonicalize() else { return false; };
        self.grants.values().any(|grant| {
            grant.window_label == window_label
                && grant.doc_id == doc_id
                && canonical_path.starts_with(&grant.canonical_root)
        })
    }

    pub fn list(&self, window_label: &str, doc_id: u64) -> Vec<AssetGrant> {
        self.grants
            .values()
            .filter(|grant| grant.window_label == window_label && grant.doc_id == doc_id)
            .cloned()
            .collect()
    }

    pub fn active_roots(&self, window_label: &str, doc_id: u64) -> Vec<PathBuf> {
        self.list(window_label, doc_id)
            .into_iter()
            .map(|grant| grant.canonical_root)
            .collect()
    }

    pub fn grant_for_test(&mut self, window_label: &str, doc_id: u64, root: &Path) -> Result<AssetGrant, String> {
        self.grant_root(window_label, doc_id, root)
    }

    pub fn revoke_for_test(&mut self, window_label: &str, doc_id: u64, id: AssetGrantId) -> Result<(), String> {
        self.revoke(window_label, doc_id, id)
    }

    pub fn is_allowed_for_test(&self, window_label: &str, doc_id: u64, path: &Path) -> bool {
        self.is_allowed(window_label, doc_id, path)
    }
}
```

`preview/asset_scope.rs` owns a testable seam around Tauri asset-scope calls:

```rust
pub trait AssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String>;
    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String>;
}

pub struct ProductionAssetScopeMirror {
    scope: tauri::scope::fs::Scope,
}

impl ProductionAssetScopeMirror {
    pub fn new(scope: tauri::scope::fs::Scope) -> Self {
        Self { scope }
    }
}

impl AssetScopeMirror for ProductionAssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.scope.allow_directory(canonical_root, true).map_err(|err| err.to_string())
    }

    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.scope.forbid_directory(canonical_root, true).map_err(|err| err.to_string())
    }
}

#[derive(Clone, Default)]
pub struct RecordingAssetScopeMirror {
    allowed: std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>,
    revoked: std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>,
}

impl RecordingAssetScopeMirror {
    pub fn allowed_roots(&self) -> Vec<PathBuf> {
        self.allowed.lock().unwrap().clone()
    }

    pub fn revoked_roots(&self) -> Vec<PathBuf> {
        self.revoked.lock().unwrap().clone()
    }
}

impl AssetScopeMirror for RecordingAssetScopeMirror {
    fn allow_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.allowed.lock().unwrap().push(canonical_root.to_path_buf());
        Ok(())
    }

    fn revoke_directory(&self, canonical_root: &Path) -> Result<(), String> {
        self.revoked.lock().unwrap().push(canonical_root.to_path_buf());
        Ok(())
    }
}
```

The production implementation wraps Tauri asset scope. Tests use `RecordingAssetScopeMirror` to assert allow/revoke order and refcount behavior.

`preview/image_workflow.rs` owns future paste/drop image workflow contracts without implementing file copy UI in this slice:

```rust
pub enum ImageInsertDestination {
    ImagesDirectory,
    ImagesDirectoryForDocumentStem,
}

pub enum ImageInsertReadiness {
    Ready { destination: ImageInsertDestination },
    RequiresSaveBeforeInsert,
}
```

Rules reserved by this foundation:

- future paste/drop image insertion copies files to `images/` or `images/{document-stem}/`.
- unsaved buffers return `RequiresSaveBeforeInsert` before accepting image files.
- inserted Markdown uses a relative image path under the chosen destination.
- session asset grants and paste/drop insertion remain separate authority paths.

The existing `PathScope` may expose reusable canonical comparison helpers, but persisted file-browser folders do not become asset grants.

- [ ] **Step 11.4: Implement commands**

Production Tauri commands derive `window_label` from the current `Window`, while test/internal helpers use an explicit label:

- `grant_asset_folder(window, validation, doc_id, version, placeholder_id) -> GrantResult`
- `revoke_asset_grant(window, validation, doc_id, grant_id) -> GrantResult`
- `list_asset_grants(window, doc_id) -> Vec<AssetGrant>`
- `grant_asset_folder_for_test(window_label, doc_id, version, placeholder_id, picked_root) -> GrantResult`
- `revoke_asset_grant_for_test(window_label, doc_id, grant_id) -> GrantResult`
- `list_asset_grants_for_test(window_label, doc_id) -> Vec<AssetGrant>`

Command code shape:

```rust
use std::sync::{Mutex, OnceLock};

static GRANT_STORE: OnceLock<Mutex<GrantStore>> = OnceLock::new();

pub fn init_grant_store(asset_scope: tauri::scope::fs::Scope) -> Result<(), String> {
    GRANT_STORE
        .set(Mutex::new(GrantStore::with_mirror(Box::new(crate::preview::asset_scope::ProductionAssetScopeMirror::new(asset_scope)))))
        .map_err(|_| "Asset grant store already initialized".to_string())
}

fn grant_store() -> Result<&'static Mutex<GrantStore>, String> {
    GRANT_STORE.get().ok_or_else(|| "Asset grant store is not initialized".to_string())
}

async fn pick_folder_for_placeholder(
    window: &tauri::Window,
    _doc_id: u64,
    _placeholder_id: &str,
) -> Result<std::path::PathBuf, String> {
    use tauri_plugin_dialog::DialogExt;
    window
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.into_path().map_err(|err| err.to_string()))
        .transpose()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No folder selected".to_string())
}

#[derive(Debug, serde::Serialize)]
pub struct GrantResult {
    pub grants: Vec<AssetGrant>,
    pub rerender_doc_id: u64,
    pub rerender_version: u64,
}

pub async fn grant_asset_folder(
    window: tauri::Window,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: u64,
    version: u64,
    placeholder_id: String,
) -> Result<GrantResult, String> {
    let window_label = window.label().to_string();
    let picked_root = pick_folder_for_placeholder(&window, doc_id, &placeholder_id).await?;
    let result = grant_asset_folder_for_test(window_label, doc_id, version, placeholder_id, picked_root)?;
    validation.invalidate_for_grant_change(doc_id).await;
    Ok(result)
}

pub async fn revoke_asset_grant(
    window: tauri::Window,
    validation: tauri::State<'_, crate::preview::render_pipeline::ValidationWorker>,
    doc_id: u64,
    grant_id: AssetGrantId,
) -> Result<GrantResult, String> {
    let result = revoke_asset_grant_for_test(window.label().to_string(), doc_id, grant_id)?;
    validation.invalidate_for_grant_change(doc_id).await;
    Ok(result)
}

pub fn list_asset_grants(window: tauri::Window, doc_id: u64) -> Result<Vec<AssetGrant>, String> {
    list_asset_grants_for_test(window.label().to_string(), doc_id)
}

pub fn grant_asset_folder_for_test(
    window_label: String,
    doc_id: u64,
    version: u64,
    _placeholder_id: String,
    picked_root: std::path::PathBuf,
) -> Result<GrantResult, String> {
    let grant = grant_store()?.lock().unwrap().grant_root(&window_label, doc_id, &picked_root)?;
    Ok(GrantResult { grants: vec![grant], rerender_doc_id: doc_id, rerender_version: version + 1 })
}

pub fn revoke_asset_grant_for_test(window_label: String, doc_id: u64, grant_id: AssetGrantId) -> Result<GrantResult, String> {
    grant_store()?.lock().unwrap().revoke(&window_label, doc_id, grant_id)?;
    Ok(GrantResult { grants: list_asset_grants_for_test(window_label, doc_id)?, rerender_doc_id: doc_id, rerender_version: 0 })
}

pub fn list_asset_grants_for_test(window_label: String, doc_id: u64) -> Result<Vec<AssetGrant>, String> {
    Ok(grant_store()?.lock().unwrap().list(&window_label, doc_id))
}

pub fn active_grant_roots_for_render(window_label: &str, doc_id: u64) -> Result<Vec<std::path::PathBuf>, String> {
    Ok(grant_store()?.lock().unwrap().active_roots(window_label, doc_id))
}
```

Export the new modules from `crates/pmd-app/src/preview/mod.rs`:

```rust
pub mod asset_scope;
pub mod grants;
pub mod image_workflow;
```

Every successful grant/revoke triggers rerender and async revalidation for affected documents in the same window/document context only.
Register `grant_asset_folder`, `revoke_asset_grant`, and `list_asset_grants` in `crates/pmd-app/src/main.rs`. In the same setup path, call `crate::preview::grants::init_grant_store(app.asset_protocol_scope()).expect("asset grant store")` before the first render command can run.
Modify `crates/pmd-app/src/cmd/render.rs` so every render appends active grant roots before resource resolution. This extends the Block 7 render command; keep Block 6 link registration and Block 7 async validation observe/spawn behavior intact:

```rust
let mut allowed_roots = snapshot.allowed_roots;
allowed_roots.extend(crate::preview::grants::active_grant_roots_for_render(window.label(), doc_id)?);
let result = crate::preview::render_pipeline::render_document(RenderRequest {
    doc_id,
    version,
    doc_path: snapshot.path.as_deref(),
    allowed_roots,
    markdown: markdown.clone(),
})?;
```

The resulting `ResourcePolicyReport.allowed_roots` must list the canonical document root plus active canonical grant roots, and blocked image decisions must become `allowed_local_scope` decisions after a successful grant and rerender.

- [ ] **Step 11.5: Implement UI actions**

`ui/src/local_asset_grants.ts` wires diagnostics and trust panel controls through registered actions:

```ts
import type { ActionContext } from "./actions.js";

export interface AssetGrant {
  id: number;
  window_label: string;
  doc_id: number;
  canonical_root: string;
}

export interface GrantResult {
  grants: AssetGrant[];
  rerender_doc_id: number;
  rerender_version: number;
}

export interface AssetGrantActionOptions {
  activeDocId: () => number | null;
  applyGrantList: (grants: AssetGrant[]) => void;
  rerenderCurrentDocument: (reason: "asset-grant" | "asset-revoke") => Promise<void>;
}

export async function loadAssetGrants(
  invoke: <T>(command: string, payload: unknown) => Promise<T>,
  docId: number
): Promise<AssetGrant[]> {
  return invoke<AssetGrant[]>("list_asset_grants", { docId });
}

export function registerAssetGrantActions(
  context: ActionContext,
  invoke: <T>(command: string, payload: unknown) => Promise<T>,
  options: AssetGrantActionOptions
) {
  async function rerenderIfStillCurrent(result: GrantResult, reason: "asset-grant" | "asset-revoke") {
    if (options.activeDocId() !== result.rerender_doc_id) return;
    options.applyGrantList(result.grants);
    await options.rerenderCurrentDocument(reason);
  }

  return {
    async grantFolder(docId: number, version: number, placeholderId: string) {
      if (!context.isEnabled("asset.grantFolder")) return;
      const result = await invoke<GrantResult>("grant_asset_folder", { docId, version, placeholderId });
      await rerenderIfStillCurrent(result, "asset-grant");
    },
    async revokeGrant(docId: number, grantId: number) {
      if (!context.isEnabled("asset.revokeGrant")) return;
      const result = await invoke<GrantResult>("revoke_asset_grant", { docId, grantId });
      await rerenderIfStillCurrent(result, "asset-revoke");
    },
  };
}
```

Register `asset.grantFolder` and `asset.revokeGrant` in `ui/src/actions.ts`. Wire diagnostics primary action buttons and resource policy panel revoke controls to these action ids, not to ad hoc click handlers. In `ui/src/main.ts`, pass:

```ts
async function refreshAssetGrantsForActiveDoc(): Promise<void> {
  const docId = store.activeDoc()?.docId ?? null;
  if (docId === null) {
    trustPolicyPanel.setActiveGrants([]);
    return;
  }
  const grants = await loadAssetGrants(invoke, docId);
  if (store.activeDoc()?.docId === docId) {
    trustPolicyPanel.setActiveGrants(grants);
  }
}

const assetGrantActions = registerAssetGrantActions(actionContext, invoke, {
  activeDocId: () => store.activeDoc()?.docId ?? null,
  applyGrantList: (grants) => {
    trustPolicyPanel.setActiveGrants(grants);
  },
  rerenderCurrentDocument: async () => {
    await scheduleRender();
  },
});
```

Extend `ui/src/trust_policy_panel.ts` with `setActiveGrants(grants: AssetGrant[])`; revoke buttons are rendered from those backend-owned grant ids and call `assetGrantActions.revokeGrant(activeDocId, grant.id)`. Call `refreshAssetGrantsForActiveDoc()` after each accepted render, after active tab changes, and after grant/revoke results so the resource policy panel always lists the backend's active grants before offering revocation.

Do not use `document.reloadFromDisk` for grant or revoke recovery. Grant/revoke must re-render the current editor buffer, preserving dirty unsaved edits, and the spawned async validation from `render_cmd` must then produce the enriched diagnostics for the new render version.

- [ ] **Step 11.6: Verify**

```bash
cargo test -p pmd-app --test asset_grants -j 2
cargo check -p pmd-e2e --tests -j 2
cd ui && npm run test:unit
cd ui && npm run typecheck
cd ui && npm run test:e2e:playwright -- e2e/trust-policy.spec.cjs --grep "Grant Folder|revocation"
```

Expected: all commands pass.

- [ ] **Step 11.7: Review, commit, and merge**

```bash
ccc --yolo @cx-reviewer "Review asset grants for session scoping, symlink safety, Tauri asset scope revocation, and UI recovery behavior. Treat WebView load/navigation security PASS as provisional until Block 12 WebDriver sentinels run. Return PASS or blockers."
```

If the reviewer returns anything other than `PASS`, fix the findings and rerun Step 11.7. After `PASS`, run:

```bash
git status --short
git add crates/pmd-app/src/preview/grants.rs crates/pmd-app/src/preview/asset_scope.rs crates/pmd-app/src/preview/mod.rs crates/pmd-app/src/preview/resource_policy.rs crates/pmd-app/src/preview/contracts.rs crates/pmd-app/src/cmd/render.rs crates/pmd-app/src/main.rs crates/pmd-app/src/preview/image_workflow.rs crates/pmd-app/tests/asset_grants.rs ui/src/local_asset_grants.ts ui/src/diagnostics_panel.ts ui/src/trust_policy_panel.ts ui/src/actions.ts ui/src/main.ts crates/pmd-e2e/tests/asset_grants.rs ui/e2e/trust-policy.spec.cjs ui/e2e/helpers.cjs ui/tsconfig.json
git commit -m "feat(app): add recoverable local asset grants"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-asset-grants
```

## Block 12: Navigation Sentinels and Accessibility Gate

**Worktree:** `.worktrees/dit-accessibility-e2e`

**Owner:** accessibility/e2e worker with security reviewer subagent.

**Files:**

- Create: `crates/pmd-e2e/tests/navigation_policy.rs`
- Modify: `crates/pmd-e2e/tests/helpers/mod.rs`
- Create: `crates/pmd-app/src/navigation_policy.rs`
- Modify: `crates/pmd-app/src/main.rs`
- Modify: `crates/pmd-app/src/lib.rs`
- Modify: `crates/pmd-app/tauri.conf.json`
- Test: `crates/pmd-app/tests/navigation_policy.rs`
- Create: `ui/e2e/accessibility.spec.cjs`
- Integration-owner modify: `ui/e2e/helpers.cjs`
- Modify: `ui/e2e/document-intelligence.spec.cjs`
- Integration-owner modify: `ui/e2e/trust-policy.spec.cjs`
- Modify: `ui/e2e/commands-keybindings.spec.cjs`
- Integration-owner modify: `ui/styles/components.css`
- Integration-owner modify: `ui/styles/base.css`

- [ ] **Step 12.1: Write WebView navigation/fetch sentinel tests**

`crates/pmd-e2e/tests/navigation_policy.rs` must prove:

- remote image Markdown does not create a WebView network request.
- `file://` image Markdown does not create a WebView file request.
- clicking a source-authored external link does not navigate the WebView.
- keyboard activation of a source-authored external link does not navigate the WebView.
- middle-click, context-menu open, and dragstart do not create raw URL navigation, downloads, clipboard data, or new windows.
- WebView navigation/new-window attempts from document content are denied; this slice issues no safe WebView-navigation tokens.
- debug/e2e localhost or `127.0.0.1` navigation attempts from document content are denied unless they are the exact initial app-shell load; host-only localhost allowlists are forbidden.
- external open happens only after backend confirmation.

Include:

```rust
#[tokio::test]
async fn remote_and_file_images_do_not_create_webview_requests() {
    let app = pmd_e2e::helpers::spawn_app_with_network_probe().await.unwrap();
    app.open_markdown("![remote](https://example.com/a.png)\n\n![file](file:///etc/passwd)")
        .await
        .unwrap();

    app.wait_for_text("Remote image blocked").await.unwrap();
    assert!(!app.network_requests().await.iter().any(|url| url.contains("example.com/a.png")));
    assert!(!app.network_requests().await.iter().any(|url| url.starts_with("file:///")));
    assert!(!app.image_load_attempts().await.iter().any(|url| url.contains("example.com/a.png")));
    assert!(!app.image_load_attempts().await.iter().any(|url| url.starts_with("file:///")));
}

#[tokio::test]
async fn source_authored_external_link_does_not_navigate_before_confirmation() {
    let app = pmd_e2e::helpers::spawn_app_with_network_probe().await.unwrap();
    app.open_markdown("[Open](https://example.com/path)").await.unwrap();

    app.click_preview_link("Open").await.unwrap();
    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    app.wait_for_text("Open external link").await.unwrap();
    assert!(!app.external_open_log().await.iter().any(|url| url.contains("example.com/path")));

    app.confirm_external_link().await.unwrap();
    assert!(app.external_open_log().await.iter().any(|url| url == "https://example.com/path"));
}

#[tokio::test]
async fn all_preview_link_activation_paths_are_backend_mediated() {
    let app = pmd_e2e::helpers::spawn_app_with_network_probe().await.unwrap();
    app.open_markdown("[Open](https://example.com/path)").await.unwrap();

    app.focus_preview_link("Open").await.unwrap();
    app.press_key("Enter").await.unwrap();
    app.middle_click_preview_link("Open").await.unwrap();
    app.context_menu_preview_link("Open").await.unwrap();
    app.drag_preview_link("Open").await.unwrap();

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(app.new_window_log().await.is_empty());
    assert!(app.download_log().await.is_empty());
    assert!(!app.network_requests().await.iter().any(|url| url.contains("example.com/path")));
    assert_eq!(
        app.link_activation_log().await,
        vec!["keyboard", "auxiliary", "context_menu", "drag"]
    );
}

#[tokio::test]
async fn document_originated_webview_navigation_is_denied_without_backend_token() {
    let app = pmd_e2e::helpers::spawn_app_with_network_probe().await.unwrap();
    app.open_markdown(r#"<script>location.href='https://example.com/escape'</script>"#)
        .await
        .unwrap();

    app.force_document_navigation_attempt_for_test("https://example.com/escape")
        .await
        .unwrap();

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(!app.network_requests().await.iter().any(|url| url.contains("example.com/escape")));
}

#[tokio::test]
async fn document_originated_localhost_navigation_is_denied_in_debug_harness() {
    let app = pmd_e2e::helpers::spawn_app_with_network_probe().await.unwrap();
    app.open_markdown(r#"<a data-pmd-link-id="spoof" href="http://127.0.0.1:4444/escape">local</a>"#)
        .await
        .unwrap();

    app.force_document_navigation_attempt_for_test("http://127.0.0.1:4444/escape")
        .await
        .unwrap();
    app.force_document_navigation_attempt_for_test("http://localhost:4444/escape")
        .await
        .unwrap();

    assert_eq!(app.current_webview_url().await.unwrap(), app.app_url());
    assert!(!app.network_requests().await.iter().any(|url| url.contains("127.0.0.1:4444/escape")));
    assert!(!app.network_requests().await.iter().any(|url| url.contains("localhost:4444/escape")));
}
```

Modify `crates/pmd-e2e/tests/helpers/mod.rs` with the helper API used above:

```rust
pub struct ProbedApp {
    session: WebDriverSession,
    app_url: String,
}

pub async fn spawn_app_with_network_probe() -> Result<ProbedApp> {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])?;
    let app_url = session.url()?;
    let app = ProbedApp { session, app_url };
    app.install_probe().await?;
    Ok(app)
}

impl ProbedApp {
    async fn install_probe(&self) -> Result<()> {
        self.session.execute_script(
            r#"
            const done = arguments[arguments.length - 1];
            window.__pmdE2e = { network: [], imageLoads: [], external: [], newWindows: [], downloads: [], activations: [] };
            const originalFetch = window.fetch.bind(window);
            window.fetch = (...args) => {
              window.__pmdE2e.network.push(String(args[0]));
              return originalFetch(...args);
            };
            const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
            Object.defineProperty(HTMLImageElement.prototype, 'src', {
              configurable: true,
              get() { return imageSrc?.get?.call(this) ?? this.getAttribute('src') ?? ''; },
              set(value) {
                window.__pmdE2e.imageLoads.push(String(value));
                if (imageSrc?.set) imageSrc.set.call(this, value);
                else this.setAttribute('src', value);
              },
            });
            const recordImageNode = (node) => {
              if (node instanceof HTMLImageElement && node.getAttribute('src')) {
                window.__pmdE2e.imageLoads.push(node.getAttribute('src'));
              }
            };
            new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                  recordImageNode(node);
                  node.querySelectorAll?.('img[src]')?.forEach(recordImageNode);
                }
              }
            }).observe(document.documentElement, { childList: true, subtree: true });
            const originalOpen = window.open;
            window.open = (url, ...rest) => {
              window.__pmdE2e.newWindows.push(String(url));
              return null;
            };
            document.addEventListener('pmd-link-activation', (event) => {
              window.__pmdE2e.activations.push(String(event.detail?.activationKind || 'unknown'));
            }, true);
            document.addEventListener('pmd-external-open', (event) => {
              window.__pmdE2e.external.push(String(event.detail?.url || ''));
            }, true);
            document.addEventListener('dragstart', (event) => {
              if (event.dataTransfer?.types?.length) window.__pmdE2e.downloads.push(Array.from(event.dataTransfer.types).join(','));
            }, true);
            done(true);
            "#,
            &[],
        )?;
        Ok(())
    }

    pub async fn open_markdown(&self, markdown: &str) -> Result<()> {
        self.session.execute_script(
            r#"
            const markdown = arguments[0];
            const done = arguments[arguments.length - 1];
            const view = document.querySelector('.cm-editor')?.cmView?.view;
            if (!view) { done('missing-editor'); return; }
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } });
            view.focus();
            setTimeout(() => done('ok'), 250);
            "#,
            &[json!(markdown)],
        )?;
        Ok(())
    }

    pub async fn wait_for_text(&self, text: &str) -> Result<()> {
        self.session.wait_for_condition(&format!("text `{text}`"), Duration::from_secs(5), || {
            let found = self.session.execute_script(
                "const text = arguments[0]; const done = arguments[arguments.length - 1]; done(document.body.innerText.includes(text));",
                &[json!(text)],
            )?;
            Ok(found.as_bool() == Some(true))
        })
    }

    pub fn app_url(&self) -> String { self.app_url.clone() }
    pub async fn current_webview_url(&self) -> Result<String> { self.session.url() }
    pub async fn network_requests(&self) -> Vec<String> { self.read_probe_array("network").await.unwrap_or_default() }
    pub async fn image_load_attempts(&self) -> Vec<String> { self.read_probe_array("imageLoads").await.unwrap_or_default() }
    pub async fn external_open_log(&self) -> Vec<String> { self.read_probe_array("external").await.unwrap_or_default() }
    pub async fn new_window_log(&self) -> Vec<String> { self.read_probe_array("newWindows").await.unwrap_or_default() }
    pub async fn download_log(&self) -> Vec<String> { self.read_probe_array("downloads").await.unwrap_or_default() }
    pub async fn link_activation_log(&self) -> Vec<String> { self.read_probe_array("activations").await.unwrap_or_default() }

    async fn read_probe_array(&self, field: &str) -> Result<Vec<String>> {
        let value = self.session.execute_script(
            "const field = arguments[0]; const done = arguments[arguments.length - 1]; done(window.__pmdE2e?.[field] || []);",
            &[json!(field)],
        )?;
        Ok(value.as_array().cloned().unwrap_or_default().into_iter().filter_map(|v| v.as_str().map(ToOwned::to_owned)).collect())
    }

    pub async fn click_preview_link(&self, label: &str) -> Result<()> { self.dispatch_preview_link(label, "click").await }
    pub async fn focus_preview_link(&self, label: &str) -> Result<()> { self.dispatch_preview_link(label, "focus").await }
    pub async fn middle_click_preview_link(&self, label: &str) -> Result<()> { self.dispatch_preview_link(label, "auxclick").await }
    pub async fn context_menu_preview_link(&self, label: &str) -> Result<()> { self.dispatch_preview_link(label, "contextmenu").await }
    pub async fn drag_preview_link(&self, label: &str) -> Result<()> { self.dispatch_preview_link(label, "dragstart").await }

    async fn dispatch_preview_link(&self, label: &str, event_name: &str) -> Result<()> {
        self.session.execute_script(
            r#"
            const label = arguments[0];
            const eventName = arguments[1];
            const done = arguments[arguments.length - 1];
            const node = Array.from(document.querySelectorAll('[data-pmd-link-id]')).find((el) => el.textContent.includes(label));
            if (!node) { done('missing-link'); return; }
            if (eventName === 'focus') node.focus();
            else node.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, button: eventName === 'auxclick' ? 1 : 0 }));
            setTimeout(() => done('ok'), 100);
            "#,
            &[json!(label), json!(event_name)],
        )?;
        Ok(())
    }

    pub async fn press_key(&self, key: &str) -> Result<()> {
        self.session.execute_script(
            r#"
            const key = arguments[0];
            const done = arguments[arguments.length - 1];
            const target = document.activeElement?.matches?.('[data-pmd-link-id]')
              ? document.activeElement
              : document.querySelector('[data-pmd-link-id]');
            if (!target) { done('missing-link'); return; }
            target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            setTimeout(() => done('ok'), 100);
            "#,
            &[json!(key)],
        )?;
        Ok(())
    }

    pub async fn confirm_external_link(&self) -> Result<()> {
        self.session.execute_script(
            "const done = arguments[arguments.length - 1]; document.querySelector('[data-testid=\"confirm-external-open\"], .pmd-confirm-external button')?.click(); setTimeout(() => done('ok'), 100);",
            &[],
        )?;
        Ok(())
    }

    pub async fn force_document_navigation_attempt_for_test(&self, url: &str) -> Result<()> {
        self.session.execute_script(
            "const url = arguments[0]; const done = arguments[arguments.length - 1]; window.location.assign(url); setTimeout(() => done('ok'), 100);",
            &[json!(url)],
        )?;
        Ok(())
    }
}
```

Block 6 must dispatch the `pmd-link-activation` and `pmd-external-open` DOM events in test builds immediately before sending the backend command and after confirmed external open respectively. The events carry only `{ activationKind }` and `{ url }` and are guarded by `if (window.__pmdE2e)`.

- [ ] **Step 12.2: Install production WebView navigation guards**

Create `crates/pmd-app/src/navigation_policy.rs`:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NavigationVerdict {
    AllowInitialAppShell,
    DenyDocumentNavigation,
}

pub struct NavigationGate {
    app_shell_url: Url,
    initial_app_shell_pending: AtomicBool,
}

impl NavigationGate {
    pub fn new(app_shell_url: Url) -> Self {
        Self {
            app_shell_url,
            initial_app_shell_pending: AtomicBool::new(true),
        }
    }

    pub fn classify(&self, url: &Url) -> NavigationVerdict {
        if same_app_shell_url(url, &self.app_shell_url)
            && self.initial_app_shell_pending.swap(false, Ordering::SeqCst)
        {
            NavigationVerdict::AllowInitialAppShell
        } else {
            NavigationVerdict::DenyDocumentNavigation
        }
    }

    pub fn should_allow_navigation(&self, url: &Url) -> bool {
        self.classify(url) == NavigationVerdict::AllowInitialAppShell
    }
}

pub fn same_app_shell_url(candidate: &Url, app_shell: &Url) -> bool {
    candidate.scheme() == app_shell.scheme()
        && candidate.host_str() == app_shell.host_str()
        && candidate.port_or_known_default() == app_shell.port_or_known_default()
        && candidate.path() == app_shell.path()
        && candidate.query().is_none()
}
```

Do not allow navigation based only on scheme or host. In dev/e2e builds, `localhost` and `127.0.0.1` URLs are allowed only when they exactly match the captured app-shell URL including scheme, host, port, and path, and only for the initial app-shell load. This slice issues no backend WebView-navigation tokens; external links open through the OS default-app path after confirmation instead of navigating the WebView.

Modify `crates/pmd-app/src/lib.rs` or the existing module root to expose:

```rust
pub mod navigation_policy;
```

Modify `crates/pmd-app/tauri.conf.json` so the configured window list is empty; the main window is built in Rust so every platform gets `on_navigation` and `on_new_window` handlers:

```json
"app": {
  "windows": [],
  "security": {
    "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'self'",
    "assetProtocol": {
      "enable": true,
      "scope": []
    }
  }
}
```

Modify `crates/pmd-app/src/main.rs`:

```rust
use pmd_app_lib::{cli, cmd, navigation_policy, path_scope::PathScope, AppState};
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
```

Replace the existing `.setup(move |app| { ... })` body with this explicit main-window setup:

```rust
.setup(move |app| {
    pmd_app_lib::preview::grants::init_grant_store(app.asset_protocol_scope()).expect("asset grant store");
    let app_shell_url = tauri::Url::parse("tauri://localhost/index.html").expect("app shell URL");
    let navigation_gate = Arc::new(navigation_policy::NavigationGate::new(app_shell_url));
    let gate_for_navigation = navigation_gate.clone();

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("preview-md")
        .inner_size(1100.0, 720.0)
        .decorations(true)
        .on_navigation(move |url| gate_for_navigation.should_allow_navigation(url))
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .build()?;

    if let Some(ref p) = args.initial_path {
        let _ = app.emit("open-file", p.to_string_lossy().to_string());
    }
    if let Some(base) = pmd_app_lib::state::settings::load().browser_base_dir {
        if let Err(e) = app.state::<AppState>().scope.allow_dir(&base) {
            eprintln!("[preview-md] could not re-admit browser base {}: {e}", base.display());
        }
    }
    Ok(())
})
```

Add `crates/pmd-app/tests/navigation_policy.rs` for the pure policy helper:

```rust
#[test]
fn navigation_policy_denies_document_external_urls() {
    let external = "https://example.com/escape".parse().unwrap();
    let app_shell = "tauri://localhost/index.html".parse().unwrap();
    let gate = pmd_app_lib::navigation_policy::NavigationGate::new(app_shell);
    assert!(!gate.should_allow_navigation(&external));
}

#[test]
fn navigation_policy_allows_only_exact_initial_app_shell_url_once() {
    let app_shell = "tauri://localhost/index.html".parse().unwrap();
    let gate = pmd_app_lib::navigation_policy::NavigationGate::new(app_shell);

    let exact = "tauri://localhost/index.html".parse().unwrap();
    let second = "tauri://localhost/index.html".parse().unwrap();
    let localhost = "http://127.0.0.1:4444/escape".parse().unwrap();

    assert!(gate.should_allow_navigation(&exact));
    assert!(!gate.should_allow_navigation(&second));
    assert!(!gate.should_allow_navigation(&localhost));
}
```

The Block 12 e2e tests remain the release gate because they prove the Tauri handlers are actually installed in the running WebView.
If the actual dev-server app-shell URL differs from `tauri://localhost/index.html`, capture that exact URL including port from Tauri configuration or the built window and pass it into `NavigationGate::new`; do not replace the exact match with a host-only localhost allowlist.
This first slice does not issue any backend token that authorizes WebView navigation; backend-mediated external opens use the OS default-app path from Block 6, so every post-load WebView navigation attempt and every new-window request is denied.

- [ ] **Step 12.3: Write accessibility e2e tests**

Create tests in `ui/e2e/accessibility.spec.cjs` for:

- F10 focuses menu.
- toolbar, menu, tabs, outline, diagnostics, command overlay, shortcut editor, and trust panel are keyboard reachable.
- `Esc` closes overlays and restores focus.
- focus ring is visible in all bundled themes.
- high contrast and large text do not clip key labels.
- reduced motion disables nonessential transitions.
- file-browser tree rows use keyboardable tree semantics.

Include:

```js
test('new surfaces are keyboard reachable and restore focus', async ({ page }) => {
  await openMarkdown(page, '# One\n\n## Two\n\n![missing](missing.png)');
  await page.keyboard.press('Control+Shift+O');
  await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Outline' })).toHaveCount(0);

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toHaveCount(0);

  await page.keyboard.press('Control+Shift+M');
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toBeVisible();
  await page.keyboard.press('F10');
  await expect(page.getByRole('menubar')).toBeFocused();
});

test('high contrast large text and reduced motion keep controls usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await openMarkdown(page, '# One\n\n[broken](missing.md)');
  await page.addStyleTag({ content: 'html { font-size: 22px; }' });
  await expect(page.getByRole('button', { name: /Diagnostics/ })).toBeVisible();
  await expect(page.locator('.pmd-focus-ring-clipping-sentinel')).toHaveCount(0);
});
```

- [ ] **Step 12.4: Apply required accessibility support**

Make focused changes only to UI modules that own the tested surface. Do not restructure main layout.

Set these roles/names in the owning modules:

- command overlay: `role="dialog"` with accessible name `Command overlay`.
- shortcut editor: `role="dialog"` with accessible name `Keyboard shortcuts`.
- outline: `role="tree"` or `navigation` with labelled heading list.
- file browser: `role="tree"` with `treeitem` rows.
- diagnostics panel: labelled region with issue count.
- icon-only buttons: `aria-label` and tooltip text.

Apply these concrete helpers where the owning module creates controls:

```ts
export function labelIconButton(button: HTMLButtonElement, label: string, tooltip = label) {
  button.setAttribute("aria-label", label);
  button.title = tooltip;
}

export function markDialog(element: HTMLElement, label: string) {
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", label);
}

export function markRegion(element: HTMLElement, label: string) {
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", label);
}
```

Add stable CSS to `ui/styles/components.css`:

```css
.pmd-command-overlay,
.pmd-shortcut-editor,
.pmd-diagnostics-panel,
.pmd-trust-policy-panel {
  max-width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
}

.pmd-icon-button:focus-visible,
.pmd-command-row:focus-visible,
.pmd-shortcut-row input:focus-visible,
.pmd-outline [role="treeitem"]:focus-visible {
  outline: 2px solid var(--pmd-focus-ring, #0969da);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .pmd-command-overlay,
  .pmd-shortcut-editor,
  .pmd-diagnostics-panel,
  .pmd-trust-policy-panel {
    transition: none;
    animation: none;
  }
}
```

Add a final clipping sentinel check in `ui/e2e/accessibility.spec.cjs` by computing bounding boxes for focusable controls and appending `.pmd-focus-ring-clipping-sentinel` only when a focused control clips outside the viewport.

- [ ] **Step 12.5: Verify all e2e and non-e2e gates**

```bash
just check
cargo test -p pmd-app --test navigation_policy -j 2
cd ui && npm run test:e2e:playwright -- e2e/document-intelligence.spec.cjs
cd ui && npm run test:e2e:playwright -- e2e/trust-policy.spec.cjs
cd ui && npm run test:e2e:playwright -- e2e/commands-keybindings.spec.cjs
cd ui && npm run test:e2e:playwright -- e2e/accessibility.spec.cjs
cargo check -p pmd-e2e --tests -j 2
```

Start the WebDriver/container harness and run the Rust e2e suite:

```bash
just e2e
```

Expected: `just check`, UI Playwright specs, `cargo check -p pmd-e2e --tests`, and `just e2e` pass. A local Docker/WebDriver failure blocks final security PASS until the harness runs successfully in this checkout or in CI; do not replace the navigation-policy sentinel run with `cargo check`.

- [ ] **Step 12.6: Final cx review**

```bash
ccc --yolo @cx-reviewer "Review the complete Document Intelligence + Visible Trust implementation against docs/superpowers/specs/2026-05-30-document-intelligence-visible-trust-design.md and this plan. Check security, accessibility, tests, stale-result handling, worktree integration, and missing requirements. Return PASS or concrete blockers."
```

Repeat review/fix until `PASS`.

- [ ] **Step 12.7: Commit and merge**

```bash
git add crates/pmd-e2e/tests/navigation_policy.rs crates/pmd-e2e/tests/helpers/mod.rs crates/pmd-app/src/navigation_policy.rs crates/pmd-app/src/main.rs crates/pmd-app/src/lib.rs crates/pmd-app/tauri.conf.json crates/pmd-app/tests/navigation_policy.rs ui/e2e/accessibility.spec.cjs ui/e2e/helpers.cjs ui/e2e/document-intelligence.spec.cjs ui/e2e/trust-policy.spec.cjs ui/e2e/commands-keybindings.spec.cjs ui/styles/components.css ui/styles/base.css
git commit -m "test(e2e): gate trust navigation and accessibility"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
INTEGRATION_ROOT="$(cd "$WORKTREE_ROOT/../.." && pwd -P)"
INTEGRATION_BRANCH="$(git -C "$INTEGRATION_ROOT" branch --show-current)"
test -n "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" switch "$INTEGRATION_BRANCH"
git -C "$INTEGRATION_ROOT" merge --no-ff work/dit-accessibility-e2e
```

## Final Integration Checklist

- [ ] `git status --short` is clean on the integration branch.
- [ ] `git log --oneline --decorate -12` shows each block merge.
- [ ] `just check` passes.
- [ ] UI e2e specs for document intelligence, trust policy, commands/keybindings, and accessibility pass.
- [ ] `cargo check -p pmd-e2e --tests -j 2` passes.
- [ ] `just e2e` passes, including `crates/pmd-e2e/tests/navigation_policy.rs`.
- [ ] `ccc --yolo @cx-reviewer` returns `PASS` for the final integrated diff.
- [ ] The final user-facing status includes the commands run and pass/fail outcomes.

---

## Self-Review

Spec coverage check:

- Shared contracts and render-time `DocumentFacts`: Blocks 1-4.
- Resource policy and visible trust boundary: Blocks 4-6, 10, and 12.
- Async local validation, budgets, stale-result handling, and cache invalidation: Block 7.
- Action registry, command overlay, shortcut persistence, and no-default action indexing: Block 8.
- Outline panel and newest-wins UI fact store: Block 9.
- Diagnostics panel, inline one-line issues, and clean-state hidden panel behavior: Block 10.
- Session asset grants, revocation, active allowed roots, and future image workflow foundation: Block 11.
- WebView navigation/image-load sentinels and accessibility gates: Block 12.

Placeholder scan: the standard red-flag regex from the review command was rerun after the last review-fix pass. Expected result is an empty match set.

Type consistency check:

- Rust/TypeScript contracts use snake_case backend field names across `RenderResult`, `DocumentFacts`, `DocumentDiagnostics`, `ResourcePolicyReport`, `ResourceDecision`, and `LinkValidationSummary`.
- `block-{n}`, `image-{n}`, `data-pmd-image-id`, and `data-pmd-link-id` identifiers are stable across `pmd-core`, `pmd-app`, UI handlers, and e2e probes.
- Shortcut action ids use `help.shortcuts`, `navigate.commandOverlay`, `navigate.outline`, `diagnostics.togglePanel`, `asset.grantFolder`, and `asset.revokeGrant` consistently.
- Asset grants use canonical roots from the backend grant store and are appended to `ResourcePolicyContext.allowed_roots` before rerender.
- Async diagnostics carry `(doc_id, version)`, are emitted as full enriched replacements, and are dropped in the UI when they no longer match the active render.
