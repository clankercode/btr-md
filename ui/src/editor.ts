import { EditorView } from '../vendor/codemirror-6/codemirror.bundle.js';

export interface EditorInstance {
  getValue: () => string;
  setValue: (md: string) => void;
  focus: () => void;
  destroy: () => void;
  view: EditorView;
}

export async function mountEditor(
  el: HTMLElement,
  onChange: (md: string) => void
): Promise<EditorInstance> {
  const CM = await import('../vendor/codemirror-6/codemirror.bundle.js');

  const view = new CM.EditorView({
    parent: el,
    state: CM.EditorState.create({
      doc: '',
      extensions: [
        CM.basicSetup,
        CM.markdown(),
        EditorView.updateListener.of((update: any) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            backgroundColor: 'var(--pmd-bg, #ffffff)',
            color: 'var(--pmd-fg, #1f2328)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--pmd-font-mono, "JetBrains Mono", monospace)',
          },
          '.cm-content': {
            padding: '1rem',
            caretColor: 'var(--pmd-caret, #0ea5e9)',
          },
          '.cm-focused': {
            outline: 'none',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--pmd-caret, #0ea5e9)',
          },
          '.cm-selectionBackground': {
            backgroundColor: 'var(--pmd-selection-bg, rgba(14, 165, 233, 0.3))',
          },
          '&.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--pmd-selection-bg, rgba(14, 165, 233, 0.3))',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--pmd-bg-elevated, #f8fafc)',
            color: 'var(--pmd-fg-muted, #64748b)',
            border: 'none',
            borderRight: '1px solid var(--pmd-border, #e2e8f0)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--pmd-bg-muted, #f1f5f9)',
          },
          '.cm-activeLine': {
            backgroundColor: 'var(--pmd-bg-muted, #f1f5f9)',
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
    view,
  };
}
