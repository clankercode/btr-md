import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlContainsList } from './clipboard_paste.ts';

test('detects ul/ol list items', () => {
  assert.equal(htmlContainsList('<ul><li>a</li><li>b</li></ul>'), true);
  assert.equal(htmlContainsList('<ol>\n<li>one</li>\n</ol>'), true);
  assert.equal(htmlContainsList('<LI class="x">styled</LI>'), true);
});

test('ignores HTML without list items', () => {
  assert.equal(htmlContainsList('<p>hello <b>world</b></p>'), false);
  assert.equal(htmlContainsList('<div>list of things</div>'), false); // word "list", no <li>
});

test('handles empty / missing input', () => {
  assert.equal(htmlContainsList(''), false);
  assert.equal(htmlContainsList(null), false);
  assert.equal(htmlContainsList(undefined), false);
});
