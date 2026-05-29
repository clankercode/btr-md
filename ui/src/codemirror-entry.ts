import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { oneDark } from '@codemirror/theme-one-dark';

export {
  EditorState,
  Compartment,
  EditorView,
  basicSetup,
  Decoration,
  ViewPlugin,
  markdown,
  markdownLanguage,
  syntaxTree,
  GFM,
  oneDark,
};
