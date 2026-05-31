/** A CodeMirror-style change: replace `[from, to)` (char offsets) with `insert`. */
export interface FmChange {
  from: number;
  to: number;
  insert: string;
}

export type FmFormat = 'yaml' | 'toml';

/** Live-doc frontmatter block boundaries, using 1-based line numbers. */
export interface FmBlock {
  format: FmFormat;
  startLine: number;
  endLine: number;
}

function lineStartOffset(doc: string, line: number): number {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const nl = doc.indexOf('\n', offset);
    if (nl === -1) return doc.length;
    offset = nl + 1;
    current += 1;
  }
  return offset;
}

function lineEndOffset(doc: string, line: number): number {
  const start = lineStartOffset(doc, line);
  const nl = doc.indexOf('\n', start);
  return nl === -1 ? doc.length : nl;
}

export function locateBlock(doc: string): FmBlock | null {
  const lines = doc.split('\n');
  const first = (lines[0] ?? '').trimEnd();
  let format: FmFormat;
  let fence: string;
  if (first === '---') {
    format = 'yaml';
    fence = '---';
  } else if (first === '+++') {
    format = 'toml';
    fence = '+++';
  } else {
    return null;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trimEnd() === fence) return { format, startLine: 1, endLine: i };
  }
  return null;
}

export function hasOpeningFence(doc: string): boolean {
  const first = (doc.split('\n', 1)[0] ?? '').trimEnd();
  return first === '---' || first === '+++';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function locateFieldLine(doc: string, block: FmBlock, key: string): number | null {
  const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*[:=]`);
  for (let line = block.startLine + 1; line <= block.endLine; line += 1) {
    const from = lineStartOffset(doc, line);
    const to = lineEndOffset(doc, line);
    if (re.test(doc.slice(from, to))) return line;
  }
  return null;
}

function isBareTomlScalar(value: string): boolean {
  if (value === 'true' || value === 'false') return true;
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value);
}

const YAML_SPECIAL = /[:#[\]{}&*!|>'"%,@`]/;
const YAML_LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

export function formatScalar(format: FmFormat, value: string): string {
  if (format === 'toml') {
    if (isBareTomlScalar(value)) return value;
    return JSON.stringify(value);
  }
  const needsQuote =
    value === '' ||
    value !== value.trim() ||
    YAML_SPECIAL.test(value) ||
    YAML_LEADING_INDICATOR.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}

export function editValueChange(doc: string, key: string, value: string): FmChange | null {
  const block = locateBlock(doc);
  if (!block) return null;
  const line = locateFieldLine(doc, block, key);
  if (line === null) return null;
  const from = lineStartOffset(doc, line);
  const to = lineEndOffset(doc, line);
  const text = doc.slice(from, to);
  const match = text.match(/^(\s*[^:=]+\s*[:=]\s*)(.*)$/);
  if (!match) return null;
  const prefix = match[1];
  const remainder = match[2];
  const comment = remainder.match(/(\s+#.*)$/)?.[1] ?? '';
  return {
    from: from + prefix.length,
    to,
    insert: `${formatScalar(block.format, value)}${comment}`,
  };
}

export function addEntryChange(doc: string, key: string, value: string): FmChange | null {
  const block = locateBlock(doc);
  if (!block) return null;
  const sep = block.format === 'toml' ? ' = ' : ': ';
  const at = lineStartOffset(doc, block.endLine + 1);
  return { from: at, to: at, insert: `${key}${sep}${formatScalar(block.format, value)}\n` };
}

export function insertBlockChange(doc: string, key: string, value: string): FmChange {
  void doc;
  const formatted = value === '' ? '' : formatScalar('yaml', value);
  return { from: 0, to: 0, insert: `---\n${key}: ${formatted}\n---\n` };
}
