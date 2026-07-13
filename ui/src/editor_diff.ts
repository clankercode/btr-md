/**
 * Show-changes (diff) mode configuration for the source editor.
 *
 * Maps the persisted `DiffMode` string to `@codemirror/merge` flags plus a
 * mode class used by editor theme CSS to keep the three active modes visually
 * distinct. Kept free of DOM / CodeMirror imports so unit tests can exercise
 * it with plain `node:test`.
 */

export type DiffViewConfig = {
  mode: 'none' | 'gutter' | 'line_by_line' | 'word_by_word';
  /** Root class applied while this mode is active (empty for `none`). */
  editorClass: string;
  gutter: boolean;
  highlightChanges: boolean;
  allowInlineDiffs: boolean;
};

/**
 * Pure mapping from DiffMode → merge flags + CSS class.
 *
 * `unifiedMergeView` always paints line backgrounds and deleted-chunk widgets
 * when installed — there is no library "gutter only" flag. Gutter mode
 * therefore shares the same merge flags as line-by-line and relies on the
 * `.pmd-diff-gutter` theme rules to hide non-gutter chrome. Word-by-word is
 * the only mode with `highlightChanges` / `allowInlineDiffs`.
 */
export function diffViewConfig(mode: string): DiffViewConfig {
  switch (mode) {
    case 'gutter':
      // Gutter markers only — line/chunk chrome hidden via `.pmd-diff-gutter`.
      return {
        mode: 'gutter',
        editorClass: 'pmd-diff-gutter',
        gutter: true,
        highlightChanges: false,
        allowInlineDiffs: false,
      };
    case 'line_by_line':
      // Full unified line diff: deleted widgets + whole-line highlights.
      return {
        mode: 'line_by_line',
        editorClass: 'pmd-diff-line',
        gutter: true,
        highlightChanges: false,
        allowInlineDiffs: false,
      };
    case 'word_by_word':
      // Intra-line word marks + inline deletion widgets when possible.
      return {
        mode: 'word_by_word',
        editorClass: 'pmd-diff-word',
        gutter: true,
        highlightChanges: true,
        allowInlineDiffs: true,
      };
    default:
      return {
        mode: 'none',
        editorClass: '',
        gutter: false,
        highlightChanges: false,
        allowInlineDiffs: false,
      };
  }
}
