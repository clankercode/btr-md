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

/** Split a comma-separated tags input into trimmed, non-empty items. */
function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Return the trailing ` #...` comment of a YAML value remainder, or '' if none.
 * Quote-aware: a `#` inside a single/double-quoted scalar (e.g. `"Issue #42"`)
 * is NOT a comment, so it is not stripped. A comment must be a `#` that sits
 * outside quotes and is preceded by whitespace.
 */
function trailingComment(remainder: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < remainder.length; i++) {
    const ch = remainder[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inSingle && !inDouble && i > 0 && /\s/.test(remainder[i - 1])) {
      let start = i;
      while (start > 0 && /\s/.test(remainder[start - 1])) start--;
      return remainder.slice(start);
    }
  }
  return '';
}

/** Render a tags sequence as a single-line flow value (no key, no separator).
 *  YAML: `[a, b]` (items quoted only when needed); TOML: `["a", "b"]`. */
function formatTagsSequence(format: FmFormat, items: string[]): string {
  if (format === 'toml') {
    return `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
  }
  return `[${items.map((item) => formatScalar('yaml', item)).join(', ')}]`;
}

/** The end offset of a `tags:` block span: the located line plus any
 *  immediately-following block-sequence items (`^\s+-\s`). Returns the offset
 *  of the line end of the last covered line. */
function tagsSpanEndOffset(doc: string, block: FmBlock, line: number): number {
  let last = line;
  for (let next = line + 1; next <= block.endLine; next += 1) {
    const from = lineStartOffset(doc, next);
    const to = lineEndOffset(doc, next);
    if (/^\s+-\s/.test(doc.slice(from, to))) last = next;
    else break;
  }
  return lineEndOffset(doc, last);
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

  if (key === 'tags') {
    const sequence = formatTagsSequence(block.format, splitTags(value));
    // Replace the whole tags span: the key + value line PLUS any following
    // block-sequence items, collapsing them into one flow value. Reconstruct
    // the prefix as `key:`/`key =` + one space so a block-form line (`tags:`
    // with no inline value) does not lose the separating space.
    const sep = block.format === 'toml' ? ' = ' : ': ';
    const indent = prefix.match(/^(\s*)/)?.[1] ?? '';
    const keyName = prefix.match(/^\s*([^:=\s]+)/)?.[1] ?? key;
    return {
      from,
      to: tagsSpanEndOffset(doc, block, line),
      insert: `${indent}${keyName}${sep}${sequence}`,
    };
  }

  const comment = trailingComment(remainder);
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
  const formatted =
    key === 'tags'
      ? formatTagsSequence(block.format, splitTags(value))
      : formatScalar(block.format, value);
  return { from: at, to: at, insert: `${key}${sep}${formatted}\n` };
}

export function insertBlockChange(doc: string, key: string, value: string): FmChange {
  void doc;
  const formatted = value === '' ? '' : formatScalar('yaml', value);
  return { from: 0, to: 0, insert: `---\n${key}: ${formatted}\n---\n` };
}
