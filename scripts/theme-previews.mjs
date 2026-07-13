#!/usr/bin/env node
/**
 * theme-previews.mjs — render each bundled theme to a PNG styleguide sheet.
 *
 * Usage (from repo root):
 *   node scripts/theme-previews.mjs
 *   just theme-previews
 *
 * Output:
 *   reviews/theme-previews/<slug>.png
 *   reviews/theme-previews/index.md
 *
 * Requires playwright (global or NODE_PATH). PNGs are gitignored by default.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const THEMES_DIR = path.join(ROOT, "themes");
const OUT_DIR = path.join(ROOT, "reviews", "theme-previews");

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    () => require("playwright"),
    () =>
      require(
        path.join(
          process.env.HOME || "",
          ".bun/install/global/node_modules/playwright"
        )
      ),
  ];
  for (const load of candidates) {
    try {
      return load();
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "playwright not found. Install globally (e.g. bun add -g playwright) or set NODE_PATH."
  );
}

/** Minimal palette/syntax extractor for theme manifests (no full TOML parser). */
function parseManifest(tomlText) {
  const meta = {};
  const colours = {};
  const syntax = {};
  let section = null;

  for (const raw of tomlText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section === "meta") {
      const m = line.match(/^(\w+)\s*=\s*"([^"]*)"/);
      if (m) meta[m[1]] = m[2];
      continue;
    }
    if (section === "palette") {
      const inlineSyntax = line.match(/^syntax\s*=\s*\{(.+)\}\s*$/);
      if (inlineSyntax) {
        for (const part of inlineSyntax[1].split(",")) {
          const sm = part.trim().match(/^(\w+)\s*=\s*"([^"]+)"/);
          if (sm) syntax[sm[1]] = sm[2];
        }
        continue;
      }
      const m = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
      if (m) colours[m[1]] = m[2];
    }
  }
  return { meta, colours, syntax };
}

function mixHex(a, b, t) {
  const parse = (h) => {
    const s = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const ca = parse(a);
  const cb = parse(b);
  const out = ca.map((v, i) => Math.round(v * (1 - t) + cb[i] * t));
  return (
    "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

function emitCssVars(colours, syntax) {
  const lines = [];
  for (const [k, v] of Object.entries(colours)) {
    lines.push(`  --pmd-${k.replace(/_/g, "-")}: ${v};`);
  }
  for (const [k, v] of Object.entries(syntax)) {
    lines.push(`  --pmd-syntax-${k.replace(/_/g, "-")}: ${v};`);
  }
  // Match pmd-app set_theme derivation for hover visibility.
  if (!colours.bg_muted && colours.bg_elevated && colours.fg) {
    lines.push(
      `  --pmd-bg-muted: ${mixHex(colours.bg_elevated, colours.fg, 0.1)};`
    );
  }
  if (!colours.surface && colours.bg_elevated) {
    lines.push(`  --pmd-surface: ${colours.bg_elevated};`);
  }
  return lines.join("\n");
}

function buildSheetHtml(theme) {
  const { meta, colours, syntax } = theme;
  const mode = meta.mode || "dark";
  const name = meta.name || meta.slug || "Theme";
  const slug = meta.slug || "theme";
  const vars = emitCssVars(colours, syntax);
  const selBg = colours.selection_bg || "#888";
  const selFg = colours.selection_fg || "#000";

  return `<!DOCTYPE html>
<html lang="en" data-theme="${mode}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(name)} — theme sheet</title>
<style>
  :root {
${vars}
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--pmd-bg);
    color: var(--pmd-fg);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  body { padding: 20px; width: 1100px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: var(--pmd-fg-muted); font-size: 12px; margin-bottom: 16px; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .panel {
    background: var(--pmd-bg-elevated);
    border: 1px solid var(--pmd-border);
    border-radius: 8px;
    padding: 12px;
  }
  .panel h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--pmd-fg-muted);
    margin: 0 0 10px;
  }
  /* Chrome bar */
  .chrome {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--pmd-bg-elevated);
    border: 1px solid var(--pmd-border);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 16px;
  }
  .chrome .title { flex: 1; font-weight: 600; }
  .tab {
    padding: 4px 10px;
    border-radius: 6px;
    background: transparent;
    color: var(--pmd-fg);
    border: 1px solid transparent;
  }
  .tab.active {
    background: var(--pmd-bg-muted);
    border-color: var(--pmd-border);
  }
  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--pmd-border);
    background: var(--pmd-bg);
    color: var(--pmd-fg);
    cursor: default;
  }
  .btn.primary {
    background: var(--pmd-accent);
    color: var(--pmd-bg);
    border-color: var(--pmd-accent);
  }
  /* Menu */
  .menu {
    background: var(--pmd-bg-elevated);
    border: 1px solid var(--pmd-border);
    border-radius: 8px;
    padding: 4px;
    min-width: 220px;
  }
  .menu-item {
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--pmd-fg);
  }
  .menu-item[data-highlighted] {
    background: var(--pmd-bg-muted);
  }
  .menu-item.muted { color: var(--pmd-fg-muted); font-size: 12px; }
  /* Sidebar rows */
  .sidebar-row {
    padding: 6px 8px;
    border-radius: 4px;
    color: var(--pmd-fg);
  }
  .sidebar-row[data-highlighted] {
    background: var(--pmd-bg-muted);
  }
  .sidebar-row.active {
    background: var(--pmd-bg-muted);
    color: var(--pmd-accent);
  }
  /* Editor / preview */
  .editor {
    background: var(--pmd-bg);
    border: 1px solid var(--pmd-border);
    border-radius: 6px;
    padding: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    min-height: 120px;
  }
  .preview {
    background: var(--pmd-bg);
    border: 1px solid var(--pmd-border);
    border-radius: 6px;
    padding: 10px;
    min-height: 120px;
  }
  .preview h3 { margin: 0 0 8px; font-size: 16px; }
  .preview a { color: var(--pmd-link); }
  .preview code {
    background: var(--pmd-inline-code-bg);
    color: var(--pmd-inline-code-fg);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }
  .preview pre {
    background: var(--pmd-code-block-bg);
    color: var(--pmd-code-block-fg);
    border: 1px solid var(--pmd-code-block-border);
    border-radius: 6px;
    padding: 8px;
    margin: 8px 0 0;
    font-size: 12px;
  }
  .preview blockquote {
    margin: 8px 0 0;
    padding-left: 10px;
    border-left: 3px solid var(--pmd-blockquote-bar);
    color: var(--pmd-blockquote-fg);
  }
  .preview table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 8px;
    font-size: 12px;
  }
  .preview th {
    background: var(--pmd-table-header-bg);
    border: 1px solid var(--pmd-table-border);
    padding: 4px 6px;
    text-align: left;
  }
  .preview td {
    border: 1px solid var(--pmd-table-border);
    padding: 4px 6px;
  }
  .preview tr:nth-child(even) td {
    background: var(--pmd-table-row-alt);
  }
  /* Selection demo */
  .selection-demo {
    padding: 10px;
    background: var(--pmd-bg);
    border: 1px solid var(--pmd-border);
    border-radius: 6px;
  }
  .selection-demo .sel {
    background: ${selBg};
    color: ${selFg};
    padding: 2px 4px;
  }
  /* Swatches */
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch {
    width: 48px;
    text-align: center;
    font-size: 9px;
    color: var(--pmd-fg-muted);
  }
  .swatch i {
    display: block;
    width: 48px;
    height: 28px;
    border-radius: 4px;
    border: 1px solid var(--pmd-border);
    margin-bottom: 2px;
  }
  .syntax span { margin-right: 8px; font-family: ui-monospace, monospace; font-size: 12px; }
  .admon {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .admon span {
    padding: 4px 8px;
    border-radius: 4px;
    border-left: 3px solid;
    background: var(--pmd-bg-muted);
    font-size: 12px;
  }
  .full { grid-column: 1 / -1; }
</style>
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <div class="meta">${escapeHtml(slug)} · ${escapeHtml(mode)} · Grok Build theme sheet</div>

  <div class="chrome">
    <span class="title">btr-md</span>
    <span class="tab">README.md</span>
    <span class="tab active">notes.md</span>
    <button class="btn" type="button">Open</button>
    <button class="btn primary" type="button">Theme</button>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>Menu (hover forced)</h2>
      <div class="menu">
        <div class="menu-item">New File</div>
        <div class="menu-item" data-highlighted>Open…</div>
        <div class="menu-item">Save</div>
        <div class="menu-item muted">Recent</div>
      </div>
    </div>

    <div class="panel">
      <h2>Sidebar rows</h2>
      <div class="sidebar-row">src/</div>
      <div class="sidebar-row active">main.ts</div>
      <div class="sidebar-row" data-highlighted>theme_apply.ts</div>
      <div class="sidebar-row">styles/</div>
    </div>

    <div class="panel">
      <h2>Editor</h2>
      <div class="editor">
        <span style="color:var(--pmd-syntax-keyword)">fn</span>
        <span style="color:var(--pmd-syntax-function)">main</span>() {<br/>
        &nbsp;&nbsp;<span style="color:var(--pmd-syntax-comment)">// hello</span><br/>
        &nbsp;&nbsp;<span style="color:var(--pmd-syntax-keyword)">let</span>
        <span style="color:var(--pmd-syntax-variable)">x</span>
        <span style="color:var(--pmd-syntax-operator)">=</span>
        <span style="color:var(--pmd-syntax-number)">42</span>;<br/>
        &nbsp;&nbsp;<span style="color:var(--pmd-syntax-function)">println!</span>(
        <span style="color:var(--pmd-syntax-string)">"hi"</span>);<br/>
        }
      </div>
    </div>

    <div class="panel">
      <h2>Preview markdown</h2>
      <div class="preview">
        <h3>Heading</h3>
        <p>Body with a <a href="#">link</a> and <code>inline code</code>.</p>
        <blockquote>Quoted note</blockquote>
        <pre><code>code block line</code></pre>
        <table>
          <thead><tr><th>Col A</th><th>Col B</th></tr></thead>
          <tbody>
            <tr><td>one</td><td>two</td></tr>
            <tr><td>three</td><td>four</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2>Selection</h2>
      <div class="selection-demo">
        Normal text with <span class="sel">selected span</span> in the middle.
      </div>
      <div class="admon">
        <span style="border-color:var(--pmd-admonition-note)">Note</span>
        <span style="border-color:var(--pmd-admonition-warn)">Warn</span>
        <span style="border-color:var(--pmd-admonition-tip)">Tip</span>
      </div>
    </div>

    <div class="panel">
      <h2>Palette swatches</h2>
      <div class="swatches">
        ${swatch("bg", colours.bg)}
        ${swatch("elev", colours.bg_elevated)}
        ${swatch("fg", colours.fg)}
        ${swatch("muted", colours.fg_muted)}
        ${swatch("accent", colours.accent)}
        ${swatch("link", colours.link)}
        ${swatch("border", colours.border)}
        ${swatch("sel", colours.selection_bg)}
      </div>
      <div class="syntax" style="margin-top:10px">
        <span style="color:var(--pmd-syntax-keyword)">kw</span>
        <span style="color:var(--pmd-syntax-string)">str</span>
        <span style="color:var(--pmd-syntax-number)">num</span>
        <span style="color:var(--pmd-syntax-function)">fn</span>
        <span style="color:var(--pmd-syntax-type)">ty</span>
        <span style="color:var(--pmd-syntax-comment)">//c</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function swatch(label, hex) {
  const c = hex || "#888888";
  return `<div class="swatch"><i style="background:${c}"></i>${escapeHtml(label)}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listThemes() {
  return fs
    .readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) =>
      fs.existsSync(path.join(THEMES_DIR, slug, "manifest.toml"))
    )
    .sort();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const slugs = listThemes();
  if (slugs.length === 0) {
    console.error("No themes found under", THEMES_DIR);
    process.exit(1);
  }

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1140, height: 900 },
    deviceScaleFactor: 1,
  });

  const rows = [];
  for (const slug of slugs) {
    const toml = fs.readFileSync(
      path.join(THEMES_DIR, slug, "manifest.toml"),
      "utf8"
    );
    const parsed = parseManifest(toml);
    if (!parsed.meta.slug) parsed.meta.slug = slug;
    const html = buildSheetHtml(parsed);
    const htmlPath = path.join(OUT_DIR, `${slug}.html`);
    fs.writeFileSync(htmlPath, html, "utf8");

    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: "networkidle",
    });
    // Fit height to content.
    const height = await page.evaluate(
      () => Math.ceil(document.documentElement.scrollHeight)
    );
    await page.setViewportSize({
      width: 1140,
      height: Math.min(Math.max(height + 20, 400), 2000),
    });
    const pngPath = path.join(OUT_DIR, `${slug}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });
    const name = parsed.meta.name || slug;
    const mode = parsed.meta.mode || "?";
    rows.push({ slug, name, mode, png: `${slug}.png` });
    console.log(`wrote ${path.relative(ROOT, pngPath)}`);
  }

  await browser.close();

  const index = [
    "# Theme previews",
    "",
    "Generated by `just theme-previews` / `node scripts/theme-previews.mjs`.",
    "PNG files are local review artifacts (gitignored); re-run the tool to refresh.",
    "",
    "| Theme | Mode | Preview |",
    "| --- | --- | --- |",
    ...rows.map(
      (r) => `| ${r.name} (\`${r.slug}\`) | ${r.mode} | ![${r.slug}](${r.png}) |`
    ),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "index.md"), index, "utf8");
  console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, "index.md"))}`);
  console.log(`Done: ${rows.length} themes → ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
