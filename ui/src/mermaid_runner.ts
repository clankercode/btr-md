import mermaid from 'mermaid';
import { addMermaidExpandButton } from './mermaid_zoom.js';

let initialised = false;
let currentThemeVars: Record<string, string> = {};

// Rendered-SVG cache keyed by diagram source. The preview is rebuilt wholesale
// on every render, which would otherwise re-run mermaid.render (tens of ms each)
// for every diagram on each keystroke. Caching lets unchanged diagrams reuse
// their SVG instantly; only edited/new diagrams actually re-render. SVG embeds
// the active theme colours, so the cache is cleared whenever mermaid re-inits
// with new theme variables. Bounded so editing a diagram char-by-char (a new
// entry per intermediate source) cannot grow memory without limit.
const SVG_CACHE_LIMIT = 256;
// Each entry keeps the rendered SVG and the exact id mermaid stamped into it,
// so cache hits can swap that id for a fresh one (see below).
interface CachedSvg {
  svg: string;
  id: string;
}
const svgCache = new Map<string, CachedSvg>();

function cacheSvg(source: string, entry: CachedSvg) {
  if (svgCache.size >= SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(source, entry);
}

// Mermaid stamps the render id into the SVG root and as a prefix on every
// internal element id / `url(#...)` reference. Reusing a cached SVG verbatim
// for the *same source appearing twice* would duplicate those ids, so markers /
// clip-paths / styles could resolve to the wrong instance. On a cache hit we
// therefore swap the entry's original id for a freshly generated one. The id is
// long and random (not a predictable token), so it cannot realistically appear
// in literal diagram text and corrupt the swap.
let mermaidIdSeq = 0;

function freshMermaidId(): string {
  mermaidIdSeq += 1;
  return `pmd-mermaid-${mermaidIdSeq}-${Math.random().toString(36).slice(2)}`;
}

function reIdSvg(entry: CachedSvg): string {
  return entry.svg.split(entry.id).join(freshMermaidId());
}

// The current theme's mermaid variables, set synchronously by `applyTheme`
// (see main.ts) before any diagram is drawn. Every render passes these to
// `ensureInit`, so the *initial* render already uses the active theme's
// colours rather than mermaid's defaults — `ensureInit` only re-inits when
// the vars actually change.
let latestThemeVars: Record<string, string> = {};

export function setMermaidTheme(vars: Record<string, string>) {
  latestThemeVars = vars ? { ...vars } : {};
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function ensureInit(vars?: Record<string, string>) {
  let shouldInitialize = !initialised;
  if (vars) {
    if (!shallowEqual(currentThemeVars, vars)) {
      currentThemeVars = { ...vars };
      shouldInitialize = true;
    }
  }
  if (shouldInitialize) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: currentThemeVars,
    });
    // Cached SVGs bake in the previous theme's colours; drop them on re-init.
    svgCache.clear();
    initialised = true;
  }
}

export async function renderMermaidNodes(root: HTMLElement, renderNonce: string) {
  ensureInit(latestThemeVars);
  const targets = collectMermaidTargets(root, renderNonce);
  for (const target of targets) {
    await renderMermaidNode(target, renderNonce);
  }
}

export async function renderMermaidNode(target: HTMLElement, renderNonce?: string) {
  ensureInit(latestThemeVars);
  const container = ensureMermaidContainer(target, renderNonce);
  if (!container) return;
  const source = container.dataset.mermaidSource ?? "";
  const cached = svgCache.get(source);
  if (cached !== undefined) {
    container.classList.remove("pmd-mermaid-error");
    container.innerHTML = reIdSvg(cached);
    addMermaidExpandButton(container);
    return;
  }
  try {
    const id = freshMermaidId();
    const { svg } = await mermaid.render(id, source);
    cacheSvg(source, { svg, id });
    // The freshly-rendered svg already carries a unique id, so insert verbatim
    // this once; later hits re-id via reIdSvg().
    container.classList.remove("pmd-mermaid-error");
    container.innerHTML = svg;
    addMermaidExpandButton(container);
  } catch (e) {
    container.classList.add("pmd-mermaid-error");
    container.textContent = source;
  }
}

// Only render nodes that `markMermaidNodes` flagged for the current backend
// render nonce. Raw HTML can preserve syntax classes, but it cannot pre-seed
// the JS-added renderer source/class pair with the matching nonce.
function collectMermaidTargets(root: HTMLElement, renderNonce: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".pmd-mermaid[data-mermaid-source][data-pmd-nonce]"))
    .filter((target) => target.dataset.pmdNonce === renderNonce);
}

function ensureMermaidContainer(target: HTMLElement, renderNonce?: string): HTMLElement | null {
  if (target.classList.contains("pmd-mermaid")) {
    if (renderNonce && target.dataset.pmdNonce !== renderNonce) return null;
    return target;
  }

  const code = target.matches("code.language-mermaid")
    ? target
    : target.querySelector<HTMLElement>("code.language-mermaid");
  if (renderNonce && code?.dataset.pmdNonce !== renderNonce) return null;
  const container = document.createElement("div");
  container.className = "pmd-mermaid";
  container.dataset.mermaidSource = code?.textContent ?? target.textContent ?? "";
  if (code?.dataset.pmdNonce) {
    container.dataset.pmdNonce = code.dataset.pmdNonce;
  }
  copySourceRange(target, container);
  target.replaceWith(container);
  return container;
}

function copySourceRange(from: HTMLElement, to: HTMLElement) {
  if (from.dataset.srcStart) {
    to.dataset.srcStart = from.dataset.srcStart;
  }
  if (from.dataset.srcEnd) {
    to.dataset.srcEnd = from.dataset.srcEnd;
  }
}
