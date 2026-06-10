import test from "node:test";
import assert from "node:assert/strict";
import { createTabStore, type NewDocTab } from "./tabs.ts";

const clean = { kind: "clean", base: "00" } as const;

function doc(overrides: Partial<NewDocTab> = {}): NewDocTab {
  return {
    docId: overrides.docId ?? 1,
    filePath: overrides.filePath ?? "/work/readme.md",
    title: overrides.title ?? "readme.md",
    mode: overrides.mode ?? "split",
    fileState: overrides.fileState ?? clean,
    baseContent: overrides.baseContent ?? "# Readme",
    editorState: overrides.editorState ?? null,
    trustContext: overrides.trustContext ?? null,
  };
}

test("document tabs are pinned by default", () => {
  const store = createTabStore();
  const tab = store.addDoc(doc());

  assert.equal(tab.pinned, true);
});

test("document tabs can be added as unpinned preview tabs and later pinned", () => {
  const store = createTabStore();
  const tab = store.addDoc(doc({ docId: 7, filePath: "/work/a.md", title: "a.md" }), {
    pinned: false,
  });

  assert.equal(tab.pinned, false);

  store.updateDoc(tab.id, { pinned: true });

  assert.equal(store.activeDoc()?.pinned, true);
});
