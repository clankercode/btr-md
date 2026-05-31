import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveDiagnosticsPresentation } from "./diagnostics.ts";
import type { DocumentDiagnostics, DocumentIssue } from "./document_contracts.ts";
import { createDocumentFactsStore } from "./document_facts_store.ts";

function issue(
  id: string,
  severity: DocumentIssue["severity"],
  category: DocumentIssue["category"],
  detail: string | null = "fix the path",
): DocumentIssue {
  return {
    id,
    severity,
    category,
    message: `${category} ${severity}`,
    line_start: 1,
    line_end: 1,
    block_id: null,
    detail,
    primary_action: null,
  };
}

function emptyResourcePolicyReport(doc_id: number, version: number) {
  return { doc_id, version, allowed_roots: [], loaded_resources: [], decisions: [] };
}

function emptyLinkSummary() {
  return { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 };
}

function diagnostics(issues: DocumentIssue[], version = 1): DocumentDiagnostics {
  return {
    doc_id: 1,
    version,
    phase: "enriched",
    issues,
    resources: emptyResourcePolicyReport(1, version),
    link_summary: emptyLinkSummary(),
  };
}

test("clean diagnostics hide the panel", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([]), {
    inlineDetail: true,
    panelExpanded: false,
  });

  assert.equal(state.panelVisible, false);
  assert.equal(state.collapsedIndicatorVisible, false);
});

test("issues show collapsed indicator when panel is collapsed", () => {
  const state = deriveDiagnosticsPresentation(diagnostics([issue("missing", "error", "image")]), {
    inlineDetail: true,
    panelExpanded: false,
  });

  assert.equal(state.panelVisible, false);
  assert.equal(state.collapsedIndicatorVisible, true);
  assert.equal(state.counts.error, 1);
});

test("expanded panel groups by severity and category", () => {
  const state = deriveDiagnosticsPresentation(
    diagnostics([
      issue("missing-image", "error", "image"),
      issue("blocked-image", "blocked", "resource_policy"),
      issue("frontmatter", "warning", "frontmatter"),
      issue("info", "info", "link"),
    ]),
    { inlineDetail: true, panelExpanded: true },
  );

  assert.equal(state.panelVisible, true);
  assert.deepEqual(state.counts, { error: 1, blocked: 1, warning: 1, info: 1 });
  assert.deepEqual(
    state.groups.map((group) => `${group.severity}:${group.category}`),
    ["error:image", "blocked:resource_policy", "warning:frontmatter", "info:link"],
  );
});

test("inline detail can be hidden while keeping one-line markers", () => {
  const state = deriveDiagnosticsPresentation(
    diagnostics([issue("missing", "error", "image", "longer detail")]),
    { inlineDetail: false, panelExpanded: false },
  );

  assert.equal(state.inlineIssues[0]?.message, "image error");
  assert.equal(state.inlineIssues[0]?.detail, null);
});

test("stale enriched diagnostics are rejected by the facts store", () => {
  const store = createDocumentFactsStore();
  store.accept({ doc_id: 1, version: 2, headings: [], diagnostics: diagnostics([], 2) });

  const accepted = store.acceptDiagnostics(diagnostics([issue("old", "error", "link")], 1));

  assert.equal(accepted, false);
  assert.equal(store.current(1)?.diagnostics?.issues.length, 0);
  assert.equal(store.current(1)?.version, 2);
});
