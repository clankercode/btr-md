const { test, expect } = require('playwright/test');
const { openMarkdown, installTauriMock, appUrl } = require('./helpers.cjs');

async function runCommand(page, query) {
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill(query);
  await page.keyboard.press('Enter');
}

async function appendFocusClippingSentinels(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.pmd-focus-ring-clipping-sentinel').forEach((node) => node.remove());
    const focusables = Array.from(document.querySelectorAll(
      'button, input, [href], [tabindex]:not([tabindex="-1"]), [role="treeitem"]'
    ));
    for (const node of focusables) {
      if (!(node instanceof HTMLElement) || node.offsetParent === null) continue;
      node.focus();
      const rect = node.getBoundingClientRect();
      if (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
        const marker = document.createElement('div');
        marker.className = 'pmd-focus-ring-clipping-sentinel';
        marker.dataset.node = node.textContent || node.getAttribute('aria-label') || node.tagName;
        document.body.append(marker);
      }
    }
  });
}

test('new surfaces are keyboard reachable and restore focus', async ({ page }) => {
  await openMarkdown(page, '# One\n\n## Two\n\n![missing](missing.png)');
  await page.keyboard.press('Control+Shift+O');
  await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Outline' })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused();

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toHaveCount(0);

  await page.keyboard.press('Control+Shift+M');
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toBeVisible();
  await page.keyboard.press('F10');
  await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
});

test('file browser exposes keyboardable tree semantics', async ({ page }) => {
  await installTauriMock(page, {
    dirListings: {
      '/work': {
        dir: '/work',
        entries: [
          { name: 'docs', path: '/work/docs', is_dir: true, is_markdown: false },
          { name: 'readme.md', path: '/work/readme.md', is_dir: false, is_markdown: true },
        ],
      },
      '/work/docs': {
        dir: '/work/docs',
        entries: [{ name: 'guide.md', path: '/work/docs/guide.md', is_dir: false, is_markdown: true }],
      },
    },
    settings: { browser_base_dir: '/work' },
  });
  await page.goto(appUrl());
  await runCommand(page, 'File browser');

  const tree = page.locator('#pmd-tab-body').getByRole('tree', { name: /Files|File browser/ });
  if (await tree.count() === 0) {
    await page.getByRole('button', { name: 'Choose folder…' }).last().click();
  }
  await expect(tree).toBeVisible();
  const docs = tree.getByRole('treeitem', { name: 'docs' });
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await docs.focus();
  await page.keyboard.press('Enter');
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem', { name: 'guide.md' })).toBeVisible();
});

test('large text and reduced motion keep focusable controls usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await openMarkdown(page, '# One\n\n[broken](missing.md)\n\n![missing](missing.png)');
  await page.addStyleTag({ content: 'html { font-size: 22px; }' });
  await page.keyboard.press('Control+Shift+M');
  await page.keyboard.press('Control+P');
  await page.keyboard.press('Escape');
  await appendFocusClippingSentinels(page);

  await expect(page.getByRole('region', { name: /Diagnostics/ })).toBeVisible();
  await expect(page.locator('.pmd-focus-ring-clipping-sentinel')).toHaveCount(0);
});
