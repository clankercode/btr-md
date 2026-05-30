export interface FootnoteInsertion {
  id: string;
  refText: string;
  defText: string;
  placeholder: { start: number; end: number };
}

/** Strip fenced code blocks and inline code spans from text, replacing with spaces
 *  of the same length so that offsets remain valid (not needed here, but simpler). */
function stripCode(doc: string): string {
  // Replace fenced blocks first (multiline)
  let result = doc.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*/g, (m) =>
    ' '.repeat(m.length)
  );
  // Replace inline code spans (backtick strings, non-greedy)
  result = result.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  return result;
}

/** Return all footnote ids found in the doc (ignoring code spans/fences and escaped \[^). */
function collectIds(doc: string): string[] {
  const stripped = stripCode(doc);
  const ids: string[] = [];
  // Match [^id] but not \[^id] (escaped)
  const re = /(?<!\\)\[\^([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

export function planFootnoteInsertion(doc: string): FootnoteInsertion {
  const ids = collectIds(doc);

  const numericIds: number[] = [];
  for (const id of ids) {
    const n = parseInt(id, 10);
    if (!isNaN(n) && String(n) === id) {
      numericIds.push(n);
    }
  }

  let chosenId: string;
  if (numericIds.length > 0) {
    chosenId = String(Math.max(...numericIds) + 1);
  } else {
    // Find lowest free positive integer not in ids (non-numeric ids treated as non-numeric)
    let candidate = 1;
    const idSet = new Set(ids);
    while (idSet.has(String(candidate))) {
      candidate++;
    }
    chosenId = String(candidate);
  }

  const refText = `[^${chosenId}]`;
  const defText = `\n\n[^${chosenId}]: TODO`;
  // "TODO" offset within defText
  const todoStart = defText.length - 4; // "TODO".length === 4
  const todoEnd = defText.length;

  return {
    id: chosenId,
    refText,
    defText,
    placeholder: { start: todoStart, end: todoEnd },
  };
}
