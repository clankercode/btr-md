const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

async function openEditor(page) {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function openCommandOverlay(page) {
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
}

async function runCommand(page, query) {
  await openCommandOverlay(page);
  await page.getByRole('searchbox', { name: 'Search commands' }).fill(query);
  await page.keyboard.press('Enter');
}

async function setShortcutInput(page, label, value) {
  const input = page.getByLabel(`${label} shortcuts`);
  await input.fill(value);
  await input.evaluate((node) => node.dispatchEvent(new Event('change', { bubbles: true })));
}

test('command overlay runs actions from the keyboard', async ({ page }) => {
  await openEditor(page);

  await runCommand(page, 'Keyboard shortcuts');

  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

test('shortcut editor detects conflicts and persists a usable override', async ({ page }) => {
  await openEditor(page);
  await runCommand(page, 'Keyboard shortcuts');

  await setShortcutInput(page, 'Keyboard shortcuts', 'Ctrl+P');
  await expect(page.getByRole('alert')).toContainText('Shortcut conflict: Ctrl+P');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.getByRole('button', { name: 'Restore all default shortcuts' }).click();
  await setShortcutInput(page, 'Command overlay', 'Ctrl+K');
  await expect(page.getByRole('alert')).toBeEmpty();
  await page.getByRole('button', { name: 'Save' }).click();

  const saved = await page.evaluate(() => {
    const calls = window.__pmdInvocations.filter((call) => call.cmd === 'set_shortcut_overrides');
    return calls.at(-1)?.args?.overrides ?? null;
  });
  expect(saved).toEqual({ 'navigate.commandOverlay': ['Ctrl+K'] });

  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
});

test('standard shortcuts dispatch their visible actions', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.keyboard.press('Control+N');
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();

  await page.keyboard.press('Alt+z');
  await expect(content).not.toHaveClass(/cm-lineWrapping/);
  await page.keyboard.press('Alt+z');
  await expect(content).toHaveClass(/cm-lineWrapping/);

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command overlay' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+T');
  await expect(page.locator('#theme-picker-overlay')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('F10');
  await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
  await expect(page.getByRole('menu')).toBeVisible();
});

test('every default shortcut reaches the action registry', async ({ page }) => {
  await openEditor(page);
  const cases = [
    ['Control+N', 'file.new'],
    ['Control+O', 'file.open'],
    ['Control+S', 'file.save'],
    ['Shift+Control+S', 'file.saveAs'],
    ['Control+W', 'file.closeTab'],
    ['Control+Q', 'app.quit'],
    ['Control+F', 'edit.find'],
    ['Control+G', 'edit.findNext'],
    ['Shift+Control+G', 'edit.findPrevious'],
    ['Control+Equal', 'view.zoomIn'],
    ['Control+Minus', 'view.zoomOut'],
    ['Control+0', 'view.zoomReset'],
    ['Control+Backslash', 'view.cycleMode'],
    ['Alt+z', 'view.toggleWordWrap'],
    ['Control+P', 'navigate.commandOverlay'],
    ['Control+Shift+O', 'navigate.outline'],
    ['Control+Shift+M', 'diagnostics.togglePanel'],
    ['Control+T', 'theme.pick'],
    ['Control+,', 'settings.open'],
    ['Control+/', 'help.shortcuts'],
    ['F10', 'menu.focus'],
  ];

  for (const [shortcut] of cases) {
    await page.keyboard.press(shortcut);
    await page.keyboard.press('Escape');
  }

  const actionIds = await page.evaluate(() => window.__pmdE2eActions ?? []);
  expect(actionIds).toEqual(cases.map(([, actionId]) => actionId));
});
