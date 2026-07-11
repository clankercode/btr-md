# btr-md

A desktop markdown editor/previewer (Tauri: Rust backend, TypeScript UI). This context covers the whole app; the language below names the concepts both sides of the UI↔backend seam share.

## Language

**Document**:
An open markdown buffer, identified by a DocId, owned by exactly one window.
_Avoid_: file (a Document may be untitled/unsaved), buffer, tab (a tab displays a Document)

**Preview**:
The rendered, sanitized, policy-filtered HTML view of a Document.
_Avoid_: output, rendered view

**Render**:
One versioned transformation of a Document into a Preview. Each render carries the Document version it was computed from; a render older than the current version is stale.
_Avoid_: refresh, redraw

**Facts**:
Structured data extracted from a Document during a Render — links, headings, references — versioned with that Render. Extracted once by pmd-core; consumers receive Facts, they do not re-derive them.
_Avoid_: metadata, analysis

**Diagnostics**:
Issues about a Document derived from Facts and resource policy, shown in the diagnostics panel and inline.
_Avoid_: errors, warnings (Diagnostics include both), lints

**Grant**:
A user-approved permission for the Preview to load local assets from a specific folder.
_Avoid_: permission, allowlist entry

**Trust root**:
A directory the user has marked as trusted for link activation and resource loading beneath it.
_Avoid_: trusted folder, safe dir

**Workspace**:
The root directory the sidebar file browser operates in.
_Avoid_: project, folder

**Session**:
The persisted record of open windows and Documents used to restore the app on next launch.
_Avoid_: state, workspace (that's the browser root)

**Window session**:
The live, in-memory per-window record of what is open right now. Persisting all Window sessions produces the Session.
_Avoid_: session (unqualified) when the live form is meant
