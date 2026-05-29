import {
  EditorView,
  Decoration,
  ViewPlugin,
  syntaxTree,
} from '../vendor/codemirror-6/codemirror.bundle.js';

export interface EditorInstance {
  getValue: () => string;
  setValue: (md: string) => void;
  focus: () => void;
  destroy: () => void;
  /** Toggle soft word wrap; returns the new enabled state. */
  toggleWrap: () => boolean;
  view: EditorView;
}

// Lezer node name -> decoration class. Mark tokens (the literal *, **, `, #
// syntax characters) all map to cm-md-mark so they stay visible but dimmed.
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

// Walk the syntax tree over the visible ranges and build mark decorations for
// markdown inline/heading nodes. We collect into a plain array and use the
// Decoration.set(..., true) sort form to avoid RangeSetBuilder ordering
// pitfalls with nested marks (e.g. EmphasisMark inside StrongEmphasis).
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
      // Also recompute when the syntax tree identity changes: markdown parsing
      // is time-sliced, so the tree often isn't complete on the docChanged
      // update — the language parse worker advances it later via an empty
      // transaction (no docChanged), and we must pick that up.
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

export async function mountEditor(
  el: HTMLElement,
  onChange: (md: string) => void
): Promise<EditorInstance> {
  const CM = await import('../vendor/codemirror-6/codemirror.bundle.js');

  // Per-instance compartment so word wrap can be reconfigured live. Default on.
  const wrapCompartment = new CM.Compartment();
  let wrapEnabled = true;

  const view = new CM.EditorView({
    parent: el,
    state: CM.EditorState.create({
      doc: '',
      extensions: [
        CM.basicSetup,
        CM.markdown({ base: CM.markdownLanguage, extensions: [CM.GFM] }),
        wrapCompartment.of(EditorView.lineWrapping),
        markdownDecorations,
        EditorView.updateListener.of((update: any) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
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
          '.cm-focused': {
            outline: 'none',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--pmd-caret)',
          },
          '.cm-selectionBackground': {
            backgroundColor: 'var(--pmd-selection-bg)',
          },
          '&.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--pmd-selection-bg)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--pmd-bg-elevated)',
            color: 'var(--pmd-fg-muted)',
            border: 'none',
            borderRight: '1px solid var(--pmd-border)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--pmd-bg-elevated)',
          },
          '.cm-activeLine': {
            backgroundColor: 'var(--pmd-bg-elevated)',
          },
          // Markdown styling — syntax markers stay visible but dimmed via .cm-md-mark.
          '.cm-md-strong': {
            fontWeight: '700',
          },
          '.cm-md-em': {
            fontStyle: 'italic',
          },
          '.cm-md-code': {
            fontFamily: 'var(--pmd-font-mono, "JetBrains Mono", monospace)',
            backgroundColor: 'var(--pmd-bg-muted)',
            borderRadius: 'var(--pmd-radius-sm)',
            padding: '0.1em 0.25em',
          },
          '.cm-md-strike': {
            textDecoration: 'line-through',
          },
          '.cm-md-h1': {
            fontSize: '1.6em',
            fontWeight: '700',
          },
          '.cm-md-h2': {
            fontSize: '1.45em',
            fontWeight: '700',
          },
          '.cm-md-h3': {
            fontSize: '1.3em',
            fontWeight: '700',
          },
          '.cm-md-h4': {
            fontSize: '1.15em',
            fontWeight: '700',
          },
          '.cm-md-h5': {
            fontSize: '1.05em',
            fontWeight: '700',
          },
          '.cm-md-h6': {
            fontSize: '1em',
            fontWeight: '700',
          },
          '.cm-md-mark': {
            opacity: '0.5',
          },
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (md: string) => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: md,
        },
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    toggleWrap: () => {
      wrapEnabled = !wrapEnabled;
      view.dispatch({
        effects: wrapCompartment.reconfigure(
          wrapEnabled ? EditorView.lineWrapping : []
        ),
      });
      return wrapEnabled;
    },
    view,
  };
}
