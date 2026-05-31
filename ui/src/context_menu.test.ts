import test from "node:test";
import assert from "node:assert/strict";
import { clampMenuPosition } from "./context_menu.ts";

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
