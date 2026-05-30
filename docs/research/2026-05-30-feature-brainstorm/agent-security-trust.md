# Security, Privacy, and Trust Feature Opportunities

Date: 2026-05-30
Scope: `preview-md` as a Linux-first Rust/Tauri Markdown preview app.
Author: Codex research agent

## Executive Summary

`preview-md` already plans the right technical defaults: untrusted Markdown, raw HTML off, strict CSP, scoped local image access, no network image loading in v1, KaTeX `trust: false`, Mermaid `securityLevel: "strict"`, and a sanitizer-first render pipeline. The high-value product opportunity is to make those controls legible and dependable: users should know why something was blocked, when a document is in a higher-risk mode, which files and network hosts the preview can touch, and whether security regressions are caught before release.

The strongest v1 investments are therefore not plugin systems or large trust toggles. They are a visible "document trust" model, a resource policy surface, blocked-content explanations, safe link handling, a local-file exposure audit view, and regression/fuzz surfaces that keep the promise honest.

## Research Notes

- VS Code treats Markdown preview security as a user-facing feature: it restricts preview content, disables script execution, only allows trusted content by default, blocks insecure image content under strict mode, shows a blocked-content alert, and exposes a "Change preview security settings" command. This is a strong pattern for making safety visible instead of silently surprising. Source: https://code.visualstudio.com/docs/languages/markdown#_markdown-preview-security
- Tauri 2 capabilities and command scopes are explicitly framed as ways to minimize the impact of frontend compromise and reduce accidental exposure of local system interfaces and data. The docs also warn that too-lax scopes or incorrect command checks remain application responsibilities. Source: https://v2.tauri.app/security/capabilities/ and https://v2.tauri.app/security/scope/
- Tauri's asset protocol requires `assetProtocol.enable = true` and a scoped allowlist of filesystem paths; runtime paths outside scope should not load. This supports a product-level "this document may load images only from these local directories" guarantee. Source: https://v2.tauri.app/security/asset-protocol/
- Tauri CSP guidance emphasizes restricting WebView loads through app security configuration. For a Markdown previewer that uses `innerHTML`, CSP is a backstop rather than the primary sanitizer, but it is still important evidence for user trust and regression tests. Source: https://v2.tauri.app/security/csp/
- Mermaid documents `securityLevel` as the diagram trust setting. `strict` encodes HTML tags and disables click functionality; `sandbox` renders inside a sandboxed iframe. Mermaid Studio also states that its interactive preview surfaces do not execute Mermaid JavaScript callback clicks. Sources: https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html and https://mermaidstudio.dev/docs/configuration/security/
- KaTeX documents `trust: false` as the default and says it prevents commands such as `\includegraphics` that could enable adverse behavior; `trust` can also be a function that permits only particular commands/protocols. Source: https://katex.org/docs/options.html
- OWASP and MDN both treat sanitization as the correct tool when untrusted input must be inserted as HTML; OWASP also recommends defense in depth such as strong CSP and Trusted Types where applicable. Sources: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html and https://developer.mozilla.org/docs/Web/Security/Attacks/XSS
- Remote image loading has a clear privacy expectation from mail clients: hidden remote images can act as tracking pixels, so products often block or proxy them and show a banner explaining that privacy protection. Markdown documents can contain the same pattern. Sources: https://www.fastmail.help/hc/en-us/articles/1500000278102-Blocking-remote-images and https://bluemail.me/help/remote-images/
- Recent vulnerability writeups and reports continue to show Markdown/WebView preview as a meaningful desktop attack surface, especially where Markdown XSS can reach Electron or native APIs. Source: https://www.sentinelone.com/vulnerability-database/cve-2021-47836/

## Ranked Opportunities

### 1. Document Trust Mode With Visible Security State

Classification: Necessary
Placement: v1

Add a per-document trust state in the toolbar/status bar: `Safe Preview` by default, with a concise popover showing active restrictions: scripts disabled, raw HTML stripped, remote images blocked, local images scoped, Mermaid strict, KaTeX untrusted. If any blocked content exists, the state becomes `Content Blocked`.

Rationale: VS Code's preview security UI shows users that restrictions are intentional and adjustable. For `preview-md`, this turns existing hardening into a core product differentiator. It also avoids users misdiagnosing missing images or stripped HTML as rendering bugs.

Implementation shape: no raw-HTML enablement in v1. The mode is informational plus "show blocked items", not a broad bypass. Settings can include "remember my default resource policy", but not "disable security".

### 2. Resource Policy Panel for Images and External Loads

Classification: Necessary
Placement: v1

Expose a small document-level panel listing resource policy decisions:

- Allowed local image roots for the current file.
- Blocked remote image URLs.
- Blocked `file://` or out-of-scope relative paths.
- Blocked non-image data URIs or invalid protocols.

Rationale: Remote image loading is both a security and privacy surface. Mail clients normalize "remote images blocked to protect privacy"; Markdown previewers should do the same, because Markdown files from issues, chats, AI agents, or docs can contain tracking pixels. Tauri's asset scope model gives `preview-md` a strong local-resource story if the app makes it observable.

Implementation shape: render returns a structured `BlockedResource[]` ledger alongside HTML. The UI shows a count and details. No network allowlist in v1.

### 3. External Link Confirmation and Trusted Domains

Classification: High-value
Placement: v1

Intercept all link clicks. Open external URLs only after a confirmation dialog that shows the full normalized URL, scheme, host, and whether it was written as a disguised Markdown label. Add a small trusted-domain list for "do not ask again for this host".

Rationale: `preview-md` is not a browser. Link clicks cross from a local document viewer into the user's browser or another desktop handler. VS Code-style trusted domains are an expected safety feature, especially for files opened from downloads or chat exports.

Implementation shape: allow in-document anchors without prompting. Prompt for `http`, `https`, `mailto`, and any future custom schemes. Keep custom protocol handlers YAGNI; this is about outbound links only.

### 4. Local File Exposure Guardrails and "Accessed Paths" Audit

Classification: Necessary
Placement: v1

Add an "Accessed paths" view for the current document that lists the opened Markdown file, allowed asset directories, and every local image actually loaded. Out-of-scope paths should be shown as blocked with normalized/canonicalized paths where safe to display.

Rationale: Tauri scopes reduce blast radius only if application code enforces them correctly. Users reviewing untrusted Markdown should be able to verify that opening `README.md` did not cause the app to read arbitrary files outside the document directory.

Implementation shape: derive from the same canonical path resolver used by rendering. Avoid leaking private absolute paths into exported documents or copied HTML.

### 5. Security Regression Corpus and WebView Fetch Sentinel

Classification: Necessary
Placement: v1

Create a dedicated security corpus for Markdown XSS, sanitizer URL edge cases, Mermaid/KaTeX trust boundaries, and CSP/resource policy behavior. Include a WebView e2e sentinel that fails if a document triggers unexpected network requests or loads a disallowed local asset.

Rationale: The local review history already found subtle URL parser mismatches such as protocol-relative and backslash network-path image forms. This class of bug recurs unless captured as regression fixtures. OWASP/MDN guidance is broad; the project needs app-specific invariants.

Implementation shape: golden sanitizer tests for output, plus e2e CSP/fetch tests. Consider a local HTTP server in tests that records any request; the safe default expectation is zero network fetches.

### 6. Mermaid and KaTeX Trust Badges Per Rendered Block

Classification: High-value
Placement: v1.1

For each rendered Mermaid or KaTeX block, provide a subtle block menu/status affordance showing the active trust policy: Mermaid strict/sandbox, KaTeX trust false, links disabled, external includes denied. If rendering fails due to security restrictions, make the reason visible.

Rationale: Mermaid and KaTeX are special because their DOM is produced after the sanitizer. The current plan correctly relies on pinned libraries plus strict settings; a block-level explanation makes that exceptional trust path understandable without exposing raw internals.

Implementation shape: v1 can show global policy; v1.1 can attach per-block diagnostics and "copy sanitized source" debugging.

### 7. Privacy-First Remote Image Upgrade Path

Classification: High-value
Placement: v1.1

Keep v1 network image loading off. In v1.1, if users demand remote images, add an explicit resource mode rather than a plain on/off switch:

- `Local only` default.
- `Ask per document`.
- `Allow HTTPS images for this trusted folder`.
- Optional fetch cap: size limit, image MIME validation, no cookies, no redirects beyond a small limit.

Rationale: Competitors and users often expect Markdown images to "just work", but automatic remote loads leak IP, timing, user agent, and document-open events. A careful opt-in can improve compatibility without undercutting the Linux privacy story.

Implementation shape: keep remote fetches in Rust, not direct WebView loads, so the app can strip credentials, enforce content type/size, and cache intentionally. Avoid `http` except as a separately named insecure mode.

### 8. Safe Export Contract

Classification: High-value
Placement: v1.1 or later

When export eventually arrives, make "safe export" the first export mode: sanitized standalone HTML with no scripts, no remote resources by default, and an export report listing stripped content. PDF export is already YAGNI for v1, but security requirements should be captured before the feature arrives.

Rationale: Export paths often use a different renderer or browser context and can reintroduce XSS, remote fetches, or local path disclosure. The current v1 YAGNI list includes PDF export; this opportunity is a future acceptance contract, not a v1 feature.

Implementation shape: add to roadmap/spec now. When implemented, export should consume the same sanitized render result and resource ledger as preview.

### 9. Sanitizer Policy Inspector for Developers and Power Users

Classification: Nice-to-have
Placement: v1.1

Add a debug command or settings panel that shows the sanitizer policy version, allowed tags/attributes/protocols, CSP, Tauri capability summary, and library versions for Mermaid/KaTeX/CodeMirror.

Rationale: Trust is easier to maintain when users and maintainers can inspect the active policy. This also helps bug reports: "why did this tag disappear?" becomes answerable without reading source.

Implementation shape: hidden command palette item or `--security-report` CLI. Avoid making this prominent in the core UX.

### 10. Security Review Checklist as Release Artifact

Classification: High-value
Placement: v1

Ship a short `SECURITY.md` or in-app "Security model" page that states the product promises:

- Markdown is untrusted.
- No telemetry/cloud by default.
- Remote images blocked by default.
- Raw HTML stripped in v1.
- File access is scoped to opened files and their allowed image directories.
- Mermaid/KaTeX run with restrictive trust settings.
- Vulnerability reporting path.

Rationale: Desktop privacy claims are strongest when concrete and falsifiable. This is low implementation cost and aligns with current product positioning.

Implementation shape: document-only plus maybe an About dialog link. Keep it factual; avoid vague "military-grade" language.

### 11. Optional Hardened Mermaid Sandbox Mode

Classification: Nice-to-have
Placement: later

Investigate Mermaid `securityLevel: "sandbox"` for untrusted-document mode or high-risk workspaces.

Rationale: Mermaid's own docs describe sandbox mode as iframe-based isolation, which is stronger than strict mode. The trade-off is integration complexity, theming friction, and possible Linux WebKit/Tauri iframe quirks. Because v1 already has raw HTML off and Mermaid strict, this is not necessary for v1.

Implementation shape: prototype only after v1. Test carefully on WebKitGTK. Do not let iframe/remote capability quirks merge Tauri permissions into untrusted frames.

### 12. Workspace or Folder Trust Profiles

Classification: Nice-to-have
Placement: later

Add trust profiles for folders: downloaded/untrusted, personal notes, project docs. Profiles could control whether link confirmations are remembered, whether remote images can be requested, and whether raw HTML can ever be considered when that v2 feature is revisited.

Rationale: VS Code-style trust models make sense for developer tools, but a full workspace trust system can sprawl. Since `preview-md` currently opens files and has a file browser/tabs, a lightweight later profile may be useful, but v1 should avoid a complex permission product.

Implementation shape: start with per-document indicators and per-host trusted domains. Promote to folder profiles only if users repeatedly need persistent decisions.

## Proposed v1 Cut

Necessary for v1:

- Document Trust Mode With Visible Security State.
- Resource Policy Panel for Images and External Loads.
- External Link Confirmation and Trusted Domains.
- Local File Exposure Guardrails and "Accessed Paths" Audit.
- Security Regression Corpus and WebView Fetch Sentinel.
- Security Review Checklist as Release Artifact.

High-value for v1.1:

- Mermaid and KaTeX Trust Badges Per Rendered Block.
- Privacy-First Remote Image Upgrade Path, if compatibility pressure is real.
- Sanitizer Policy Inspector.
- Safe Export Contract before export work starts.

Later:

- Hardened Mermaid sandbox mode.
- Folder/workspace trust profiles.

## Anti-Opportunities for v1

- Do not add a raw-HTML toggle in v1. It is already listed as YAGNI, and it would force the hardest trust questions before the app has established its default security model.
- Do not add direct WebView remote image loading. If remote images arrive, fetch through Rust with explicit policy and telemetry-free behavior.
- Do not add runnable code blocks. This is explicitly out of scope and would invert the "Markdown is inert content" promise.
- Do not add custom protocol handlers yet. Link confirmation is enough for outbound navigation; inbound protocol handling is a larger desktop attack surface.
- Do not add plugins as a way to solve trust. Plugins make the trust story harder and are already parked.

## Open Questions for Future Design

- Should blocked-content details be stored only in memory, or can recent blocked hosts be persisted for diagnostics?
- Should trusted domains be global, per-folder, or per-document? v1 can start global with clear editing.
- Should local image scope include only the document directory and `images/`, or should the file browser's trusted base directory also influence it?
- Should the app provide a "copy sanitized HTML" command for debugging before any formal export feature?
- Can WebKitGTK test instrumentation reliably catch all attempted image/network loads, or is a local proxy/server sentinel needed in CI?

