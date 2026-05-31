import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownForTable, applyTableExpanded } from './table_copy.ts';

// Line 1: intro, lines 2-4: the table (1-based, inclusive).
const SOURCE = 'intro\n| a | b |\n|---|---|\n| 1 | 2 |\nafter\n';

test('extracts the inclusive line range as verbatim markdown', () => {
  const result = markdownForTable(SOURCE, '2', '4');
  assert.equal(result, '| a | b |\n|---|---|\n| 1 | 2 |');
});

test('single-line range', () => {
  assert.equal(markdownForTable(SOURCE, '1', '1'), 'intro');
});

test('missing / undefined attrs return null', () => {
  assert.equal(markdownForTable(SOURCE, null, '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', null), null);
  assert.equal(markdownForTable(SOURCE, undefined, '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', undefined), null);
});

test('non-numeric attrs return null', () => {
  assert.equal(markdownForTable(SOURCE, 'abc', '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', 'xyz'), null);
});

test('start < 1 returns null (lines are 1-based)', () => {
  assert.equal(markdownForTable(SOURCE, '0', '4'), null);
  assert.equal(markdownForTable(SOURCE, '-1', '4'), null);
});

test('end < start returns null', () => {
  assert.equal(markdownForTable(SOURCE, '4', '2'), null);
});

test('end beyond the document returns null', () => {
  assert.equal(markdownForTable(SOURCE, '2', '999'), null);
});

// --- applyTableExpanded -------------------------------------------------
// No DOM here, so stub the minimal element interface the helper touches: a
// classList with a spec-compatible toggle(name, force?), plus the writable
// label/title/attr bits. Mirrors how the real DOMTokenList/HTMLElement behave.
function classList() {
  const set = new Set<string>();
  return {
    set,
    toggle(name: string, force?: boolean): boolean {
      const present = force === undefined ? !set.has(name) : force;
      if (present) set.add(name);
      else set.delete(name);
      return present;
    },
    contains: (name: string) => set.has(name),
  };
}
function fakeEl() {
  return { classList: classList() } as unknown as HTMLElement & {
    classList: ReturnType<typeof classList>;
  };
}
function fakeToggle() {
  const attrs = new Map<string, string>();
  return {
    textContent: '',
    title: '',
    setAttribute(k: string, v: string) {
      attrs.set(k, v);
    },
    attrs,
  } as unknown as HTMLButtonElement & { attrs: Map<string, string> };
}

test('applyTableExpanded(true) grows both axes and updates the toggle', () => {
  const viewport = fakeEl();
  const wrap = fakeEl();
  const toggle = fakeToggle();
  viewport.classList.set.add('pmd-table-collapsed'); // tall table starts collapsed

  applyTableExpanded(viewport, wrap, toggle, true);

  assert.equal(viewport.classList.contains('pmd-table-collapsed'), false); // vertical
  assert.equal(wrap.classList.contains('is-expanded'), true); // horizontal
  assert.equal(toggle.textContent, 'Collapse');
  assert.equal(toggle.title, 'Collapse the table');
  assert.equal((toggle as { attrs: Map<string, string> }).attrs.get('aria-expanded'), 'true');
});

test('applyTableExpanded(false) restores the constrained state for tall tables', () => {
  const viewport = fakeEl();
  const wrap = fakeEl();
  const toggle = fakeToggle();
  wrap.classList.set.add('is-expanded');

  applyTableExpanded(viewport, wrap, toggle, false);

  assert.equal(viewport.classList.contains('pmd-table-collapsed'), true); // re-clip vertically
  assert.equal(wrap.classList.contains('is-expanded'), false); // drop horizontal breakout
  assert.equal(toggle.textContent, 'Expand');
  assert.equal(toggle.title, 'Expand the full table');
  assert.equal((toggle as { attrs: Map<string, string> }).attrs.get('aria-expanded'), 'false');
});

test('applyTableExpanded(false, false) does not vertically clip wide-only tables', () => {
  const viewport = fakeEl();
  const wrap = fakeEl();
  const toggle = fakeToggle();
  wrap.classList.set.add('is-expanded');

  applyTableExpanded(viewport, wrap, toggle, false, false);

  assert.equal(viewport.classList.contains('pmd-table-collapsed'), false);
  assert.equal(wrap.classList.contains('is-expanded'), false);
  assert.equal(toggle.textContent, 'Expand');
  assert.equal(toggle.title, 'Expand the full table');
  assert.equal((toggle as { attrs: Map<string, string> }).attrs.get('aria-expanded'), 'false');
});
