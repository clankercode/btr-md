import test from "node:test";
import assert from "node:assert/strict";
import { defaultActionSpecs, searchActions } from "./actions.ts";
import {
  findDefaultShortcutConflicts,
  findUserShortcutConflicts,
  mergeShortcutOverrides,
  normalizeShortcut,
  restoreAllShortcutDefaults,
} from "./keybindings.ts";

test("shortcut normalization is order and case stable", () => {
  assert.equal(normalizeShortcut("Ctrl+Shift+O"), "Ctrl+Shift+O");
  assert.equal(normalizeShortcut("Shift+Ctrl+O"), "Ctrl+Shift+O");
  assert.equal(normalizeShortcut("ctrl+shift+o"), "Ctrl+Shift+O");
});

test("ctrl shifted slash normalizes to the advertised help shortcut", () => {
  const event = {
    key: "?",
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
  } as KeyboardEvent;

  assert.equal(normalizeShortcut(event), "Ctrl+?");
});

test("user overrides can add multiple shortcuts to one action", () => {
  assert.deepEqual(
    mergeShortcutOverrides(defaultActionSpecs, {
      "navigate.commandOverlay": ["Ctrl+K", "Ctrl+P"],
    })["navigate.commandOverlay"],
    ["Ctrl+K", "Ctrl+P"]
  );
});

test("user override conflicts block saving", () => {
  const conflicts = findUserShortcutConflicts(
    defaultActionSpecs,
    {
      "navigate.outline": ["Ctrl+P"],
    },
    new Set(["navigate.outline", "navigate.commandOverlay"])
  );

  assert.deepEqual(conflicts, [
    {
      shortcut: "Ctrl+P",
      actionIds: ["navigate.commandOverlay", "navigate.outline"],
    },
  ]);
});

test("no default actions are searchable but conflict free until bound", () => {
  const reveal = defaultActionSpecs.find((action) => action.id === "file.revealInFolder")!;
  assert.deepEqual(reveal.defaultShortcuts, []);
  assert.equal(searchActions(defaultActionSpecs, "reveal")[0].id, "file.revealInFolder");
  assert.deepEqual(findDefaultShortcutConflicts([reveal]), []);
});

test("restore all defaults clears every shortcut override", () => {
  assert.deepEqual(
    restoreAllShortcutDefaults({
      "navigate.commandOverlay": ["Ctrl+K"],
      "navigate.outline": ["Ctrl+Alt+O"],
    }),
    {}
  );
});
