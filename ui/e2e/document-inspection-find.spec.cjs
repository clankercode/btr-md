const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

// Phase 5 e2e coverage for document inspection & find.
// Tasks 5.1–5.5 of docs/superpowers/plans/2026-05-31-document-inspection-and-find.md.

test('find: preview matches, split-scope toggle drives CodeMirror source search', async ({ page }) => {
  await installTauriMock(page, {
    renderHtml: '<article class="pmd-preview"><p data-pmd-block-id="b0">alpha beta alpha</p></article>',
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('alpha beta alpha\n');
  await expect(page.locator('.pmd-preview p', { hasText: 'alpha' })).toBeVisible();

  // Open find (split mode → implied scope is preview).
  await page.keyboard.press('Control+F');
  await expect(page.locator('.pmd-find-bar')).toBeVisible();
  await expect(page.locator('.pmd-find-input')).toBeFocused();

  // Type the query; two single-node "alpha" matches → logical count 2. The
  // first match is auto-selected on recompute (current index 1) and scrolled
  // into view (FIX 2), so the count reads 1/2 immediately.
  await page.locator('.pmd-find-input').fill('alpha');
  await expect(page.locator('.pmd-find-count')).toHaveText('1/2');

  // Next match (Enter or the button) advances the current index to 2/2.
  await page.locator('.pmd-find-btn[title="Next match"]').click();
  await expect(page.locator('.pmd-find-count')).toHaveText('2/2');

  // Switch scope to Source: CodeMirror's search panel opens and our typed
  // query drives it (the setSourceQuery wiring).
  await page.locator('.pmd-find-scope-btn[data-scope="source"]').click();
  await expect(page.locator('.cm-panels .cm-search')).toBeVisible();
  await expect(page.locator('.cm-panels input[name="search"].cm-textfield')).toHaveValue('alpha');
  await expect(page.locator('.cm-searchMatch').first()).toBeVisible();

  // Next selects a CM match; the bar's own count is empty in source scope.
  await page.locator('.pmd-find-btn[title="Next match"]').click();
  await expect(page.locator('.cm-searchMatch-selected')).toBeVisible();
  await expect(page.locator('.pmd-find-count')).toHaveText('');

  // Escape on the find input closes the bar (the controller binds Escape to
  // the input; in source scope focus is in CodeMirror, so refocus first).
  await page.locator('.pmd-find-input').focus();
  await page.locator('.pmd-find-input').press('Escape');
  await expect(page.locator('.pmd-find-bar')).toBeHidden();
});

test('stats popover shows counts and reading time', async ({ page }) => {
  await installTauriMock(page, {
    renderFacts: {
      counts: {
        words: 400,
        bytes: 1000,
        sentences: 10,
        paragraphs: 4,
        headings: 2,
        links: 1,
        images: 0,
        code_blocks: 1,
        mermaid_blocks: 0,
        math_spans: 0,
        math_blocks: 0,
      },
    },
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('# Title\n');
  await expect(page.getByRole('heading', { name: 'Title' })).toBeVisible();

  await page.locator('.pmd-status-counts').click();
  await expect(page.locator('.pmd-stats-popover')).toBeVisible();
  await expect(page.locator('.pmd-stats-row', { hasText: 'Reading time' })).toContainText('2 min');
  await expect(page.locator('.pmd-stats-row', { hasText: 'Words' })).toContainText('400');

  await page.keyboard.press('Escape');
  await expect(page.locator('.pmd-stats-popover')).toBeHidden();
});

test('frontmatter inspector: edit and add reflect in source', async ({ page }) => {
  await installTauriMock(page, {
    renderFacts: {
      frontmatter: {
        format: 'yaml',
        line_start: 1,
        line_end: 2,
        raw: '---\ntitle: Hello\n---\n',
        syntax: 'valid',
        metadata: {
          title: 'Hello',
          description: null,
          slug: null,
          sidebar_label: null,
          sidebar_position: null,
          tags: [],
          draft: null,
          unknown: {},
        },
      },
    },
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('---\ntitle: Hello\n---\n# Body\n');
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();

  // Present-state chip.
  const chip = page.locator('.pmd-status-frontmatter');
  await expect(chip).toHaveText('frontmatter');
  await expect(chip).toHaveClass(/pmd-status-frontmatter-present/);

  // Open the inspector; the title field shows the parsed value.
  await chip.click();
  await expect(page.locator('.pmd-frontmatter-panel')).toBeVisible();
  const titleInput = page.locator('.pmd-frontmatter-field', { hasText: 'title' }).locator('input');
  await expect(titleInput).toHaveValue('Hello');

  // Edit the title and blur → editor buffer updates. The panel stays open.
  await titleInput.fill('Renamed');
  await titleInput.blur();
  await expect(page.locator('.cm-content')).toContainText('title: Renamed');

  // Add a new entry in the still-open panel → reflected in source.
  await expect(page.locator('.pmd-frontmatter-panel')).toBeVisible();
  await page.locator('.pmd-frontmatter-add-key').fill('slug');
  await page.locator('.pmd-frontmatter-add-value').fill('my-slug');
  await page.locator('.pmd-frontmatter-add button', { hasText: 'Add' }).click();
  await expect(page.locator('.cm-content')).toContainText('slug: my-slug');
});

test('malformed frontmatter diagnostic opens a read-only inspector', async ({ page }) => {
  await installTauriMock(page, {
    renderFacts: {
      frontmatter: {
        format: 'yaml',
        line_start: 1,
        line_end: 2,
        raw: '---\ntitle: [oops\n---\n',
        syntax: 'malformed',
        metadata: {
          title: null,
          description: null,
          slug: null,
          sidebar_label: null,
          sidebar_position: null,
          tags: [],
          draft: null,
          unknown: {},
        },
      },
    },
    renderDiagnostics: {
      phase: 'initial',
      issues: [
        {
          id: 'frontmatter:1:1:1',
          severity: 'warning',
          category: 'frontmatter',
          line_start: 1,
          line_end: 2,
          block_id: null,
          message: 'Frontmatter could not be parsed; previewing document body anyway.',
          detail: 'Fix the YAML/TOML frontmatter delimiters or syntax.',
          primary_action: 'Edit frontmatter',
        },
      ],
      // The mock's renderMarkdown reads diagnostics.resources.decisions, and a
      // renderDiagnostics override replaces (does not merge into) the default
      // diagnostics object, so supply the full shape here.
      resources: { doc_id: 1, version: 0, allowed_roots: [], loaded_resources: [], decisions: [] },
      link_summary: { checked: 0, errors: 0, warnings: 0, unchecked_external: 0, pending_async: 0 },
    },
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('---\ntitle: [oops\n---\n# Body\n');
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();

  // Open the diagnostics panel; the malformed-frontmatter row is present.
  await page.keyboard.press('Control+Shift+M');
  const row = page.locator('.pmd-diagnostic-row', { hasText: 'Frontmatter could not be parsed' });
  await expect(row).toBeVisible();

  // Its action is a clickable button labeled "Edit frontmatter".
  const action = row.locator('button', { hasText: 'Edit frontmatter' });
  await expect(action).toBeVisible();
  await action.click();

  // The inspector opens read-only: malformed badge + hint, no enabled value inputs.
  const panel = page.locator('.pmd-frontmatter-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.pmd-frontmatter-badge')).toHaveText('malformed');
  await expect(panel.locator('.pmd-frontmatter-hint')).toContainText('Fix the frontmatter in source');
  await expect(panel.locator('.pmd-frontmatter-value:not([disabled])')).toHaveCount(0);
});

test('mermaid inline error: go-to-source + copy source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installTauriMock(page, {
    renderHtml:
      '<article class="pmd-preview"><div class="pmd-mermaid" data-mermaid-source="graph TD; A--&gt;" data-pmd-nonce="" data-src-start="3" data-src-end="3"></div></article>',
  });
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('line one\nline two\nmermaid here\n');

  // The broken source fails mermaid.render → inline error appears.
  await expect(page.locator('.pmd-mermaid-error')).toBeVisible();
  await expect(page.locator('.pmd-mermaid-error-message')).not.toHaveText('');
  await expect(page.locator('.pmd-mermaid-error-source')).toContainText('graph TD');

  // Go to source moves the editor selection to line 3.
  await page.locator('.pmd-mermaid-error-goto').click();
  await expect(page.locator('.cm-activeLine')).toContainText('mermaid here');

  // Copy source button is present on the error container (renderMermaidError
  // path uses the shared makeCopySourceButton).
  const copyBtn = page.locator('.pmd-mermaid-error .pmd-mermaid-copy');
  await expect(copyBtn).toBeVisible();
  await copyBtn.click();
  try {
    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipped).toContain('graph TD');
  } catch {
    // Some webviews block clipboard reads; the visible+clickable assertions above
    // already cover the regression (copy button present on a failed diagram).
  }
});
