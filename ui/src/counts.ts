export interface Counts {
  words: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
  sections: number;
}

export function computeCounts(markdown: string): Counts {
  const bytes = new TextEncoder().encode(markdown).length;

  const words = markdown.split(/\s+/).filter(t => t.length > 0).length;

  const sentences = (markdown.match(/[.!?]+(?=\s|$)/g) ?? []).length;

  const sections = (markdown.match(/^#{1,6}\s/mg) ?? []).length;

  const paragraphs = countParagraphs(markdown);

  return { words, bytes, sentences, paragraphs, sections };
}

function countParagraphs(markdown: string): number {
  // Split into lines and walk through, tracking fence state.
  // A blank line inside a fence does not end a block.
  // A fenced block counts as one paragraph.
  const lines = markdown.split('\n');
  const fenceRe = /^(`{3,}|~{3,})/;

  let paragraphs = 0;
  let inFence = false;
  let fenceMarker = '';
  let inBlock = false; // currently inside a non-empty block

  for (const line of lines) {
    if (inFence) {
      // Check for closing fence: same character, at least as long
      const m = line.match(/^(`{3,}|~{3,})/);
      if (m && m[1][0] === fenceMarker[0] && m[1].length >= fenceMarker.length) {
        inFence = false;
        fenceMarker = '';
        // The fenced block ends here; mark block as finished
        inBlock = false; // reset so next non-blank starts a new paragraph
      }
      // lines inside fence: don't change inBlock
      continue;
    }

    const fm = line.match(fenceRe);
    if (fm) {
      // Opening fence
      inFence = true;
      fenceMarker = fm[1];
      // Count the fence block as a paragraph (opening line is non-blank)
      if (!inBlock) {
        paragraphs++;
        inBlock = true;
      }
      continue;
    }

    const blank = line.trim().length === 0;
    if (blank) {
      if (inBlock) {
        inBlock = false;
      }
    } else {
      if (!inBlock) {
        paragraphs++;
        inBlock = true;
      }
    }
  }

  return paragraphs;
}
