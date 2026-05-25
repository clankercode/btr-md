const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock, screenshotPath } = require('./helpers.cjs');

test('@visual fixed chrome leaves no gap and content fills below it', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await expect(page.locator('.pmd-chrome')).toBeVisible();
  // Welcome screen is rendered in #pmd-welcome (not the pane) when no file is open.
  await expect(page.locator('#pmd-welcome')).toBeVisible();
  await expect(page.locator('.pmd-status-bar')).toBeVisible();

  await page.screenshot({ path: screenshotPath('welcome.png') });
  await expect(page).toHaveScreenshot('welcome.png', {
    maxDiffPixelRatio: 0.02,
  });

  const metrics = await page.evaluate(() => {
    const chrome = document.querySelector('.pmd-chrome').getBoundingClientRect();
    const welcome = document.querySelector('#pmd-welcome').getBoundingClientRect();
    const statusBar = document.querySelector('.pmd-status-bar').getBoundingClientRect();
    return {
      chromeBottom: chrome.bottom,
      welcomeTop: welcome.top,
      welcomeBottom: welcome.bottom,
      statusTop: statusBar.top,
      statusBottom: statusBar.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  // Welcome content sits flush below the toolbar (within the padded container).
  expect(Math.abs(metrics.welcomeTop - metrics.chromeBottom)).toBeLessThanOrEqual(1);
  // Status bar pinned to viewport bottom.
  expect(metrics.statusBottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 1);
  // Welcome content reaches down to the status bar.
  expect(Math.abs(metrics.welcomeBottom - metrics.statusTop)).toBeLessThanOrEqual(1);
});

test('@visual theme picker previews use each theme palette', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }));
  });
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();
  const cardCount = await page.locator('.pmd-picker-card').count();
  expect(cardCount).toBeGreaterThan(2);

  await page.screenshot({ path: screenshotPath('theme-picker.png') });
  await expect(page).toHaveScreenshot('theme-picker.png', {
    maxDiffPixelRatio: 0.02,
  });

  const previews = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.pmd-picker-card')).map((card) => {
      const inner = card.querySelector('.pmd-picker-preview-inner');
      const accent = card.querySelector('.pmd-picker-preview-accent');
      return {
        slug: card.getAttribute('data-slug'),
        mode: card.getAttribute('data-mode'),
        innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
        accentBg: accent ? getComputedStyle(accent).backgroundColor : null,
      };
    });
  });

  const uniqueInnerBgs = new Set(previews.map((p) => p.innerBg));
  const uniqueAccents = new Set(previews.map((p) => p.accentBg));
  // Each theme should have its own bg + accent — uniqueness is the contract.
  expect(uniqueInnerBgs.size).toBeGreaterThan(1);
  expect(uniqueAccents.size).toBeGreaterThan(1);
  expect(previews.every((p) => p.mode === 'light' || p.mode === 'dark')).toBe(true);
});

test('@visual split mode has a draggable resizer', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  // Click "New File" to enter editor + preview state.
  await page.locator('#pmd-welcome-new').click();
  await page.locator('#split-resizer').waitFor({ state: 'visible' });

  const before = await page.evaluate(() => ({
    ratio: parseFloat(
      document.getElementById('app-container').style.getPropertyValue('--pmd-split-ratio') || '0.5'
    ),
    editorWidth: document.getElementById('editor-pane').getBoundingClientRect().width,
  }));

  await page.locator('#split-resizer').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const after = await page.evaluate(() => ({
    ratio: parseFloat(
      document.getElementById('app-container').style.getPropertyValue('--pmd-split-ratio') || '0.5'
    ),
    editorWidth: document.getElementById('editor-pane').getBoundingClientRect().width,
  }));

  expect(after.ratio).toBeGreaterThan(before.ratio);
  expect(after.editorWidth).toBeGreaterThan(before.editorWidth);

  await page.screenshot({ path: screenshotPath('split-resized.png') });
});

test('@visual applying a dark theme sets html[data-theme="dark"]', async ({ page }) => {
  // Regression test: design-system.css scopes its dark token block on
  // [data-theme="dark"], so JS must mirror the theme mode there. CSS alone
  // cannot set that attribute.
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }));
  });
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();

  // Pick the dracula card (mocked as mode=dark).
  await page.locator('.pmd-picker-card[data-slug="dracula"] .pmd-picker-card-apply').click();

  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.theme)
  ).toBe('dark');
});
