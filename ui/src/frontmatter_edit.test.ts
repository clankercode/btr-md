import test from "node:test";
import assert from "node:assert/strict";
import {
  locateBlock,
  hasOpeningFence,
  formatScalar,
  editValueChange,
  addEntryChange,
  insertBlockChange,
} from "./frontmatter_edit.ts";

const doc = "---\ntitle: Old\ntags: a, b\n---\n# Body\n";

test("locateBlock finds a closed YAML block", () => {
  assert.deepEqual(locateBlock(doc), { format: "yaml", startLine: 1, endLine: 3 });
});

test("hasOpeningFence distinguishes truly-absent from unclosed frontmatter", () => {
  assert.equal(hasOpeningFence("# Body\n"), false);
  assert.equal(hasOpeningFence("---\ntitle: x\n# Body\n"), true);
  assert.equal(hasOpeningFence("+++\n"), true);
  assert.equal(hasOpeningFence(doc), true);
});

test("locateBlock finds a closed TOML block", () => {
  const toml = "+++\ntitle = \"Old\"\n+++\n# Body\n";
  assert.deepEqual(locateBlock(toml), { format: "toml", startLine: 1, endLine: 2 });
});

test("locateBlock returns null when there is no opening fence", () => {
  assert.equal(locateBlock("# Body\n"), null);
});

test("locateBlock returns null for an unclosed block", () => {
  assert.equal(locateBlock("---\ntitle: x\n# Body\n"), null);
});

test("formatScalar TOML quotes strings, leaves numbers/bools bare", () => {
  assert.equal(formatScalar("toml", "my-slug"), '"my-slug"');
  assert.equal(formatScalar("toml", "42"), "42");
  assert.equal(formatScalar("toml", "true"), "true");
  assert.equal(formatScalar("toml", 'a"b'), '"a\\"b"');
});

test("formatScalar YAML leaves plain scalars bare, quotes when needed", () => {
  assert.equal(formatScalar("yaml", "my-slug"), "my-slug");
  assert.equal(formatScalar("yaml", "Hello World"), "Hello World");
  assert.equal(formatScalar("yaml", "a: b"), '"a: b"');
  assert.equal(formatScalar("yaml", " leading"), '" leading"');
  assert.equal(formatScalar("yaml", ""), '""');
});

test("editValueChange replaces only the value, preserving key + indent", () => {
  const change = editValueChange(doc, "title", "New Title");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: New Title\ntags: a, b\n---\n# Body\n");
});

test("editValueChange preserves a trailing inline comment", () => {
  const commented = "---\ntitle: Old # note\n---\n# Body\n";
  const change = editValueChange(commented, "title", "New");
  assert.ok(change);
  const next = commented.slice(0, change.from) + change.insert + commented.slice(change.to);
  assert.equal(next, "---\ntitle: New # note\n---\n# Body\n");
});

test("editValueChange does NOT treat a # inside an existing quoted value as a comment", () => {
  // Regression: `# 42` lives inside the quotes, so it must not be stripped/re-appended.
  const quoted = '---\ntitle: "Issue # 42"\n---\n# Body\n';
  const change = editValueChange(quoted, "title", "New");
  assert.ok(change);
  const next = quoted.slice(0, change.from) + change.insert + quoted.slice(change.to);
  assert.equal(next, "---\ntitle: New\n---\n# Body\n");
});

test("editValueChange keeps the real comment after a quoted value with an inner #", () => {
  const quoted = '---\ntitle: "Issue # 42" # real\n---\n# Body\n';
  const change = editValueChange(quoted, "title", "New");
  assert.ok(change);
  const next = quoted.slice(0, change.from) + change.insert + quoted.slice(change.to);
  assert.equal(next, "---\ntitle: New # real\n---\n# Body\n");
});

test("editValueChange YAML-quotes a value containing a colon", () => {
  const change = editValueChange(doc, "title", "a: b");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, '---\ntitle: "a: b"\ntags: a, b\n---\n# Body\n');
});

test("editValueChange returns null when there is no closable block", () => {
  assert.equal(editValueChange("---\ntitle: x\n# Body\n", "title", "y"), null);
});

test("editValueChange returns null when the key is absent", () => {
  assert.equal(editValueChange(doc, "slug", "x"), null);
});

test("addEntryChange inserts a new YAML entry before the closing fence", () => {
  const change = addEntryChange(doc, "slug", "my-slug");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: a, b\nslug: my-slug\n---\n# Body\n");
});

test("addEntryChange emits VALID quoted TOML", () => {
  const tomlDoc = "+++\ntitle = \"Old\"\n+++\n# Body\n";
  const change = addEntryChange(tomlDoc, "slug", "my-slug");
  assert.ok(change);
  const next = tomlDoc.slice(0, change.from) + change.insert + tomlDoc.slice(change.to);
  assert.equal(next, '+++\ntitle = "Old"\nslug = "my-slug"\n+++\n# Body\n');
});

test("addEntryChange returns null when there is no closable block", () => {
  assert.equal(addEntryChange("---\ntitle: x\n# Body\n", "slug", "y"), null);
});

test("editValueChange tags: comma input → YAML flow sequence (parser round-trips)", () => {
  const change = editValueChange(doc, "tags", "x, y");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: [x, y]\n---\n# Body\n");
});

test("editValueChange tags: trims and drops empty items", () => {
  const change = editValueChange(doc, "tags", " a , , b ,");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: [a, b]\n---\n# Body\n");
});

test("editValueChange tags: cleared input → empty sequence", () => {
  const change = editValueChange(doc, "tags", "  ");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: []\n---\n# Body\n");
});

test("editValueChange tags: quotes individual items only when needed", () => {
  const change = editValueChange(doc, "tags", "plain, a: b");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, '---\ntitle: Old\ntags: [plain, "a: b"]\n---\n# Body\n');
});

test("editValueChange tags: replaces a whole BLOCK sequence span (no orphaned items)", () => {
  const blockDoc = "---\ntitle: Old\ntags:\n  - a\n  - b\nslug: s\n---\n# Body\n";
  const change = editValueChange(blockDoc, "tags", "x, y");
  assert.ok(change);
  const next = blockDoc.slice(0, change.from) + change.insert + blockDoc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: [x, y]\nslug: s\n---\n# Body\n");
});

test("editValueChange tags: replaces a block span at the end of the frontmatter", () => {
  const blockDoc = "---\ntitle: Old\ntags:\n  - a\n  - b\n---\n# Body\n";
  const change = editValueChange(blockDoc, "tags", "x");
  assert.ok(change);
  const next = blockDoc.slice(0, change.from) + change.insert + blockDoc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: [x]\n---\n# Body\n");
});

test("editValueChange tags: TOML emits a flow array", () => {
  const tomlDoc = '+++\ntitle = "Old"\ntags = ["a"]\n+++\n# Body\n';
  const change = editValueChange(tomlDoc, "tags", "x, y");
  assert.ok(change);
  const next = tomlDoc.slice(0, change.from) + change.insert + tomlDoc.slice(change.to);
  assert.equal(next, '+++\ntitle = "Old"\ntags = ["x", "y"]\n+++\n# Body\n');
});

test("addEntryChange tags: comma input → YAML flow sequence", () => {
  const bodyDoc = "---\ntitle: Old\n---\n# Body\n";
  const change = addEntryChange(bodyDoc, "tags", "x, y");
  assert.ok(change);
  const next = bodyDoc.slice(0, change.from) + change.insert + bodyDoc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: [x, y]\n---\n# Body\n");
});

test("addEntryChange tags: TOML emits a flow array", () => {
  const tomlDoc = '+++\ntitle = "Old"\n+++\n# Body\n';
  const change = addEntryChange(tomlDoc, "tags", "x, y");
  assert.ok(change);
  const next = tomlDoc.slice(0, change.from) + change.insert + tomlDoc.slice(change.to);
  assert.equal(next, '+++\ntitle = "Old"\ntags = ["x", "y"]\n+++\n# Body\n');
});

test("insertBlockChange prepends a new YAML block at the top", () => {
  const bodyDoc = "# Body\n";
  const change = insertBlockChange(bodyDoc, "title", "New");
  const next = bodyDoc.slice(0, change.from) + change.insert + bodyDoc.slice(change.to);
  assert.equal(next, "---\ntitle: New\n---\n# Body\n");
});

test("insertBlockChange on an empty doc", () => {
  const change = insertBlockChange("", "title", "New");
  assert.equal(change.from, 0);
  assert.equal(change.to, 0);
  assert.equal(change.insert, "---\ntitle: New\n---\n");
});

test("edit/add work on a freshly inserted block with no facts available", () => {
  const start = "# Body\n";
  const ins = insertBlockChange(start, "title", "");
  const afterInsert = start.slice(0, ins.from) + ins.insert + start.slice(ins.to);
  assert.equal(afterInsert, "---\ntitle: \n---\n# Body\n");

  const edit = editValueChange(afterInsert, "title", "Hello");
  assert.ok(edit);
  const afterEdit = afterInsert.slice(0, edit.from) + edit.insert + afterInsert.slice(edit.to);
  assert.equal(afterEdit, "---\ntitle: Hello\n---\n# Body\n");

  const add = addEntryChange(afterEdit, "slug", "my-slug");
  assert.ok(add);
  const afterAdd = afterEdit.slice(0, add.from) + add.insert + afterEdit.slice(add.to);
  assert.equal(afterAdd, "---\ntitle: Hello\nslug: my-slug\n---\n# Body\n");
});
