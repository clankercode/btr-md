import test from "node:test";
import assert from "node:assert/strict";
import { parentOf, isUnder, prunedExpanded } from "./workspace.ts";

test("parentOf returns the parent path or null at root", () => {
  assert.equal(parentOf("/a/b/c"), "/a/b");
  assert.equal(parentOf("/a"), "/");
  assert.equal(parentOf("/"), null);
  assert.equal(parentOf("/a/b/"), "/a"); // trailing slash tolerated
});

test("isUnder is a component-wise descendant test", () => {
  assert.equal(isUnder("/base", "/base/x"), true);
  assert.equal(isUnder("/base", "/base"), true);
  assert.equal(isUnder("/base", "/base_evil"), false); // not a string prefix
  assert.equal(isUnder("/base/x", "/base"), false); // ancestor, not descendant
});

test("prunedExpanded keeps only paths under the root", () => {
  const got = prunedExpanded(new Set(["/r/a", "/r/a/b", "/other/x"]), "/r");
  assert.deepEqual([...got].sort(), ["/r/a", "/r/a/b"]);
});
