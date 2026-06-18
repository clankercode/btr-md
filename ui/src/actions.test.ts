import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACTION_SHORTCUTS,
  NO_DEFAULT_ACTION_IDS,
  createActionRegistry,
  defaultActionSpecs,
  searchActions,
} from "./actions.ts";
import { findDefaultShortcutConflicts } from "./keybindings.ts";

test("default action inventory includes every approved shortcut exactly", () => {
  const byId = new Map(defaultActionSpecs.map((action) => [action.id, action]));
  for (const [id, shortcuts] of Object.entries(DEFAULT_ACTION_SHORTCUTS)) {
    assert.deepEqual(byId.get(id)?.defaultShortcuts, shortcuts, id);
  }
  assert.equal(Object.keys(DEFAULT_ACTION_SHORTCUTS).length, 26);
});

test("toggle sidebar action exists with Ctrl+B", () => {
  const byId = new Map(defaultActionSpecs.map((a) => [a.id, a]));
  assert.deepEqual(byId.get("view.toggleSidebar")?.defaultShortcuts, ["Ctrl+B"]);
});

test("default shortcuts are conflict free", () => {
  assert.deepEqual(findDefaultShortcutConflicts(defaultActionSpecs), []);
});

test("every registered action has a runnable handler", async () => {
  const ran: string[] = [];
  const registry = createActionRegistry(defaultActionSpecs, {
    run: (id) => ran.push(id),
    isEnabled: () => true,
    isVisible: () => true,
  });

  for (const action of defaultActionSpecs) {
    await registry.runAction(action.id);
  }

  assert.deepEqual(ran.sort(), defaultActionSpecs.map((action) => action.id).sort());
});

test("all no-default actions are registered searchable and unbound", () => {
  const byId = new Map(defaultActionSpecs.map((action) => [action.id, action]));
  for (const id of NO_DEFAULT_ACTION_IDS) {
    const action = byId.get(id);
    assert.ok(action, id);
    assert.deepEqual(action.defaultShortcuts, []);
    assert.equal(searchActions(defaultActionSpecs, action.label)[0].id, id);
    assert.equal(typeof action.run, "function");
  }
  assert.equal(NO_DEFAULT_ACTION_IDS.length, 25);
});
