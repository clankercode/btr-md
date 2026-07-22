import {
  EditorView,
  EditorState,
  Compartment,
  Decoration,
  ViewPlugin,
  syntaxTree,
  basicSetup,
  markdown,
  markdownLanguage,
  html,
  json,
  GFM,
  unifiedMergeView,
  keymap,
  Prec,
} from '../vendor/codemirror-6/codemirror.bundle.js';
import { searchExtension, openSourceFind, sourceFindNext, sourceFindPrevious } from './find_source.js';
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleList,
} from './editor_format.js';
import { listEnter } from './editor_list.js';
import { editorIndent, editorDedent } from './editor_indent.js';
import { diffViewConfig } from './editor_diff.js';
import {
  computeFlashHunks,
  flashLineMarks,
  rememberFlashHunks,
  clearRememberedFlashHunks,
  getLastFlashHunks,
  FLASH_DURATION_MS,
  type FlashHunk,
} from './reload_flash.js';
import { attachMinimap, type MinimapHandle } from './minimap.js';
import type { DocumentKind } from './document_kind.js';
export type { DiffViewConfig } from './editor_diff.js';
export { diffViewConfig } from './editor_diff.js';
export type { FlashHunk } from './reload_flash.js';
export {
  computeFlashHunks,
  getLastFlashHunks,
  clearRememberedFlashHunks,
  FLASH_DURATION_MS,
} from './reload_flash.js';

// One EditorView is reused across all document tabs; each tab owns a live
// `EditorState` (held in memory by the tab store, never serialized). Switching
// tabs is `view.setState(tab.editorState)`, which preserves that tab's undo
// history, selection and viewport. See `tabs.ts` / `main.ts`.

export interface EditorHandle {
  view: EditorView;
  /** Build a fresh state with the full extension set, seeded with `doc`. */
  createState: (doc: string, kind?: DocumentKind) => EditorState;
  /** Snapshot the live state (to stash on a tab being switched away from). */
  snapshot: () => EditorState;
  /** Swap to a tab's state (programmatic — does not fire the edit callback). */
  activateState: (state: EditorState) => void;
  /** Replace the whole document in the current state programmatically. */
  setValueProgrammatic: (md: string) => void;
  setLanguage: (kind: DocumentKind) => void;
  getValue: () => string;
  focus: () => void;
  /** Toggle soft word wrap; returns the new enabled state. */
  toggleWrap: () => boolean;
  /** Show/hide a unified diff of the buffer against `baseline` (last saved). */
  setDiff: (mode: string, baseline: string) => void;
  /**
   * Flash green/red line decorations for the delta from `previous` text to the
   * current document (B009 reload flash). Returns the computed hunks (also
   * stored for `getLastFlashHunks` / B010 / B012). No-op when identical.
   */
  flashContentChange: (previous: string) => FlashHunk[];
  /** Clear any active reload-flash decorations immediately. */
  clearFlash: () => void;
  /** Last flash hunks from the most recent `flashContentChange` (may be empty). */
  getLastFlashHunks: () => readonly FlashHunk[];
  /** Open CodeMirror's source find panel. */
  openSearch: () => void;
  /** Advance to the next source search match. */
  searchNext: () => void;
  /** Advance to the previous source search match. */
  searchPrevious: () => void;
  /** Move the selection+viewport to 1-based `line` (clamped); no-op if out of range. */
  gotoEditorLine: (line: number) => void;
  destroy: () => void;
}

// Lezer node name -> decoration class (markers stay visible but dimmed).
const MD_NODE_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  InlineCode: 'cm-md-code',
  Strikethrough: 'cm-md-strike',
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1',
  SetextHeading2: 'cm-md-h2',
  EmphasisMark: 'cm-md-mark',
  CodeMark: 'cm-md-mark',
  HeaderMark: 'cm-md-mark',
  StrikethroughMark: 'cm-md-mark',
};

// Leading YAML/TOML frontmatter byte range, or null. The Lezer markdown parser
// has no notion of frontmatter, so it mis-parses the lines as a SetextHeading
// (a `description: ...` line followed by the closing `---` underline) — which
// our decorations would then render huge/bold. We detect the region ourselves
// and (a) suppress markdown styling inside it, (b) give it a dim metadata look.
// While the closing fence is still being typed, the region extends to EOF so
// nothing flashes as a heading mid-edit.
function frontmatterRange(doc: any): { from: number; to: number } | null {
  if (doc.lines < 1) return null;
  // Tolerate trailing whitespace / a stray CR, matching the backend's
  // `trim_end` fence parsing (crates/pmd-core/src/facts/frontmatter.rs).
  const first = (doc.line(1).text as string).trimEnd();
  const fence = first === '---' ? '---' : first === '+++' ? '+++' : null;
  if (!fence) return null;
  for (let n = 2; n <= doc.lines; n++) {
    if ((doc.line(n).text as string).trimEnd() === fence) {
      return { from: 0, to: doc.line(n).to };
    }
  }
  return { from: 0, to: doc.length };
}

function buildMarkdownDecorations(view: EditorView) {
  const marks: any[] = [];
  const fm = frontmatterRange(view.state.doc);
  for (const { from, to } of view.visibleRanges) {
    if (fm) {
      const s = Math.max(from, fm.from);
      const e = Math.min(to, fm.to);
      if (e > s) marks.push(Decoration.mark({ class: 'cm-md-frontmatter' }).range(s, e));
    }
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node: any) => {
        // Inside frontmatter: skip markdown styling (no setext-heading look).
        if (fm && node.from >= fm.from && node.from < fm.to) return;
        const cls = MD_NODE_CLASS[node.name];
        if (cls) {
          marks.push(Decoration.mark({ class: cls }).range(node.from, node.to));
        }
      },
    });
  }
  return Decoration.set(marks, true);
}

const markdownDecorations = ViewPlugin.fromClass(
  class {
    decorations: any;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: any) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (v: any) => v.decorations,
  }
);

function buildSelectionTextDecorations(view: EditorView) {
  const marks: any[] = [];
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    marks.push(Decoration.mark({ class: 'cm-pmd-selectedText' }).range(range.from, range.to));
  }
  return Decoration.set(marks, true);
}

const selectionTextDecorations = ViewPlugin.fromClass(
  class {
    decorations: any;

    constructor(view: EditorView) {
      this.decorations = buildSelectionTextDecorations(view);
    }

    update(update: any) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) {
        this.decorations = buildSelectionTextDecorations(update.view);
      }
    }
  },
  {
    decorations: (v: any) => v.decorations,
  }
);

// Module-level so they are shared across every per-tab state.
let programmaticDepth = 0;
let wrapEnabled = true;
let userEditCb: (doc: string) => void = () => {};
/** RHS minimap for the single reused EditorView (B010); null until mount. */
let minimap: MinimapHandle | null = null;
const wrapCompartment = new Compartment();
const diffCompartment = new Compartment();
const flashCompartment = new Compartment();
const searchCompartment = new Compartment();
const languageCompartment = new Compartment();
/** Timer that clears the ephemeral reload flash decorations. */
let flashClearTimer: ReturnType<typeof setTimeout> | null = null;

/** Language + markdown-only decorations for a document kind. */
export function languageExtensions(kind: DocumentKind): any[] {
  switch (kind) {
    case 'html':
      return [html()];
    case 'json':
      return [json()];
    case 'markdown':
      return [
        markdown({ base: markdownLanguage, extensions: [GFM] }),
        markdownDecorations,
      ];
    // yaml / toml / ini: plain text until a dedicated lang package is vendored.
    default:
      return [];
  }
}

/** Build the CodeMirror extension list for a show-changes mode. */
export function buildDiffExtension(mode: string, baseline: string): any[] {
  const cfg = diffViewConfig(mode);
  if (cfg.mode === 'none') return [];
  return [
    unifiedMergeView({
      original: baseline,
      gutter: cfg.gutter,
      highlightChanges: cfg.highlightChanges,
      allowInlineDiffs: cfg.allowInlineDiffs,
      mergeControls: false,
    }),
    EditorView.editorAttributes.of({ class: cfg.editorClass }),
  ];
}

/** Build ephemeral line decorations for a reload flash. */
function buildFlashDecorations(doc: { lines: number; line: (n: number) => { from: number } }, hunks: readonly FlashHunk[]) {
  if (hunks.length === 0) return Decoration.none;
  const marks = flashLineMarks(hunks, doc.lines);
  const ranges: any[] = [];
  for (const m of marks) {
    // CodeMirror line numbers are 1-based.
    const ln = doc.line(m.line + 1);
    ranges.push(Decoration.line({ class: m.className }).range(ln.from));
  }
  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--pmd-editor-font-size, 14px)',
    backgroundColor: 'var(--pmd-bg)',
    color: 'var(--pmd-fg)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--pmd-font-mono, "JetBrains Mono", monospace)',
  },
  '.cm-content': {
    padding: '1rem',
    caretColor: 'var(--pmd-caret)',
  },
  '.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--pmd-caret)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--pmd-selection-bg)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--pmd-selection-bg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--pmd-bg-elevated)',
    color: 'var(--pmd-fg-muted)',
    border: 'none',
    borderRight: '1px solid var(--pmd-border)',
  },
  // Translucent so the selection layer (drawn *below* the line layer by
  // CodeMirror) still shows through on the cursor's line. An opaque
  // background here masks the selection highlight on the active line.
  // color-mix keeps this theme-derived and composes over the real bg.
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--pmd-bg-elevated) 55%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--pmd-bg-elevated) 55%, transparent)',
  },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-code': {
    fontFamily: 'var(--pmd-font-mono, "JetBrains Mono", monospace)',
    backgroundColor: 'var(--pmd-bg-muted)',
    borderRadius: 'var(--pmd-radius-sm)',
    padding: '0.1em 0.25em',
  },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-h1': { fontSize: '1.6em', fontWeight: '700' },
  '.cm-md-h2': { fontSize: '1.45em', fontWeight: '700' },
  '.cm-md-h3': { fontSize: '1.3em', fontWeight: '700' },
  '.cm-md-h4': { fontSize: '1.15em', fontWeight: '700' },
  '.cm-md-h5': { fontSize: '1.05em', fontWeight: '700' },
  '.cm-md-h6': { fontSize: '1em', fontWeight: '700' },
  '.cm-md-mark': { opacity: '0.5' },
  // Frontmatter: a calm, dim metadata block — never heading-sized.
  '.cm-md-frontmatter': {
    color: 'var(--pmd-fg-muted)',
    fontStyle: 'italic',
  },
  '.cm-pmd-selectedText': { color: 'var(--pmd-selection-fg)' },
  '.cm-pmd-selectedText *': { color: 'var(--pmd-selection-fg)' },

  // --- Show-changes mode chrome (B001) ---------------------------------
  // Gutter-only: suppress line fills + deleted-chunk widgets. The change
  // gutter (`.cm-changeGutter` / `.cm-changedLineGutter`) stays visible.
  '&.pmd-diff-gutter .cm-changedLine, &.pmd-diff-gutter .cm-inlineChangedLine': {
    backgroundColor: 'transparent',
  },
  '&.pmd-diff-gutter .cm-deletedChunk': {
    display: 'none',
  },
  '&.pmd-diff-gutter .cm-insertedLine, &.pmd-diff-gutter .cm-deletedLine': {
    textDecoration: 'none',
    backgroundColor: 'transparent',
  },
  // Word-by-word: CM's default word mark is a 2px bottom underline that is
  // easy to miss against whole-line fills. Use a filled highlight so
  // intra-line edits read clearly as word-level, not line-level.
  '&.pmd-diff-word .cm-changedText': {
    background:
      'linear-gradient(color-mix(in srgb, #2b2 40%, transparent), color-mix(in srgb, #2b2 40%, transparent))',
    borderRadius: '2px',
  },
  '&.pmd-diff-word .cm-deletedText': {
    backgroundColor: 'color-mix(in srgb, #e43 35%, transparent)',
    textDecoration: 'line-through',
    borderRadius: '2px',
  },
  // Soften the whole-line wash so word marks remain the primary signal.
  '&.pmd-diff-word .cm-changedLine, &.pmd-diff-word .cm-inlineChangedLine': {
    backgroundColor: 'color-mix(in srgb, #2b2 8%, transparent)',
  },
});

// Markdown formatting + smart-list keymap (Slice A, features #2/#3).
//
// Ctrl+B CONFLICT RESOLUTION: the global hotkey layer (`installActionHotkeys`
// on `document`) binds Ctrl+B to `view.toggleSidebar`. We do NOT rebind the
// sidebar — instead this editor keymap takes precedence *only while the editor
// is focused*. CodeMirror's `keymap` facet handles the event on the editor's
// content DOM and, when a binding's command returns true, calls both
// `preventDefault()` and `stopPropagation()`, so the keydown never bubbles to
// the document listener. When the editor is NOT focused the keydown never
// reaches this keymap, so Ctrl+B falls through to the global handler and still
// toggles the sidebar. `Prec.highest` keeps these bindings ahead of basicSetup
// (and the search keymap) for the chords we own.
function formattingKeymap() {
  return Prec.highest(
    keymap.of([
      { key: 'Mod-b', run: toggleBold, preventDefault: true },
      { key: 'Mod-i', run: toggleItalic, preventDefault: true },
      { key: 'Mod-`', run: toggleInlineCode, preventDefault: true },
      { key: 'Mod-k', run: insertLink, preventDefault: true },
      { key: 'Mod-Shift-h', run: toggleHeading, preventDefault: true },
      { key: 'Mod-Shift-l', run: toggleList, preventDefault: true },
      // Smart list continuation: returns false on non-list lines so the
      // default Enter (newline) binding from basicSetup still runs.
      { key: 'Enter', run: listEnter },
      // Tab / Shift-Tab: list-aware indent/outdent + literal indentation inside
      // code blocks. Always consumes the key so focus never leaves the editor.
      { key: 'Tab', run: editorIndent, shift: editorDedent, preventDefault: true },
    ])
  );
}

function buildExtensions(kind: DocumentKind = 'markdown') {
  return [
    formattingKeymap(),
    basicSetup,
    languageCompartment.of(languageExtensions(kind)),
    wrapCompartment.of(wrapEnabled ? EditorView.lineWrapping : []),
    diffCompartment.of([]),
    flashCompartment.of([]),
    searchCompartment.of(searchExtension()),
    selectionTextDecorations,
    EditorView.updateListener.of((update: any) => {
      // Keep the RHS minimap in sync (doc / viewport / geometry). Safe when
      // unmounted — `minimap` is null until `mountEditor` attaches it.
      minimap?.onViewUpdate(update);
      // Fire only for genuine user edits — never for programmatic sets
      // (open/reload/merge/`setValueProgrammatic`) or full state swaps.
      if (!update.docChanged || programmaticDepth > 0) return;
      userEditCb(update.state.doc.toString());
    }),
    editorTheme,
  ];
}

function createState(doc: string, kind: DocumentKind = 'markdown'): EditorState {
  return EditorState.create({ doc, extensions: buildExtensions(kind) });
}

export async function mountEditor(
  el: HTMLElement,
  onUserEdit: (doc: string) => void
): Promise<EditorHandle> {
  userEditCb = onUserEdit;

  // Flex row: editor host (flex 1) + RHS minimap strip (fixed width). The
  // CodeMirror view mounts into the host so the minimap never overlaps the
  // scroller or B009 line-flash decorations.
  el.classList.add('pmd-editor-with-minimap');
  const host = document.createElement('div');
  host.className = 'pmd-editor-host';
  const minimapEl = document.createElement('div');
  // class `pmd-minimap` is applied by attachMinimap; keep a stable hook for CSS.
  minimapEl.className = 'pmd-minimap';
  el.appendChild(host);
  el.appendChild(minimapEl);

  const view = new EditorView({
    parent: host,
    state: createState(''),
  });

  minimap = attachMinimap(view, minimapEl, {
    getFlashHunks: () => getLastFlashHunks(),
  });

  const programmatic = <T>(fn: () => T): T => {
    programmaticDepth++;
    try {
      return fn();
    } finally {
      programmaticDepth--;
    }
  };

  return {
    view,
    createState,
    snapshot: () => view.state,
    activateState: (state: EditorState) => {
      programmatic(() => view.setState(state));
      // Full state swap (tab switch) — repaint density + viewport.
      minimap?.redraw();
    },
    setValueProgrammatic: (md: string) =>
      programmatic(() =>
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } })
      ),
    setLanguage: (kind: DocumentKind) => {
      programmatic(() =>
        view.dispatch({
          effects: languageCompartment.reconfigure(languageExtensions(kind)),
        })
      );
    },
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    toggleWrap: () => {
      wrapEnabled = !wrapEnabled;
      view.dispatch({
        effects: wrapCompartment.reconfigure(wrapEnabled ? EditorView.lineWrapping : []),
      });
      return wrapEnabled;
    },
    setDiff: (mode: string, baseline: string) => {
      const ext = buildDiffExtension(mode, baseline);
      // Two-phase reconfigure: `originalDoc` / `ChunkField` are StateFields
      // whose `init` only runs when the field is first added. A single
      // reconfigure that swaps one unifiedMergeView for another keeps the
      // previous baseline and chunks. Clearing first forces a clean rebuild
      // against the supplied baseline (also needed after save/reload).
      // Effects-only (no docChanged) so the edit callback never fires.
      view.dispatch({ effects: diffCompartment.reconfigure([]) });
      if (ext.length > 0) {
        view.dispatch({ effects: diffCompartment.reconfigure(ext) });
      }
    },
    flashContentChange: (previous: string): FlashHunk[] => {
      const current = view.state.doc.toString();
      const hunks = computeFlashHunks(previous, current);
      rememberFlashHunks(hunks);
      if (flashClearTimer !== null) {
        clearTimeout(flashClearTimer);
        flashClearTimer = null;
      }
      if (hunks.length === 0) {
        view.dispatch({ effects: flashCompartment.reconfigure([]) });
        minimap?.refreshMarkers();
        return hunks;
      }
      const decos = buildFlashDecorations(view.state.doc, hunks);
      // Facet-provided decorations for the flash layer only. Separate from the
      // show-changes merge view so the two do not fight over StateFields.
      view.dispatch({
        effects: flashCompartment.reconfigure([
          EditorView.decorations.of(decos),
        ]),
      });
      // Surface the same hunks on the minimap (green/red/amber ticks).
      minimap?.refreshMarkers();
      flashClearTimer = setTimeout(() => {
        flashClearTimer = null;
        // View may already be destroyed (tab/window close) — ignore.
        try {
          view.dispatch({ effects: flashCompartment.reconfigure([]) });
        } catch {
          /* ignore */
        }
        // Markers stay subtle until the next flash/reload (not cleared here).
      }, FLASH_DURATION_MS);
      return hunks;
    },
    clearFlash: () => {
      // Drop decorations only — remembered hunks stay available for B010/B012
      // until the next flashContentChange (or explicit clearRememberedFlashHunks).
      if (flashClearTimer !== null) {
        clearTimeout(flashClearTimer);
        flashClearTimer = null;
      }
      try {
        view.dispatch({ effects: flashCompartment.reconfigure([]) });
      } catch {
        /* ignore */
      }
    },
    getLastFlashHunks: () => getLastFlashHunks(),
    openSearch: () => openSourceFind(view),
    searchNext: () => sourceFindNext(view),
    searchPrevious: () => sourceFindPrevious(view),
    gotoEditorLine: (line: number) => {
      const total = view.state.doc.lines;
      const n = Math.max(1, Math.min(total, line));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
    destroy: () => {
      minimap?.destroy();
      minimap = null;
      view.destroy();
    },
  };
}
