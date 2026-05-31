import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentFactsStore } from "./document_facts_store.ts";

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
