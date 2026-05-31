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

// One EditorView is reused across all document tabs; each tab owns a live
// `EditorState` (held in memory by the tab store, never serialized). Switching
// tabs is `view.setState(tab.editorState)`, which preserves that tab's undo
// history, selection and viewport. See `tabs.ts` / `main.ts`.

export interface EditorHandle {
  view: EditorView;
  /** Build a fresh state with the full extension set, seeded with `doc`. */
  createState: (doc: string) => EditorState;
  /** Snapshot the live state (to stash on a tab being switched away from). */
  snapshot: () => EditorState;
  /** Swap to a tab's state (programmatic — does not fire the edit callback). */
  activateState: (state: EditorState) => void;
  /** Replace the whole document in the current state programmatically. */
  setValueProgrammatic: (md: string) => void;
  getValue: () => string;
  focus: () => void;
  /** Toggle soft word wrap; returns the new enabled state. */
  toggleWrap: () => boolean;
  /** Show/hide a unified diff of the buffer against `baseline` (last saved). */
  setDiff: (mode: string, baseline: string) => void;
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

function buildMarkdownDecorations(view: EditorView) {
  const marks: any[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node: any) => {
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

// Module-level so they are shared across every per-tab state.
let programmaticDepth = 0;
let wrapEnabled = true;
let userEditCb: (doc: string) => void = () => {};
const wrapCompartment = new Compartment();
const diffCompartment = new Compartment();
const searchCompartment = new Compartment();

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
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
  '.cm-activeLineGutter': { backgroundColor: 'var(--pmd-bg-elevated)' },
  '.cm-activeLine': { backgroundColor: 'var(--pmd-bg-elevated)' },
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
    ])
  );
}

function buildExtensions() {
  return [
    formattingKeymap(),
    basicSetup,
    markdown({ base: markdownLanguage, extensions: [GFM] }),
    wrapCompartment.of(wrapEnabled ? EditorView.lineWrapping : []),
    diffCompartment.of([]),
    searchCompartment.of(searchExtension()),
    markdownDecorations,
    EditorView.updateListener.of((update: any) => {
      // Fire only for genuine user edits — never for programmatic sets
      // (open/reload/merge/`setValueProgrammatic`) or full state swaps.
      if (!update.docChanged || programmaticDepth > 0) return;
      userEditCb(update.state.doc.toString());
    }),
    editorTheme,
  ];
}

function createState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: buildExtensions() });
}

export async function mountEditor(
  el: HTMLElement,
  onUserEdit: (doc: string) => void
): Promise<EditorHandle> {
  userEditCb = onUserEdit;

  const view = new EditorView({
    parent: el,
    state: createState(''),
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
    activateState: (state: EditorState) => programmatic(() => view.setState(state)),
    setValueProgrammatic: (md: string) =>
      programmatic(() =>
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } })
      ),
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
      let ext: any = [];
      if (mode === 'gutter') {
        ext = unifiedMergeView({
          original: baseline,
          gutter: true,
          highlightChanges: false,
          mergeControls: false,
        });
      } else if (mode === 'line_by_line') {
        ext = unifiedMergeView({
          original: baseline,
          gutter: true,
          highlightChanges: false,
          allowInlineDiffs: false,
          mergeControls: false,
        });
      } else if (mode === 'word_by_word') {
        ext = unifiedMergeView({
          original: baseline,
          gutter: true,
          highlightChanges: true,
          allowInlineDiffs: true,
          mergeControls: false,
        });
      }
      // Effects-only dispatch (no docChanged) so the edit callback never fires.
      view.dispatch({ effects: diffCompartment.reconfigure(ext) });
    },
    openSearch: () => openSourceFind(view),
    searchNext: () => sourceFindNext(view),
    searchPrevious: () => sourceFindPrevious(view),
    gotoEditorLine: (line: number) => {
      const total = view.state.doc.lines;
      const n = Math.max(1, Math.min(total, line));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
    destroy: () => view.destroy(),
  };
}
