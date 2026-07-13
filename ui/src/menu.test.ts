import test from "node:test";
import assert from "node:assert/strict";
import {
  clampMenuPosition,
  isSeparator,
  nextMenuIndex,
  highlightedMenuIndex,
  type MenuEntry,
} from "./menu.ts";

test("clampMenuPosition keeps the menu inside the viewport", () => {
  assert.deepEqual(
    clampMenuPosition({ x: 10, y: 10 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 10, top: 10 }
  );
  assert.deepEqual(
    clampMenuPosition({ x: 780, y: 580 }, { w: 100, h: 50 }, { w: 800, h: 600 }),
    { left: 700, top: 550 }
  );
  assert.deepEqual(
    clampMenuPosition({ x: 5, y: 5 }, { w: 100, h: 50 }, { w: 40, h: 30 }),
    { left: 0, top: 0 }
  );
});

test("isSeparator detects separator entries only", () => {
  const sep: MenuEntry = { type: "separator" };
  const item: MenuEntry = { label: "Close", onSelect: () => {} };
  assert.equal(isSeparator(sep), true);
  assert.equal(isSeparator(item), false);
});

test("nextMenuIndex cycles and seeds from no selection", () => {
  assert.equal(nextMenuIndex(-1, 3, 1), 0);
  assert.equal(nextMenuIndex(-1, 3, -1), 2);
  assert.equal(nextMenuIndex(0, 3, 1), 1);
  assert.equal(nextMenuIndex(2, 3, 1), 0);
  assert.equal(nextMenuIndex(0, 3, -1), 2);
  assert.equal(nextMenuIndex(0, 0, 1), -1);
});

test("highlightedMenuIndex prefers data-highlighted then data-active", () => {
  const a = { hasAttribute: (n: string) => n === "data-highlighted" };
  const b = { hasAttribute: () => false };
  const c = { hasAttribute: (n: string) => n === "data-active" };
  assert.equal(highlightedMenuIndex([b, a, c] as unknown as Element[]), 1);
  assert.equal(highlightedMenuIndex([b, c] as unknown as Element[]), 1);
  assert.equal(highlightedMenuIndex([b] as unknown as Element[]), -1);
});
