import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentFactsStore } from "./document_facts_store.ts";
import type { DocumentDiagnostics } from "./document_contracts.ts";

test("drops stale facts for older render versions", () => {
  const store = createDocumentFactsStore();
  store.accept({ doc_id: 1, version: 2, headings: [], diagnostics: null });
  store.accept({
    doc_id: 1,
    version: 1,
    headings: [
      {
        text: "Old",
        level: 1,
        slug: "old",
        duplicate_index: 0,
        line_start: 1,
        line_end: 1,
        block_id: "old",
      },
    ],
    diagnostics: null,
  });

  assert.equal(store.current(1)?.version, 2);
});

test("drops enriched diagnostics for inactive documents", () => {
  const store = createDocumentFactsStore();
  store.accept({ doc_id: 1, version: 1, headings: [], diagnostics: null });
  store.accept({ doc_id: 2, version: 1, headings: [], diagnostics: null });
  store.setActiveDoc(2);

  const accepted = store.acceptDiagnostics(diagnosticsForDoc(1, 1));

  assert.equal(accepted, false);
  assert.equal(store.current(1)?.diagnostics, null);
});

function diagnosticsForDoc(docId: number, version: number): DocumentDiagnostics {
  return {
    doc_id: docId,
    version,
    phase: "enriched",
    issues: [],
    resources: {
      doc_id: docId,
      version,
      allowed_roots: [],
      loaded_resources: [],
      decisions: [],
    },
    link_summary: {
      checked: 0,
      errors: 0,
      warnings: 0,
      unchecked_external: 0,
      pending_async: 0,
    },
  };
}
