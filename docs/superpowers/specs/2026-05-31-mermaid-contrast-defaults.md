# Mermaid contrast defaults

**Date:** 2026-05-31
**Status:** implemented

## Problem

Mermaid diagrams rendered with unreadable node labels — light text on a
light fill (dark themes) or dark on dark (light themes). Example: nodes
showed as solid lavender boxes with no visible text.

## Root cause

Mermaid's `base` theme uses `primaryColor` as the node **fill** and
`primaryTextColor` as the node **label** colour. All 17 bundled theme
manifests set both `mermaid_primary` and `mermaid_primary_text` to the same
palette value (`fg`). The backend mapped them straight through to
`primaryColor`/`primaryTextColor`, so every node's label was the same colour
as its fill — invisible. WCAG validation never caught it because its contrast
pairs don't include the mermaid fill/text pair.

## Fix

Good defaults derived from the core palette, still overridable per theme.

- **Backend** (`crates/pmd-app/src/cmd/theme.rs`): derive the full mermaid
  variable set from core palette tokens, each overridable by an explicit
  `mermaid_*` palette key:
  - node fill (`primaryColor`/`mainBkg`) ← `mermaid_primary` else `bg_elevated`
  - node label (`primaryTextColor`, and `secondary/tertiaryTextColor`,
    `textColor`, `nodeTextColor`, `titleColor`, `labelColor`) ← `mermaid_primary_text` else `fg`
  - node border (`primaryBorderColor`/`nodeBorder`, secondary/tertiary borders)
    ← `mermaid_primary_border` else `border`
  - lines (`lineColor`) ← `mermaid_line` else `fg_muted` (then `border`)
  - secondary fill ← `mermaid_secondary` else `bg_elevated` mixed 18% toward `accent`
  - tertiary fill ← `mermaid_tertiary` else `bg_elevated` mixed 10% toward `fg`
  - cluster/note/actor/error/edge-label derivations unchanged.

  Fill comes from a surface token and text from `fg`, so they sit at opposite
  ends of the palette and always contrast.

- **Schema** (`crates/pmd-core/src/theme/schema.rs`): the five basic
  `mermaid_*` keys move from *required* to *optional* (plus new optional
  `mermaid_primary_border`). A theme can now define **zero** mermaid keys and
  still get readable diagrams.

- **Manifests** (all 17 `themes/*/manifest.toml`): the broken
  `mermaid_primary` / `mermaid_primary_text` (`= fg`) lines are removed so the
  derived defaults govern. Intentional `mermaid_secondary`/`_tertiary`/`_line`
  overrides are retained.

## Allowing custom styling

The override path is preserved: any `mermaid_*` palette key set by a theme
wins over the derived default. So a theme author who wants bespoke diagram
colours simply sets the keys; everyone else gets sensible theme-matched
defaults for free.

## Regression guard

`crates/pmd-app/tests/cmd_theme.rs::every_bundled_theme_has_readable_mermaid_nodes`
asserts that, for every bundled theme, the derived `primaryColor` (fill) vs
`primaryTextColor` (label) pair clears WCAG AA (4.5:1).
