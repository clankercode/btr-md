import { EditorView } from '../vendor/codemirror-6/codemirror.bundle.js';

export interface EditorInstance {
  getValue: () => string;
  setValue: (md: string) => void;
  focus: () => void;
  destroy: () => void;
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
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          },
          '.cm-content': {
            padding: '1rem',
          },
          '.cm-focused': {
            outline: 'none',
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
  };
}
