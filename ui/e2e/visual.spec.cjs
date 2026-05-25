const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock, screenshotPath } = require('./helpers.cjs');

test('@visual fixed chrome leaves no gap and content fills the viewport', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await expect(page.locator('.pmd-chrome')).toBeVisible();
  await expect(page.locator('#preview-pane')).toBeVisible();

  await page.screenshot({ path: screenshotPath('welcome.png') });

  const metrics = await page.evaluate(() => {
    const chrome = document.querySelector('.pmd-chrome').getBoundingClientRect();
    const pane = document.querySelector('#preview-pane').getBoundingClientRect();
    return {
      chromeBottom: chrome.bottom,
      paneTop: pane.top,
      paneBottom: pane.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(Math.abs(metrics.paneTop - metrics.chromeBottom)).toBeLessThanOrEqual(1);
  expect(metrics.paneBottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 1);
});

test('@visual theme picker previews use each theme palette', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.keyboard.press('Control+T');
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();
  const cardCount = await page.locator('.pmd-picker-card').count();
  expect(cardCount).toBeGreaterThan(2);

  await page.screenshot({ path: screenshotPath('theme-picker.png') });

  const previews = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.pmd-picker-card')).map((card) => {
      const swatches = card.querySelectorAll('.pmd-picker-preview-swatch');
      const swatchBgs = Array.from(swatches).map(s => getComputedStyle(s).backgroundColor);
      return {
        slug: card.getAttribute('data-slug'),
        swatchCount: swatches.length,
        swatchBgs,
      };
    });
  });

  const uniqueBgPairs = new Set(previews.map(p => p.swatchBgs.join('|')));
  expect(uniqueBgPairs.size).toBeGreaterThan(1);
  expect(previews.every((item) => item.swatchCount === 2)).toBe(true);
});
