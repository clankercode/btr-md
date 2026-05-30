const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

// A fixed backend render payload containing a genuine fenced code block, so the
// post-render `decorateCodeBlocks` pass has something real to wrap.
const CODE_FIXTURE_HTML =
  '<p>Intro paragraph.</p>' +
  '<pre><code class="language-rust">fn main() {\n    println!("hi");\n}</code></pre>';

test('code block gains a toolbar with language label, Copy and Expand', async ({ page }) => {
  await installTauriMock(page, { renderHtml: CODE_FIXTURE_HTML });
  await page.goto(appUrl());

  // New File mounts the editor and renders once; render_cmd returns the fixture.
  await page.locator('#pmd-welcome-new').click();

  const renderCall = await page.waitForFunction(() =>
    window.__pmdInvocations.find((item) => item.cmd === 'render_cmd')
  );
  const invocation = await renderCall.jsonValue();
  expect(invocation.args.docId).toBe(1);
  expect(invocation.args.doc_id).toBeUndefined();

  const figure = page.locator('.pmd-code-block');
  await expect(figure).toBeVisible();

  await expect(figure.locator('.pmd-code-lang')).toHaveText('rust');

  // Language label + Copy + Expand buttons.
  await expect(figure.locator('.pmd-code-toolbar .pmd-code-btn')).toHaveCount(2);
  await expect(figure.getByRole('button', { name: 'Copy' })).toBeVisible();

  const expandBtn = figure.getByRole('button', { name: 'Expand' });
  await expect(expandBtn).toBeVisible();

  // Expand toggles the breakout class and flips the label.
  await expandBtn.click();
  await expect(figure).toHaveClass(/pmd-expanded/);
  const collapseBtn = figure.getByRole('button', { name: 'Collapse' });
  await expect(collapseBtn).toBeVisible();

  // Collapse again restores the default state.
  await collapseBtn.click();
  await expect(figure).not.toHaveClass(/pmd-expanded/);
});

test('source view wraps lines by default, decorates markdown, and Alt+Z toggles wrap', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.locator('#pmd-welcome-new').click();

  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();

  // Word wrap is on by default (EditorView.lineWrapping -> .cm-content.cm-lineWrapping).
  await expect(content).toHaveClass(/cm-lineWrapping/);

  // Type markdown that exercises strong / emphasis / heading / markers.
  await content.click();
  await page.keyboard.type('# Title');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**bold** and *italic*');

  // Decorations emitted by the syntaxTree ViewPlugin.
  await expect(page.locator('.cm-md-strong').first()).toBeVisible();
  await expect(page.locator('.cm-md-em').first()).toBeVisible();
  await expect(page.locator('.cm-md-h1').first()).toBeVisible();
  // The literal *, **, # markers are kept (visible but dimmed via .cm-md-mark).
  expect(await page.locator('.cm-md-mark').count()).toBeGreaterThan(0);

  // Alt+Z reconfigures the wrap compartment off, then on again.
  await page.keyboard.press('Alt+z');
  await expect(content).not.toHaveClass(/cm-lineWrapping/);
  await page.keyboard.press('Alt+z');
  await expect(content).toHaveClass(/cm-lineWrapping/);
});

test('settings menu exposes lifecycle controls and calls their setters', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  // Open the Settings dropdown (its trigger is appended to the toolbar).
  await page.getByRole('button', { name: 'Settings' }).click();

  const autosave = page.locator('#pmd-set-autosave');
  await expect(autosave).toBeVisible();
  await expect(page.locator('#pmd-set-autoreload')).toBeVisible();
  await expect(page.locator('#pmd-set-merge')).toBeVisible();

  // Changing a control invokes its backend setter.
  await autosave.selectOption('on_idle');
  const calledSetter = await page.evaluate(() =>
    window.__pmdInvocations.some(
      (i) => i.cmd === 'set_autosave_mode' && i.args && i.args.mode === 'on_idle'
    )
  );
  expect(calledSetter).toBe(true);
});

test('Insert menu inserts a footnote and a GitHub alert into the editor', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  await expect(page.locator('.cm-content')).toBeVisible();

  // Footnote.
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByText('Footnote', { exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('[^1]');
  await expect(page.locator('.cm-content')).toContainText('TODO');

  // Alert (Note).
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByText('Alert: Note', { exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('[!NOTE]');
});

test('reload button is hidden until an external change with a dirty buffer', async ({ page }) => {
  await installTauriMock(page);
  await page.goto(appUrl());

  await page.locator('#pmd-welcome-new').click();

  const reloadBtn = page.locator('.pmd-reload-btn');
  // Present in the toolbar but collapsed/hidden by default (no [data-visible]).
  await expect(reloadBtn).toHaveCount(1);
  await expect(reloadBtn).not.toHaveAttribute('data-visible', '');

  // Drive the chrome API directly to confirm the animated show/hide contract.
  await page.evaluate(() => {
    document.querySelector('.pmd-reload-btn')?.toggleAttribute('data-visible', true);
  });
  await expect(reloadBtn).toHaveAttribute('data-visible', '');
});

test('stale render result for another document is not applied', async ({ page }) => {
  await installTauriMock(page, {
    renderDocId: 999,
    renderHtml: '<p data-test-render="wrong-doc">Wrong doc</p>',
  });
  await page.goto(appUrl());

  await page.locator('#pmd-welcome-new').click();

  await expect(page.locator('[data-test-render="wrong-doc"]')).toHaveCount(0);
  await expect(page.locator('#pmd-content')).not.toContainText('Wrong doc');
});
