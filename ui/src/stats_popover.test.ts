import test from "node:test";
import assert from "node:assert/strict";
import type { StructureCounts } from "./document_contracts.ts";
import { readingTimeMinutes, statsRows } from "./stats_popover.ts";

const counts: StructureCounts = {
  words: 450,
  bytes: 2600,
  sentences: 30,
  paragraphs: 12,
  headings: 5,
  links: 8,
  images: 2,
  code_blocks: 3,
  mermaid_blocks: 1,
  math_spans: 4,
  math_blocks: 1,
};

test("reading time is ceil(words / 200)", () => {
  assert.equal(readingTimeMinutes(450), 3);
  assert.equal(readingTimeMinutes(200), 1);
  assert.equal(readingTimeMinutes(201), 2);
});

test("reading time is 0 for 0 words", () => {
  assert.equal(readingTimeMinutes(0), 0);
});

test("statsRows maps StructureCounts fields plus reading time", () => {
  const rows = statsRows(counts);
  const byLabel = new Map(rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel.get("Words"), "450");
  assert.equal(byLabel.get("Bytes"), "2,600");
  assert.equal(byLabel.get("Sentences"), "30");
  assert.equal(byLabel.get("Paragraphs"), "12");
  assert.equal(byLabel.get("Headings"), "5");
  assert.equal(byLabel.get("Links"), "8");
  assert.equal(byLabel.get("Images"), "2");
  assert.equal(byLabel.get("Code blocks"), "3");
  assert.equal(byLabel.get("Mermaid blocks"), "1");
  assert.equal(byLabel.get("Math"), "5");
  assert.equal(byLabel.get("Reading time"), "3 min");
});

test("statsRows renders dashes when counts are null", () => {
  const rows = statsRows(null);
  assert.ok(rows.every((r) => r.value === "—"));
});
