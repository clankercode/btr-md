const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

const headings = [
  { level: 1, text: 'Alpha', slug: 'alpha', duplicate_index: 0, line_start: 1, line_end: 1, block_id: 'block-alpha' },
  { level: 2, text: 'Beta', slug: 'beta', duplicate_index: 0, line_start: 3, line_end: 3, block_id: 'block-beta' },
  { level: 2, text: 'Deep Dive', slug: 'deep-dive', duplicate_index: 0, line_start: 5, line_end: 5, block_id: 'block-deep' },
];

async function openOutlineFixture(page) {
  await installTauriMock(page, {
    renderFacts: { headings },
    renderHtml: [
      '<article class="pmd-preview">',
      '<h1 data-pmd-block-id="block-alpha">Alpha</h1>',
      '<h2 data-pmd-block-id="block-beta">Beta</h2>',
      '<div style="height: 1200px"></div>',
      '<h2 data-pmd-block-id="block-deep">Deep Dive</h2>',
      '</article>',
    ].join(''),
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('# Alpha\n\n## Beta\n\n## Deep Dive\n');
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
}

test('outline opens, filters, jumps, tracks active heading, and restores focus', async ({ page }) => {
  await openOutlineFixture(page);
  await page.keyboard.press('Control+Shift+O');

  const outline = page.getByRole('dialog', { name: 'Outline' });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Alpha' })).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveAttribute('aria-level', '2');

  await outline.getByRole('searchbox', { name: 'Filter headings' }).fill('Deep');
  await expect(outline.getByRole('treeitem', { name: 'Deep Dive' })).toBeVisible();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveCount(0);

  await outline.getByRole('searchbox', { name: 'Filter headings' }).fill('');
  await outline.getByRole('tree').press('ArrowDown');
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pmd-block-id="block-beta"]')).toBeInViewport();
  await expect(outline.getByRole('treeitem', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');

  await page.locator('[data-pmd-block-id="block-deep"]').scrollIntoViewIfNeeded();
  await expect(outline.getByRole('treeitem', { name: 'Deep Dive' })).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(outline).toBeHidden();
  await expect(page.locator('.cm-content')).toBeFocused();
});
