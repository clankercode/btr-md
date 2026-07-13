import { test } from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure leaf module (re-exported by tabbar.ts). The node test
// runner cannot resolve tabbar.ts's `.js` runtime imports, so we target the leaf
// directly, matching the repo's pure-logic-in-a-leaf testing convention.
import { buildTabContextItems } from './tab_context_menu.ts';
import { isSeparator } from './menu.ts';

test('tab context menu shows Close Tab and disabled Move to New Window', () => {
  const items = buildTabContextItems({ onClose: () => {} });
  const move = items.find((i) => !isSeparator(i) && i.label === 'Move to New Window');
  assert.ok(move, 'Move to New Window present');
  assert.equal((move as any).disabled, true);
  const close = items.find((i) => !isSeparator(i) && i.label === 'Close Tab');
  assert.ok(close && !(close as any).disabled);
});

test('tab context menu includes Reveal in Folder and Copy Path when filePath is set', () => {
  const items = buildTabContextItems({
    onClose: () => {},
    filePath: '/home/user/doc.md',
    onRevealInFolder: () => {},
    onCopyPath: () => {},
  });
  const reveal = items.find((i) => !isSeparator(i) && i.label === 'Reveal in Folder');
  assert.ok(reveal, 'Reveal in Folder present');
  const copyPath = items.find((i) => !isSeparator(i) && i.label === 'Copy Path');
  assert.ok(copyPath, 'Copy Path present');
  // Should have a separator before Close Tab.
  const separators = items.filter(isSeparator);
  assert.ok(separators.length >= 1, 'separator present');
});

test('tab context menu omits file ops when no filePath', () => {
  const items = buildTabContextItems({ onClose: () => {} });
  const reveal = items.find((i) => !isSeparator(i) && i.label === 'Reveal in Folder');
  assert.equal(reveal, undefined, 'no Reveal without filePath');
  const copyPath = items.find((i) => !isSeparator(i) && i.label === 'Copy Path');
  assert.equal(copyPath, undefined, 'no Copy Path without filePath');
});

test('tab context menu includes Re-root to git when filePath and gitRoot set', () => {
  let reRooted = false;
  const items = buildTabContextItems({
    onClose: () => {},
    filePath: '/repo/docs/a.md',
    gitRoot: '/repo',
    onReRootToGit: () => {
      reRooted = true;
    },
  });
  const reRoot = items.find((i) => !isSeparator(i) && i.label === 'Re-root to git');
  assert.ok(reRoot, 'Re-root to git present');
  (reRoot as { onSelect: () => void }).onSelect();
  assert.equal(reRooted, true);
});

test('tab context menu omits Re-root to git without gitRoot', () => {
  const items = buildTabContextItems({
    onClose: () => {},
    filePath: '/tmp/a.md',
    onReRootToGit: () => {},
  });
  const reRoot = items.find((i) => !isSeparator(i) && i.label === 'Re-root to git');
  assert.equal(reRoot, undefined);
});
