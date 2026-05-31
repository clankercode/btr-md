// Pure helpers for the document export actions (PDF print + self-contained
// HTML). Kept free of DOM/Tauri imports so the payload logic is unit-testable;
// the wiring in main.ts gathers the live preview DOM + theme CSS and calls
// these to assemble the backend request and the print toggle.

/** What the frontend knows about the current document for export. */
export interface ExportSource {
  /** `previewContent.innerHTML` — already sanitized at render time and carrying
   *  trusted-renderer output (Mermaid SVG, KaTeX HTML, data-URI images). */
  bodyHtml: string;
  /** The active theme's emitted CSS (the `#pmd-theme-styles` text). */
  themeCss: string;
  /** Document title (e.g. first H1 / filename); may be empty. */
  title: string;
  /** Absolute path of the active document, or null for an unsaved buffer. */
  docPath: string | null;
}

/** The request body sent to the `export_html` backend command. snake_case to
 *  match the Rust `serde` struct. */
export interface HtmlExportPayload {
  body_html: string;
  theme_css: string;
  title: string;
}

function stem(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Build the `export_html` request. The body and theme CSS are passed through
 *  verbatim — the backend re-sanitizes the body (preserving renderer output)
 *  and inlines the CSS. Only the human-facing title is derived here. */
export function buildHtmlExportPayload(src: ExportSource): HtmlExportPayload {
  let title = src.title.trim();
  if (!title) {
    title = src.docPath ? stem(src.docPath) : "Untitled";
  }
  return {
    body_html: src.bodyHtml,
    theme_css: src.themeCss,
    title,
  };
}

/** Suggested filename for the save dialog: the document stem with a `.html`
 *  extension, replacing any markdown extension. */
export function suggestedExportName(docPath: string | null): string {
  if (!docPath) return "document.html";
  const base = docPath.split("/").pop() ?? "";
  if (!base) return "document.html";
  const dot = base.lastIndexOf(".");
  // Any existing extension (markdown or otherwise) is replaced with `.html`.
  return dot > 0 ? `${base.slice(0, dot)}.html` : `${base}.html`;
}
