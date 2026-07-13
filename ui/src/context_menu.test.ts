import test from "node:test";
import assert from "node:assert/strict";
// Import pure helpers from the shared menu leaf. `context_menu.ts` re-exports
// these for production callers, but has a runtime `.js` import that `node
// --test` cannot resolve (repo convention: pure-logic leaves only).
import {
  clampMenuPosition,
  isSeparator,
  nextMenuIndex,
  type MenuEntry,
} from "./menu.ts";

test("clampMenuPosition keeps the menu inside the viewport", () => {
  // Fits as-is.
  assert.deepEqual(
    clampMenuPosition({ x: 10, y: 10 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 10, top: 10 }
  );
  // Overflows right/bottom → shifted back so it stays visible.
  assert.deepEqual(
    clampMenuPosition({ x: 780, y: 580 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 700, top: 550 }
  );
  // Never goes negative.
  assert.deepEqual(
    clampMenuPosition({ x: 5, y: 5 }, { w: 100, h: 50 }, { w: 40, h: 30 }),
    { left: 0, top: 0 }
  );
});

test("isSeparator detects separator entries used by tab context menu", () => {
  const entries: MenuEntry[] = [
    { label: "Close", onSelect: () => {} },
    { type: "separator" },
  ];
  assert.equal(isSeparator(entries[0]), false);
  assert.equal(isSeparator(entries[1]), true);
});

test("menu keyboard index helper is stable for open/close nav parity", () => {
  // Context menus use the shared nextMenuIndex; keep a smoke assertion here so
  // context_menu.test.ts covers the nav contract consumers rely on.
  assert.equal(nextMenuIndex(1, 4, 1), 2);
  assert.equal(nextMenuIndex(0, 4, -1), 3);
});
