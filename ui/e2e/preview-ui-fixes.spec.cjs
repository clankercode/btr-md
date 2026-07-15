const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock, openSavedMarkdown } = require('./helpers.cjs');

async function buildWorkspace(page) {
  await installTauriMock(page, {
    files: {
      '/work/readme.md': '# Readme\n',
      '/work/guide.md': '# Guide\n',
    },
    dirListings: {
      '/work': {
        dir: '/work',
        entries: [
          { name: 'readme.md', path: '/work/readme.md', is_dir: false, is_markdown: true },
          { name: 'guide.md', path: '/work/guide.md', is_dir: false, is_markdown: true },
        ],
      },
    },
    settings: { browser_base_dir: '/work' },
  });
  await page.goto(appUrl());
  const sidebar = page.locator('#pmd-sidebar');
  const tree = sidebar.getByRole('tree');
  if (await tree.count() === 0) {
    await sidebar.getByRole('button', { name: 'Choose folder…' }).click();
  }
  await expect(tree).toBeVisible();
}

test('new-tab button opens a blank untitled document, not the welcome tab', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.getByRole('button', { name: 'New tab', exact: true }).click();

  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pmd-welcome')).not.toBeVisible();
});

test('double-clicking empty tab-strip space opens a blank untitled document', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  const tabbar = page.locator('.pmd-tabbar');
  const newButton = page.getByRole('button', { name: 'New tab', exact: true });
  const tabbarBox = await tabbar.boundingBox();
  const buttonBox = await newButton.boundingBox();
  if (!tabbarBox || !buttonBox) throw new Error('tabbar/new-tab button not measurable');

  await page.mouse.dblclick(
    Math.min(buttonBox.x + buttonBox.width + 24, tabbarBox.x + tabbarBox.width - 8),
    buttonBox.y + buttonBox.height / 2
  );

  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pmd-welcome')).not.toBeVisible();
});

test('sidebar single-click opens an italic preview tab and double-clicking its tab pins it', async ({ page }) => {
  await buildWorkspace(page);

  const sidebar = page.locator('#pmd-sidebar');
  await sidebar.getByRole('treeitem', { name: 'readme.md' }).click();

  const readmeTab = page.getByRole('tab', { name: /readme\.md/ });
  await expect(readmeTab).toHaveAttribute('data-pinned', 'false');
  await expect(readmeTab.locator('.pmd-tab-label')).toHaveCSS('font-style', 'italic');
  await expect(readmeTab).toHaveAttribute('title', '/work/readme.md');
  await expect(page.locator('.pmd-filename')).toHaveAttribute('title', '/work/readme.md');

  await sidebar.getByRole('treeitem', { name: 'guide.md' }).click();

  await expect(page.getByRole('tab', { name: /readme\.md/ })).toHaveCount(0);
  const guideTab = page.getByRole('tab', { name: /guide\.md/ });
  await expect(guideTab).toHaveAttribute('data-pinned', 'false');

  await guideTab.dblclick();

  await expect(guideTab).toHaveAttribute('data-pinned', 'true');
  await expect(guideTab.locator('.pmd-tab-label')).toHaveCSS('font-style', 'normal');
});

test('selected text on the active editor line receives the selected-text foreground class', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('alpha beta\nother line\n');

  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 'alpha'.length; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');

  const selected = page.locator('.cm-pmd-selectedText');
  await expect(selected).toContainText('alpha');
  await expect(selected).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('mermaid syntax failures use only the app inline error UI', async ({ page }) => {
  await installTauriMock(page, {
    renderHtml:
      '<article class="pmd-preview"><div class="pmd-mermaid" data-mermaid-source="graph TD; A--&gt;" data-pmd-nonce="" data-src-start="1" data-src-end="1"></div></article>',
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();

  await expect(page.locator('.pmd-mermaid-error')).toBeVisible();
  await expect(page.locator('.pmd-mermaid-error-message')).not.toHaveText('');
  await expect(page.locator('body > div[id^="dpmd-mermaid-"]')).toHaveCount(0);
  await expect(page.locator('body > div svg text', { hasText: 'Syntax error in text' })).toHaveCount(0);
});

test('path label toggles full vs compressed and persists via settings', async ({ page }) => {
  const filePath = '/home/user/docs/project/readme.md';
  await openSavedMarkdown(page, filePath, '# Hello\n');

  const pathLabel = page.locator('.pmd-abbrev-path');
  await expect(pathLabel).toBeVisible();
  // Compressed: /h/u/d/p/readme.md
  await expect(pathLabel).toHaveText('/h/u/d/p/readme.md');
  await expect(pathLabel).not.toHaveAttribute('data-full', '');

  await pathLabel.click();
  await expect(pathLabel).toHaveText(filePath);
  await expect(pathLabel).toHaveAttribute('data-full', '');

  const invocations = await page.evaluate(() =>
    (window.__pmdInvocations || []).filter((i) => i.cmd === 'set_show_full_path')
  );
  expect(invocations.length).toBeGreaterThanOrEqual(1);
  expect(invocations[invocations.length - 1].args).toEqual({ enabled: true });

  await pathLabel.click();
  await expect(pathLabel).toHaveText('/h/u/d/p/readme.md');
  await expect(pathLabel).not.toHaveAttribute('data-full', '');
});

test('untitled documents hide the path label (no toggle errors)', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.pmd-filename')).toHaveText('Untitled');
  await expect(page.locator('.pmd-abbrev-path')).toBeHidden();
});
