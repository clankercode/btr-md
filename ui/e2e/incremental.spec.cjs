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
    const resultFor = (args, md, html, blocks) => {
      const docId = args.docId ?? args.doc_id ?? 1;
      const version = args.version ?? 0;
      const facts = {
        doc_id: docId,
        version,
        headings: [],
        anchors: [],
        links: [],
        reference_definitions: [],
        images: [],
        frontmatter: null,
        blocks: [],
        embedded: { code_blocks: [], mermaid_blocks: [], math_spans: [], math_blocks: [] },
        counts: {
          words: md.trim().split(/\s+/).filter(Boolean).length,
          bytes: md.length,
          sentences: 0,
          paragraphs: blocks.length,
          headings: 0,
          links: 0,
          images: 0,
          code_blocks: 0,
          mermaid_blocks: 0,
          math_spans: 0,
          math_blocks: 0,
        },
      };
      return {
        doc_id: docId,
        html,
        version,
        render_nonce: `n-${version}`,
        source_map: [],
        blocks,
        facts,
        diagnostics: {
          doc_id: docId,
          version,
          phase: 'initial',
          issues: [],
          resources: { doc_id: docId, version, allowed_roots: [], loaded_resources: [], decisions: [] },
          link_summary: { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 },
        },
      };
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
      return resultFor(args, md, html, blocks);
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

test('inserted top-level code block is decorated with pmd-code-toolbar', async ({ page }) => {
  // Custom mock that emits <pre data-pmd-block=...> for fenced code chunks.
  await installTauriMock(page);
  await page.addInitScript(() => {
    const internals = window.__TAURI_INTERNALS__;
    const orig = internals.invoke.bind(internals);
    const hash = (s) => {
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8);
    };
    const resultFor = (args, md, html, blocks, codeBlockCount) => {
      const docId = args.docId ?? args.doc_id ?? 1;
      const version = args.version ?? 0;
      const facts = {
        doc_id: docId,
        version,
        headings: [],
        anchors: [],
        links: [],
        reference_definitions: [],
        images: [],
        frontmatter: null,
        blocks: [],
        embedded: { code_blocks: [], mermaid_blocks: [], math_spans: [], math_blocks: [] },
        counts: {
          words: md.trim().split(/\s+/).filter(Boolean).length,
          bytes: md.length,
          sentences: 0,
          paragraphs: blocks.length,
          headings: 0,
          links: 0,
          images: 0,
          code_blocks: codeBlockCount,
          mermaid_blocks: 0,
          math_spans: 0,
          math_blocks: 0,
        },
      };
      return {
        doc_id: docId,
        html,
        version,
        render_nonce: `n-${version}`,
        source_map: [],
        blocks,
        facts,
        diagnostics: {
          doc_id: docId,
          version,
          phase: 'initial',
          issues: [],
          resources: { doc_id: docId, version, allowed_roots: [], loaded_resources: [], decisions: [] },
          link_summary: { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 },
        },
      };
    };
    internals.invoke = async (cmd, args) => {
      if (cmd !== 'render_cmd') return orig(cmd, args);
      const md = String(args.markdown ?? '');
      let line = 1, html = '', blocks = [];
      let codeBlockCount = 0;
      for (const raw of md.split(/(\n{2,})/)) {
        if (/^\n{2,}$/.test(raw)) { line += (raw.match(/\n/g) || []).length; continue; }
        if (!raw.trim()) { continue; }
        const key = hash(raw);
        const start = line;
        const end = line + (raw.match(/\n/g) || []).length;
        // Detect fenced code block: starts with ```
        const fenceMatch = raw.match(/^```(\w*)\n?([\s\S]*?)```\s*$/);
        if (fenceMatch) {
          const lang = fenceMatch[1] || 'text';
          const body = (fenceMatch[2] || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += `<pre data-pmd-block="${key}" data-src-start="${start}" data-src-end="${end}"><code class="language-${lang}">${body}</code></pre>`;
          codeBlockCount += 1;
        } else {
          const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += `<p data-pmd-block="${key}" data-src-start="${start}" data-src-end="${end}">${text}</p>`;
        }
        blocks.push({ key, base_line: start });
        line = end + 1;
      }
      return resultFor(args, md, html, blocks, codeBlockCount);
    };
  });

  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await content.click();

  // First render: just a paragraph (no code block yet)
  await page.keyboard.type('Hello world');
  await page.waitForTimeout(300);

  // Second render: append a new fenced code block as a second top-level block
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Hello world\n\n```rust\nfn main() {}\n```');
  await page.waitForTimeout(300);

  // The newly inserted top-level <pre> must have been decorated by decorateCodeBlocks:
  // it should be wrapped in a figure.pmd-code-block containing a .pmd-code-toolbar.
  const codeBlock = page.locator('#pmd-content .pmd-code-block');
  await expect(codeBlock).toBeVisible();
  const toolbar = codeBlock.locator('.pmd-code-toolbar');
  await expect(toolbar).toBeVisible();
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
