const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

async function installBlockRenderMock(page) {
  await installTauriMock(page);
  await page.addInitScript(() => {
    const internals = window.__TAURI_INTERNALS__;
    const orig = internals.invoke.bind(internals);
    const hash = (s) => {
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8);
    };
    internals.invoke = async (cmd, args) => {
      if (cmd !== 'render_cmd') return orig(cmd, args);
      const md = String(args.markdown ?? '');
      let line = 1, html = '', blocks = [];
      for (const raw of md.split(/(\n{2,})/)) {
        if (/^\n{2,}$/.test(raw)) { line += (raw.match(/\n/g) || []).length; continue; }
        if (!raw.trim()) { continue; }
        const key = hash(raw);
        const start = line;
        const end = line + (raw.match(/\n/g) || []).length;
        const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<p data-pmd-block="${key}" data-src-start="${start}" data-src-end="${end}">${text}</p>`;
        blocks.push({ key, base_line: start });
        line = end + 1;
      }
      return { html, version: args.version ?? 0, render_nonce: 'n', source_map: [], blocks };
    };
  });
}

test('editing one block leaves the other block nodes identical', async ({ page }) => {
  await installBlockRenderMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await content.click();

  await page.keyboard.type('Alpha block\n\nBeta block\n\nGamma block');
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    document.querySelectorAll('#pmd-content [data-pmd-block]')
      .forEach((el, i) => { el.__probe = `probe-${i}`; });
  });

  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Alpha block\n\nBeta CHANGED\n\nGamma block');
  await page.waitForTimeout(250);

  const probes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#pmd-content [data-pmd-block]')).map((el) => el.__probe ?? null));

  expect(probes[0]).toBe('probe-0');
  expect(probes[2]).toBe('probe-2');
  expect(probes[1]).toBeNull();
});

test('inserting a line above shifts data-src on an unchanged block without recreating it', async ({ page }) => {
  await installBlockRenderMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.type('First\n\nSecond');
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const els = document.querySelectorAll('#pmd-content [data-pmd-block]');
    els[els.length - 1].__probe = 'last';
  });

  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Zero\n\n');
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => {
    const last = document.querySelector('#pmd-content [data-pmd-block]:last-child');
    return { probe: last?.__probe ?? null, srcStart: last?.getAttribute('data-src-start') };
  });
  expect(result.probe).toBe('last');
  expect(Number(result.srcStart)).toBeGreaterThan(2);
});
