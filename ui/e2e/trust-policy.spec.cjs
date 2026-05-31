const { test, expect } = require('playwright/test');
const { openMarkdown } = require('./helpers.cjs');

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
