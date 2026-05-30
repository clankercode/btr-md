const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

test('initializes through @tauri-apps/api without requiring window.__TAURI__', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await installTauriMock(page);
  await page.goto(appUrl());

  await expect(page.locator('.pmd-welcome')).toContainText('btr.md');

  const state = await page.evaluate(() => ({
    hasGlobalTauri: typeof window.__TAURI__ !== 'undefined',
    commands: window.__pmdInvocations.map((item) => item.cmd),
  }));

  expect(state.hasGlobalTauri).toBe(false);
  expect(state.commands).toContain('get_recent_files');
  expect(state.commands).toContain('get_initial_path');
  expect(consoleErrors.filter((text) => text.includes('__TAURI__'))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
