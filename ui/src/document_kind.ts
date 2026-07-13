// Document kind detection for the editor language mode and styles prompt.
// Mirrors `pmd_core::document_kind` so the UI can switch modes before a render
// round-trip (and stay consistent with the backend when a path is known).

export type DocumentKind =
  | 'markdown'
  | 'html'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'ini';

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd']);
const HTML_EXT = new Set(['html', 'htm']);
const JSON_EXT = new Set(['json', 'jsonc']);
const YAML_EXT = new Set(['yaml', 'yml']);
const TOML_EXT = new Set(['toml']);
const INI_EXT = new Set(['ini', 'cfg', 'conf', 'properties']);

/** All openable document extensions (keep in sync with path_scope / core). */
export const DOCUMENT_EXTENSIONS = [
  'md',
  'markdown',
  'mdown',
  'mkd',
  'html',
  'htm',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
] as const;

function extensionOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function kindFromPath(path: string | null | undefined): DocumentKind | null {
  const ext = extensionOf(path);
  if (!ext) return null;
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (HTML_EXT.has(ext)) return 'html';
  if (JSON_EXT.has(ext)) return 'json';
  if (YAML_EXT.has(ext)) return 'yaml';
  if (TOML_EXT.has(ext)) return 'toml';
  if (INI_EXT.has(ext)) return 'ini';
  return null;
}

/**
 * True when `source` (after optional UTF-8 BOM + leading whitespace) starts
 * with `<!doctype html` or `<html` (case-insensitive).
 */
export function looksLikeHtml(source: string): boolean {
  let s = source;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.trimStart();
  if (!s) return false;
  const prefix = s.slice(0, 128).toLowerCase();
  if (prefix.startsWith('<!doctype html')) return true;
  if (prefix.startsWith('<html')) {
    const next = prefix.charCodeAt(5);
    // end / '>' / whitespace / '/'
    return (
      prefix.length === 5 ||
      next === 0x3e /* > */ ||
      next === 0x2f /* / */ ||
      (next >= 9 && next <= 13) ||
      next === 0x20
    );
  }
  return false;
}

/** Path extension wins; otherwise HTML content sniff; default markdown. */
export function detectDocumentKind(
  path: string | null | undefined,
  source: string,
): DocumentKind {
  const fromPath = kindFromPath(path);
  if (fromPath) return fromPath;
  if (looksLikeHtml(source)) return 'html';
  return 'markdown';
}
