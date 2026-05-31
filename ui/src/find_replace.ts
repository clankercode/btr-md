// Pure helpers for the find-and-replace half of the find bar (Slice A,
// feature #4). Replace is SOURCE-scoped only; the preview pane stays find-only
// (we never mutate sanitized preview DOM). The CodeMirror-facing dispatch lives
// in `find_source.ts`; this module holds the framework-free query state so it
// can be unit-tested in isolation.

/** The fields driving a source find/replace, mirroring CodeMirror's
 *  `SearchQuery` constructor options we care about. */
export interface ReplaceQuerySpec {
  search: string;
  replace: string;
  caseSensitive: boolean;
  regexp: boolean;
}

export interface FindReplaceState {
  search: string;
  replace: string;
  caseSensitive: boolean;
  regexp: boolean;
}

export function initialFindReplaceState(): FindReplaceState {
  return { search: '', replace: '', caseSensitive: false, regexp: false };
}

/** Build the query spec handed to CodeMirror's `SearchQuery`. Pure. */
export function buildReplaceQuery(state: FindReplaceState): ReplaceQuerySpec {
  return {
    search: state.search,
    replace: state.replace,
    caseSensitive: state.caseSensitive,
    regexp: state.regexp,
  };
}

export function isValidSearch(state: Pick<FindReplaceState, 'search' | 'regexp'>): boolean {
  if (state.search.length === 0) return false;
  if (!state.regexp) return true;
  try {
    new RegExp(state.search, 'u');
    return true;
  } catch {
    return false;
  }
}

/** Replace is only meaningful with a non-empty valid search term. Pure. */
export function canReplace(state: Pick<FindReplaceState, 'search' | 'regexp'>): boolean {
  return isValidSearch(state);
}
