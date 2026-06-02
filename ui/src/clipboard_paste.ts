// Clipboard-paste helpers (todo #5: "pasting lists sometimes doesn't work").
//
// When a list is copied from a browser or the app's own rendered preview, the
// clipboard carries both `text/html` (with real `<ul>/<ol>/<li>` structure) and
// a `text/plain` flavour that has usually lost the bullet markers. CodeMirror's
// default paste inserts the plain text, so the list arrives as a run of
// unmarked lines. When the HTML clearly contains a list we instead convert the
// HTML to Markdown (same sanitised backend path as Ctrl+Shift+V) so the markers
// survive. Plain-text clipboards (e.g. Markdown copied from another editor)
// have no HTML and fall through to the normal paste untouched.

/** Whether clipboard HTML contains a real list item worth converting. */
export function htmlContainsList(html: string | null | undefined): boolean {
  if (!html) return false;
  return /<li[\s>]/i.test(html);
}
