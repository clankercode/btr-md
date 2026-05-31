# Block 10 Diagnostics/Trust Preflight

Date: 2026-05-31
Repo: `/home/xertrov/src/preview-md`
Branch observed: `feat/large-expansion` with Blocks 1-8; Block 9 worktree `.worktrees/dit-outline` is present but currently only has an untracked `ui/src/document_facts_store.test.ts`.

## Ownership Split

Diagnostics/trust worker should own new pure/presentation modules and their direct tests:

- `ui/src/diagnostics.ts`
- `ui/src/diagnostics.test.ts`
- `ui/src/resource_policy.ts`
- `ui/src/resource_policy.test.ts`
- `ui/src/diagnostics_panel.ts`
- `ui/src/inline_issues.ts`
- `ui/src/trust_policy_panel.ts`
- initial additive styles for diagnostics/trust classes, if kept isolated and appended
- a draft `ui/e2e/trust-policy.spec.cjs` that targets stable test ids/roles

Integration owner should own merge-sensitive wiring and shared fixtures:

- `ui/src/main.ts`, because Block 9 also rewires render acceptance, facts storage, outline actions, and active-heading tracking.
- `ui/src/actions.ts`, because Block 8 already registers future action ids and Block 9 will replace `navigate.outline`; Block 10 should replace only `diagnostics.togglePanel`.
- `ui/e2e/helpers.cjs`, because Block 9 and Block 10 both replace the `render_cmd` mock contract.
- `ui/styles/components.css` and `ui/styles/base.css`, because Block 9 needs layout reservations for outline and Block 10 needs diagnostics/trust layout; these can easily fight over pane geometry.
- `ui/tsconfig.json`, because it has an explicit include list and both blocks append new files.
- `ui/dist/bundle.js` and `ui/dist/bundle.js.map`, because they are tracked build outputs and should be regenerated once after integration, not independently by every worker.

## Current Integration Points

Post-Block-8 `main.ts` still declares local render/diagnostic shapes. `RenderResult.diagnostics` is `unknown`, while `AsyncDocumentDiagnostics` is a local type. Block 10 must not lean on those temporary definitions; after Block 9 lands, import `RenderResult` and `DocumentDiagnostics` from `document_contracts.ts`.

Rendering currently gates preview DOM writes in `processRenderQueue()` using tab id, render sequence, doc id, result version, and active tab. It then updates `previewContent.innerHTML`, `dataset.versionApplied`, nonce markers, Mermaid, KaTeX, code blocks, and tables. Block 10 diagnostics should run only after this same current-result check succeeds, and after Block 9's facts-store acceptance succeeds.

Async diagnostics currently have a dead-end listener: `latestEnrichedDiagnostics` only stores payloads, and `renderDiagnostics()` does not update UI. The listener drops stale payloads by comparing active doc id and `previewContent.dataset.versionApplied`. After Block 9, this should move to `factsStore.acceptDiagnostics(event.payload)`, and Block 10 should delete the temporary map rather than maintaining a second newest-wins path.

Actions are already registered for `navigate.outline`, `diagnostics.togglePanel`, `asset.grantFolder`, and `asset.revokeGrant`. In current `runAction()`, these fall through to a status-only placeholder. Block 10 should replace `diagnostics.togglePanel` in the action-registry path, not add document-level shortcut listeners. After Block 9, integration should call `runDiagnosticsAction(id)` beside the outline hook before the placeholder switch cases.

Link activation is already backend-mediated. `attachPreviewLinkActivation()` strips `href`, `target`, `download`, and `ping`, calls `prepare_link_activation`, and `handleLinkActivationResponse()` opens the minimal external confirmation dialog for `external_confirmation`. Block 10 trust UI should either implement `ExternalConfirmationDialog` and pass it to the existing handler, or wrap the existing minimal dialog behavior without changing the backend confirmation contract: only the confirm button calls `confirm_external_open(docId, version, actionToken)`.

Chrome/status integration is currently centralized in `chrome.ts`: toolbar, fixed status bar, and body-level app container. Trust status can be a panel or toolbar/status item, but it should avoid overloading `chrome.setStatus()`, which is already used for lifecycle messages, action placeholders, errors, and link denials.

## After Block 9 Lands

Expect these Block 9 contracts to become the correct attachment points:

- `document_contracts.ts` exports snake_case backend DTOs, including `RenderResult`, `DocumentDiagnostics`, `DocumentIssue`, `ResourcePolicyReport`, `ResourceDecision`, `LinkValidationSummary`, and heading/fact types.
- `document_facts_store.ts` accepts full render snapshots and full diagnostic replacements. Its `acceptDiagnostics()` only accepts diagnostics matching the current stored version for that doc.
- `applyOutlineRender(result)` or its final equivalent will already call `factsStore.accept(...)` on accepted render results. Block 10 should avoid a second `factsStore.accept(...)` call for the same render if Block 9's implementation exposes a shared accepted snapshot. If the plan's sample remains literal, coordinate the combined accepted-render function so outline and diagnostics update from one acceptance.
- `ui/e2e/helpers.cjs` should already return complete render contracts. Block 10 should extend that one helper rather than re-replacing it from the plan snippet.
- `ui/tsconfig.json` should already include Block 9 files. Block 10 should append only its own new files.

## Test And E2E Pitfalls

Tracked bundle: `ui/dist/bundle.js` and `ui/dist/bundle.js.map` are tracked, while `npm run build` writes both from `ui/vendor/build-app.mjs`. A worker can defer bundle changes during isolated module work, but the integration owner should run `cd ui && npm run build` after Block 9 + 10 wiring and include the dist diff if repository policy expects checked-in UI bundles.

Newest-wins diagnostics: tests need to prove both stale initial render results and stale enriched events do not update diagnostics/trust UI. The subtle case is an enriched event for the active doc but old version after a newer preview has rendered; current code drops this via `dataset.versionApplied`, while post-Block-9 should drop via `factsStore.acceptDiagnostics()`.

Inline issue rendering: source-line placement is under-specified in current app state. The preview DOM has backend placeholders such as image placeholders and `data-pmd-block-id`, but no editor line decoration API is exposed from `main.ts`. Keep `inline_issues.ts` tolerant: render beside placeholder/block nodes when available and fall back to a compact preview-side list. Do not inject raw `source_target`, `normalized_target`, or unsafe URLs as attributes.

Panel visibility: plan tests say clean diagnostics hide the panel, while the action `diagnostics.togglePanel` exists globally. Avoid a toggled empty region that breaks "clean document hides diagnostics panel"; a clean state may show no diagnostics UI or a trust-only "Safe Preview" status, but not an empty diagnostics region.

Trust status semantics: missing local files are errors but not necessarily `Content Blocked`. Derive `Content Blocked` from blocked resource-policy decisions or blocked resource-policy issues, not from every diagnostic error.

External confirmation: current minimal dialog has `data-testid="confirm-external-open"` and role `dialog` with label "Open external link". Block 10 must preserve or intentionally alias this test hook because later WebDriver/e2e sentinels click it. The dialog must show destination context as text, never as a clickable anchor, and confirmation must still route through `confirm_external_open` with only `docId`, `version`, and backend token.

E2E mock events: helpers currently implement `plugin:event|listen` by returning callback ids and expose `__TAURI_INTERNALS__.runCallback`, but there is no ergonomic helper for emitting `pmd://diagnostics-enriched` during a test. Add one shared helper when testing newest-wins enriched diagnostics, or unit-test the facts-store gate and keep Playwright focused on initial render diagnostics.

Mock render contract drift: Block 9 and Block 10 plan snippets both replace `render_cmd`. Merge them into one helper that supports `renderFacts`, diagnostic fixtures, generated diagnostics from markdown, and external activation mocks. Otherwise the later block will erase outline support.

Timing: `openMarkdown()` in the plan waits by timeout after CodeMirror dispatch. Prefer waiting for a concrete visible selector/text where possible; the app debounces edits by 80 ms and has async rendering, so timeout-only tests will be fragile.

## Conflict Risks With Block 9

- `main.ts` is the main conflict surface: Block 9 will import contracts/store/outline, add accepted-render handling, and hook `navigate.outline`; Block 10 wants the same render path and action switch.
- `helpers.cjs` is the second highest risk: both blocks replace the same `render_cmd` branch and `addInitScript` argument object.
- `components.css`/`base.css` can conflict because outline, diagnostics, and trust panels all need stable reserved space around `#app-container`, `#preview-pane`, and the fixed status bar.
- `tsconfig.json` include-list edits are small but easy to conflict because the file deliberately does not glob `src/`.
- `ui/dist` should not be regenerated independently in Block 10 before Block 9 lands; it will create noisy bundle conflicts.

Delay until Block 9 is merged:

- Final `main.ts` wiring for `factsStore`, accepted render diagnostics, enriched diagnostics listener replacement, and `runDiagnosticsAction()`.
- Final `helpers.cjs` replacement for render contracts.
- Final layout reservations that depend on whether outline is docked, overlay-only, or appended to body.
- Any checked-in `ui/dist` regeneration.

Safe to start before Block 9 lands:

- Pure `diagnostics.ts` and `resource_policy.ts` modules against the planned `document_contracts.ts` types, with imports adjusted after Block 9.
- DOM components with narrow interfaces and no dependency on `main.ts`: diagnostics panel, inline issue renderer, and trust policy panel.
- Unit tests for presentation derivation and resource-policy model behavior.
- Draft e2e specs that document desired roles/test ids, while expecting helper/wiring edits to be integration-owner work.

## Top Recommendations

1. Treat `document_facts_store.ts` as the only post-Block-9 newest-wins gate; delete `latestEnrichedDiagnostics` during integration rather than layering over it.
2. Give diagnostics/trust worker pure modules and DOM components, but reserve `main.ts`, `helpers.cjs`, `tsconfig.json`, layout CSS merge, and `ui/dist` for integration owner.
3. Preserve the external confirmation backend contract and `confirm-external-open` test hook; improve the UI around it without rendering clickable external URLs.
4. Merge Block 9 and Block 10 e2e helper snippets into one full-contract mock, with explicit support for facts and diagnostics.
5. Add stale enriched-diagnostics coverage close to the store/unit layer, and keep Playwright tests focused on visible behavior to avoid brittle event plumbing.
