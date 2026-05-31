const { test, expect } = require('playwright/test');
const { appUrl, grantFolderInMockBackend, installTauriMock, openMarkdown, openSavedMarkdown } = require('./helpers.cjs');

async function openCommandOverlay(page, query) {
  await page.keyboard.press('Control+P');
  const dialog = page.getByRole('dialog', { name: 'Command overlay' });
  await expect(dialog).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill(query);
  return dialog;
}

test('broken local image shows one-line inline issue and diagnostics row', async ({ page }) => {
  await openMarkdown(page, '# Broken\n\n![missing](missing.png)');

  await expect(page.getByText('Image missing: fix the path or move the file next to the document.')).toBeVisible();
  await expect(page.locator('[data-pmd-resource-state="missing"]')).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toContainText(
    'Image missing: fix the path or move the file next to the document.'
  );
  await expect(page.getByText('Content Blocked')).toHaveCount(0);
});

test('broken local Markdown link shows one-line inline issue and diagnostics row', async ({ page }) => {
  await openMarkdown(page, '# Broken Link\n\n[missing](missing.md)');

  await expect(page.getByText('Linked Markdown file not found: missing.md')).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toContainText(
    'Linked Markdown file not found: missing.md'
  );
  await expect(page.getByText('Content Blocked')).toHaveCount(0);
});

test('clean document hides diagnostics panel', async ({ page }) => {
  await openMarkdown(page, '# Clean\n\nEverything is local and ordinary.');

  await expect(page.getByRole('heading', { name: 'Clean' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Diagnostics/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toHaveCount(0);
  await expect(page.getByText('Safe Preview')).toBeVisible();
});

test('blocked remote image shows Content Blocked', async ({ page }) => {
  await openMarkdown(page, '# Remote\n\n![remote](https://example.com/image.png)');

  await expect(page.getByRole('alert')).toContainText('Remote image blocked');
  await expect(page.getByRole('button', { name: 'Content Blocked' })).toBeVisible();
});

test('resource policy panel explains the block reason', async ({ page }) => {
  await openMarkdown(page, '# Remote Policy\n\n![remote](https://example.com/image.png)');

  await page.getByRole('button', { name: /Trust|Resource policy|Content Blocked/ }).click();
  const policy = page.getByRole('region', { name: /Trust|Resource policy/ });
  await expect(policy).toContainText('Remote images blocked');
  await expect(policy).toContainText('Remote image blocked: use a local file or open the URL outside the preview.');
});

test('Grant Folder recovers and revocation re-blocks a local image', async ({ page }) => {
  await openMarkdown(page, '![outside](../assets/outside.png)');
  await expect(page.getByRole('alert')).toContainText('Image blocked');

  await grantFolderInMockBackend(page, '../assets');
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await page.getByRole('button', { name: 'Grant folder' }).click();
  await expect(page.getByAltText('outside')).toBeVisible();
  await page.getByRole('button', { name: 'Safe Preview' }).click();
  await expect(page.getByRole('region', { name: /Trust|Resource policy/ })).toContainText('Asset grant: ../assets');

  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('alert')).toContainText('Image blocked');
});

test('saved markdown in a git repo recommends trusting the repository root', async ({ page }) => {
  await openSavedMarkdown(
    page,
    '/work/repo/docs/page.md',
    '# Repo Assets\n\n![outside](../assets/outside.png)',
    {
      gitRoots: ['/work/repo'],
    }
  );

  await page.getByRole('button', { name: 'Content Blocked' }).click();
  const policy = page.getByRole('region', { name: /Trust|Resource policy/ });
  await expect(policy).toContainText('Repository root available: /work/repo');
  await policy.getByRole('button', { name: 'Trust root' }).click();
  const invocations = await page.evaluate(() => window.__pmdInvocations.map((call) => call.cmd));
  expect(invocations).toContain('grant_recommended_root');
  await page.getByRole('button', { name: 'Safe Preview' }).click();
  await expect(page.getByRole('region', { name: /Trust|Resource policy/ })).toContainText('Asset grant: /work/repo');
});

test('remembered trusted repository root auto-materializes on later load', async ({ page }) => {
  await openSavedMarkdown(page, '/work/repo/docs/page.md', '# Trusted\n\n![outside](../assets/outside.png)', {
    gitRoots: ['/work/repo'],
    files: {
      '/work/repo/docs/other.md': '# Trusted Again\n\n![outside](../assets/outside.png)',
    },
  });

  await page.getByRole('button', { name: 'Content Blocked' }).click();
  await page.getByRole('button', { name: 'Trust root' }).click();
  await page.evaluate((path) => window.__pmdOpenPathForTest(path), '/work/repo/docs/other.md');

  await expect(page.getByRole('button', { name: 'Safe Preview' })).toBeVisible();
  await expect(page.getByAltText('outside')).toBeVisible();
  await page.getByRole('button', { name: 'Safe Preview' }).click();
  const policy = page.getByRole('region', { name: /Trust|Resource policy/ });
  await expect(policy).toContainText('Asset grant: /work/repo');
  await expect(policy).not.toContainText('Repository root available');
});

test('declined repository root suppresses repeated automatic prompt', async ({ page }) => {
  await openSavedMarkdown(page, '/work/repo/docs/page.md', '# Declined\n\n![outside](../assets/outside.png)', {
    gitRoots: ['/work/repo'],
    files: {
      '/work/repo/docs/other.md': '# Still Declined\n\n![outside](../assets/outside.png)',
    },
  });
  await page.getByRole('button', { name: 'Content Blocked' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();

  await page.evaluate((path) => window.__pmdOpenPathForTest(path), '/work/repo/docs/other.md');
  await page.getByRole('button', { name: 'Content Blocked' }).click();
  const policy = page.getByRole('region', { name: /Trust|Resource policy/ });
  await expect(policy).not.toContainText('Repository root available');
  await expect(page.getByRole('alert')).toContainText('Image blocked');
});

test('trust-root decisions reconcile already-open tabs and command actions', async ({ page }) => {
  await installTauriMock(page, {
    files: {
      '/work/repo/docs/page.md': '# First\n\n![outside](../assets/outside.png)',
      '/work/repo/docs/other.md': '# Second\n\n![outside](../assets/outside.png)',
    },
    gitRoots: ['/work/repo'],
  });
  await page.goto(appUrl());
  await page.evaluate((path) => window.__pmdOpenPathForTest(path), '/work/repo/docs/page.md');
  await expect(page.locator('.cm-content')).toContainText('First');
  await page.evaluate((path) => window.__pmdOpenPathForTest(path), '/work/repo/docs/other.md');
  await expect(page.locator('.cm-content')).toContainText('Second');

  await openCommandOverlay(page, 'Trust repository root');
  await expect(page.locator('.pmd-command-row', { hasText: 'Trust repository root' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Content Blocked' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();

  await openCommandOverlay(page, 'Trust repository root');
  await expect(page.locator('.pmd-command-row', { hasText: 'Trust repository root' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: /page\.md/ }).click();
  await page.getByRole('button', { name: 'Content Blocked' }).click();
  const policy = page.getByRole('region', { name: /Trust|Resource policy/ });
  await expect(policy).not.toContainText('Repository root available');
});

test('settings can remove stored trusted and declined roots', async ({ page }) => {
  await openSavedMarkdown(page, '/work/repo/docs/page.md', '# Repo\n\n![outside](../assets/outside.png)', {
    gitRoots: ['/work/repo'],
    trustRoots: [
      { canonical_root: '/work/repo', state: 'trusted' },
      { canonical_root: '/work/other', state: 'declined' },
    ],
  });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('trusted: /work/repo')).toBeVisible();
  await expect(page.getByText('declined: /work/other')).toBeVisible();
  await page.locator('.pmd-settings-trust-roots').getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByText('trusted: /work/repo')).toHaveCount(0);
  const forgot = await page.evaluate(() =>
    window.__pmdInvocations.some((call) => call.cmd === 'forget_trust_root' && call.args?.canonicalRoot === '/work/repo')
  );
  expect(forgot).toBe(true);
  await expect(page.getByRole('button', { name: 'Content Blocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Content Blocked' }).click();
  await expect(page.getByRole('region', { name: /Trust|Resource policy/ })).toContainText('Repository root available: /work/repo');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.pmd-settings-trust-roots').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('declined: /work/other')).toHaveCount(0);
  const forgotDeclined = await page.evaluate(() =>
    window.__pmdInvocations.some((call) => call.cmd === 'forget_trust_root' && call.args?.canonicalRoot === '/work/other')
  );
  expect(forgotDeclined).toBe(true);
});

test('external link click opens confirmation instead of navigating WebView', async ({ page }) => {
  await openMarkdown(page, '# External\n\n[external report](https://example.com/report)');
  const beforeUrl = page.url();

  await page.getByRole('link', { name: 'external report' }).click();

  await expect(page.getByTestId('confirm-external-open')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Open external link' })).toContainText('example.com');
  await expect(page).toHaveURL(beforeUrl);
  const invocations = await page.evaluate(() => window.__pmdInvocations.map((call) => call.cmd));
  expect(invocations).toContain('prepare_link_activation');
  expect(invocations).not.toContain('confirm_external_open');
});

test('malformed frontmatter appears as a warning row and keeps preview content', async ({ page }) => {
  await openMarkdown(page, '---\ntitle: [unterminated\n---\n# Body\n');

  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();
  await expect(page.getByText('Frontmatter could not be parsed')).toBeVisible();
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await expect(page.getByRole('region', { name: /Diagnostics/ })).toContainText('Frontmatter could not be parsed');
});
