import test from "node:test";
import assert from "node:assert/strict";
import { mapMatchesToNodeRanges, type TextChunk } from "./find_preview.ts";

// Three text nodes concatenating to "foobarfoo"; query "foo" matches at 0 and 6.
const chunks: TextChunk[] = [
  { node: "A", start: 0, text: "foo" },
  { node: "B", start: 3, text: "bar" },
  { node: "C", start: 6, text: "foo" },
];

test("maps flat ranges to per-node offsets tagged with their logical matchIndex", () => {
  const out = mapMatchesToNodeRanges(chunks, [[0, 3], [6, 9]]);
  assert.deepEqual(out, [
    { matchIndex: 0, node: "A", from: 0, to: 3 },
    { matchIndex: 1, node: "C", from: 0, to: 3 },
  ]);
});

test("a match spanning two nodes splits into two sub-ranges sharing one matchIndex", () => {
  // query "obar": match [2,6) spans node A (offset 2..3) and node B (0..3)
  const out = mapMatchesToNodeRanges(chunks, [[2, 6]]);
  assert.deepEqual(out, [
    { matchIndex: 0, node: "A", from: 2, to: 3 },
    { matchIndex: 0, node: "B", from: 0, to: 3 },
  ]);
});

test("two matches keep distinct matchIndex values", () => {
  // matches [[0,3],[2,6]] → match 0 in A only; match 1 spans A+B
  const out = mapMatchesToNodeRanges(chunks, [[0, 3], [2, 6]]);
  assert.deepEqual(out.map((r) => r.matchIndex), [0, 1, 1]);
});

test("empty match list yields no node ranges", () => {
  assert.deepEqual(mapMatchesToNodeRanges(chunks, []), []);
});
