import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin, keymap } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { unifiedMergeView } from '@codemirror/merge';
import {
  search,
  searchKeymap,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  replaceNext,
  replaceAll,
  SearchQuery,
} from '@codemirror/search';

export {
  EditorState,
  Compartment,
  Prec,
  EditorView,
  basicSetup,
  Decoration,
  ViewPlugin,
  keymap,
  markdown,
  markdownLanguage,
  syntaxTree,
  GFM,
  oneDark,
  unifiedMergeView,
  search,
  searchKeymap,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  replaceNext,
  replaceAll,
  SearchQuery,
};
