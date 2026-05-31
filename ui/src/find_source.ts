import {
  search,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  SearchQuery,
} from '../vendor/codemirror-6/codemirror.bundle.js';

/** The search extension installed in the editor's search compartment. The panel
 *  is shown at the top and supplies CodeMirror's own match highlighting/counts.
 *  basicSetup already binds searchKeymap, so only the search() extension is added. */
export function searchExtension(): unknown {
  return search({ top: true });
}

/** Open CodeMirror's find panel over the given view (an EditorView, typed `any`). */
export function openSourceFind(view: any): void {
  openSearchPanel(view);
}

/** Push the find-bar query into CodeMirror's search state so the source pane
 *  searches for it (one input drives both panes). */
export function setSourceQuery(view: any, query: string): void {
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
}

/** Advance to the next/previous source match (no-ops if the panel is closed). */
export function sourceFindNext(view: any): void {
  findNext(view);
}
export function sourceFindPrevious(view: any): void {
  findPrevious(view);
}
