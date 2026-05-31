import test from "node:test";
import assert from "node:assert/strict";
import { findMatches } from "./find_query.ts";

test("empty query yields no matches", () => {
  assert.deepEqual(findMatches("hello world", ""), []);
});

test("case-insensitive matches return offset ranges", () => {
  assert.deepEqual(findMatches("Hello hello HELLO", "hello"), [
    [0, 5],
    [6, 11],
    [12, 17],
  ]);
});

test("overlapping is non-greedy left-to-right (no overlap)", () => {
  assert.deepEqual(findMatches("aaaa", "aa"), [
    [0, 2],
    [2, 4],
  ]);
});

test("no matches yields empty array", () => {
  assert.deepEqual(findMatches("abc", "z"), []);
});
