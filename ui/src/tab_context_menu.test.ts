import { test } from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure leaf module (re-exported by tabbar.ts). The node test
// runner cannot resolve tabbar.ts's `.js` runtime imports, so we target the leaf
// directly, matching the repo's pure-logic-in-a-leaf testing convention.
import { buildTabContextItems } from './tab_context_menu.ts';

test('tab context menu shows a disabled Move to New Window affordance', () => {
  const items = buildTabContextItems({ onClose: () => {} });
  const move = items.find((i) => i.label === 'Move to New Window');
  assert.ok(move, 'item present');
  assert.equal(move.disabled, true);
  const close = items.find((i) => i.label === 'Close Tab');
  assert.ok(close && !close.disabled);
});
