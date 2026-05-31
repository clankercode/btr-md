const { test, expect } = require('playwright/test');
const { openMarkdown, openSavedMarkdown, installTauriMock, appUrl } = require('./helpers.cjs');

const bundledThemes = [
  { slug: 'github-light', name: 'GitHub Light', mode: 'light' },
  { slug: 'dracula', name: 'Dracula', mode: 'dark' },
  { slug: 'nord', name: 'Nord', mode: 'dark' },
  { slug: 'github-dark', name: 'GitHub Dark', mode: 'dark' },
];

async function runCommand(page, query) {
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill(query);
  await page.keyboard.press('Enter');
}

async function openEditor(page) {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
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

async function expectFocusedElementHasVisibleRing(locator) {
  await expect(locator).toBeFocused();
  const ring = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
      boxShadow: style.boxShadow,
    };
  });
  expect(
    ring.outlineWidth > 0 && ring.outlineStyle !== 'none' && ring.outlineColor !== 'rgba(0, 0, 0, 0)'
      || ring.boxShadow !== 'none'
  ).toBe(true);
}

async function applyTheme(page, theme) {
  await page.keyboard.press('Control+T');
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();
  await page.locator(`.pmd-picker-card[data-slug="${theme.slug}"] .pmd-picker-card-apply`).click();
  await expect(page.locator('#theme-picker-overlay')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme.mode);
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

test('shortcut editor is keyboard reachable and restores focus', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.cm-content');
  await editor.focus();

  await runCommand(page, 'Keyboard shortcuts');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('New file shortcuts')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Restore' }).first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('New file shortcuts')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test('tab strip exposes keyboard reachable tabs and tab controls', async ({ page }) => {
  await openEditor(page);
  await runCommand(page, 'File browser');

  const tablist = page.getByRole('tablist').filter({ has: page.locator('.pmd-tab') });
  await expect(tablist).toBeVisible();
  await expect(tablist.getByRole('tab', { name: /Files/ })).toHaveAttribute('tabindex', '0');
  await expect(tablist.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('tabindex', '-1');

  await tablist.getByRole('tab', { name: /Files/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tablist.getByRole('tab', { name: /Untitled/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tablist.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Tab');
  await expect(tablist.getByRole('button', { name: /Close Untitled/ })).toBeFocused();
  await tablist.getByRole('button', { name: 'New tab', exact: true }).focus();
  await expect(tablist.getByRole('button', { name: 'New tab', exact: true })).toBeFocused();
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

test('trust panel is keyboard reachable and actions run from the keyboard', async ({ page }) => {
  await openSavedMarkdown(page, '/work/docs/page.md', '# Trust\n\n![outside](../assets/outside.png)', {
    gitRoots: ['/work'],
  });
  const status = page.getByRole('button', { name: 'Content Blocked' });

  await status.focus();
  await expect(status).toBeFocused();
  await page.keyboard.press('Enter');
  const policy = page.getByRole('region', { name: 'Resource policy' });
  await expect(policy).toBeVisible();
  await expect(policy).toContainText('Repository root available: /work');

  const trustRoot = policy.getByRole('button', { name: 'Trust root' });
  await trustRoot.focus();
  await expect(trustRoot).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () =>
    page.evaluate(() => window.__pmdInvocations.some((call) => call.cmd === 'grant_recommended_root'))
  ).toBe(true);
});

test('focus rings are visible across bundled themes', async ({ page }) => {
  await openMarkdown(page, '# One\n\n## Two\n\n![missing](missing.png)');

  for (const theme of bundledThemes) {
    await applyTheme(page, theme);

    await page.keyboard.press('Control+P');
    await page.getByRole('searchbox', { name: 'Search commands' }).fill('Keyboard shortcuts');
    await page.keyboard.press('Tab');
    await expectFocusedElementHasVisibleRing(page.locator('.pmd-command-row').first());
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+O');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await expectFocusedElementHasVisibleRing(page.getByRole('treeitem', { name: 'Two' }));
    await page.keyboard.press('Escape');
  }
});

test('high contrast large text and reduced motion keep focusable controls usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark', forcedColors: 'active' });
  await openMarkdown(page, '# One\n\n[broken](missing.md)\n\n![missing](missing.png)\n\n![outside](../assets/outside.png)', {
    gitRoots: ['/work'],
  });
  await page.addStyleTag({ content: 'html { font-size: 22px; }' });
  await page.keyboard.press('Control+Shift+M');
  await page.keyboard.press('Control+P');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Content Blocked' }).focus();
  await page.keyboard.press('Enter');
  await appendFocusClippingSentinels(page);

  await expect(page.getByRole('region', { name: /Diagnostics/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resource policy' })).toBeVisible();
  await expect(page.locator('.pmd-focus-ring-clipping-sentinel')).toHaveCount(0);
});
