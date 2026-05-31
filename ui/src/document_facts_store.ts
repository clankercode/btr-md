import type {
  DocumentDiagnostics,
  DocumentFacts,
  HeadingFact,
} from "./document_contracts.js";

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
