# preview-md UI Style Guide

## Overview

This style guide defines the visual design language for preview-md's webview UI. It is inspired by **shadcn/ui** principles: functional elegance, subtle depth, and refined typography — avoiding the "Bootstrap web page" aesthetic.

---

## Design Principles

1. **Subtle depth over flatness** — Layered surfaces using shadows and borders, not flat solid colors
2. **Refined typography** — Clean sans-serif for UI, monospace for code, serif option for prose
3. **Purposeful whitespace** — Generous padding, breathing room between elements
4. **Micro-interactions** — Smooth transitions (120-200ms), subtle hover states, focus rings
5. **Cohesive dark/light** — Both modes feel equally premium, not an afterthought

---

## Color Palette (CSS Variables)

### Core Surfaces
```css
--pmd-bg:           /* Main background */
--pmd-bg-elevated:  /* Elevated surfaces (toolbar, cards, modals) */
--pmd-bg-muted:     /* Subtle muted areas */

--pmd-fg:           /* Primary text */
--pmd-fg-muted:     /* Secondary/muted text */
--pmd-fg-subtle:    /* Very subtle text, hints */

--pmd-accent:        /* Primary accent (buttons, links, focus) */
--pmd-accent-foreground: /* Text on accent */

--pmd-border:        /* Default borders */
--pmd-border-strong: /* Emphasized borders */
--pmd-ring:          /* Focus rings */
```

### Semantic Colors
```css
--pmd-success:  /* Success states */
--pmd-warning:  /* Warning states */
--pmd-error:    /* Error states */
--pmd-info:     /* Info states */
```

### Shadows
```css
--pmd-shadow-sm:  /* Subtle elevation */
--pmd-shadow-md:  /* Medium elevation */
--pmd-shadow-lg:  /* High elevation (modals) */
--pmd-shadow-xl:  /* Maximum elevation */
```

---

## Typography

### Font Stack
- **UI Font**: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Mono Font**: `"JetBrains Mono", "Fira Code", "SF Mono", monospace`
- **Serif Font**: `"Source Serif 4", Georgia, serif`

### Type Scale
```css
--pmd-text-xs:   0.75rem;    /* 12px - labels, hints */
--pmd-text-sm:   0.875rem;   /* 14px - secondary text */
--pmd-text-base: 1rem;       /* 16px - body text */
--pmd-text-lg:   1.125rem;   /* 18px - subheadings */
--pmd-text-xl:   1.25rem;    /* 20px - section titles */
--pmd-text-2xl:  1.5rem;     /* 24px - page titles */
```

### Font Weights
```css
--pmd-font-normal:    400;
--pmd-font-medium:    500;
--pmd-font-semibold:  600;
--pmd-font-bold:      700;
```

---

## Spacing

### Base Unit: 4px

```css
--pmd-space-1:  0.25rem;   /* 4px */
--pmd-space-2:  0.5rem;    /* 8px */
--pmd-space-3:  0.75rem;   /* 12px */
--pmd-space-4:  1rem;      /* 16px */
--pmd-space-5:  1.25rem;   /* 20px */
--pmd-space-6:  1.5rem;    /* 24px */
--pmd-space-8:  2rem;      /* 32px */
--pmd-space-10: 2.5rem;    /* 40px */
--pmd-space-12: 3rem;      /* 48px */
```

---

## Border Radius

Inspired by shadcn's rounded-xl approach:
```css
--pmd-radius-sm:  4px;     /* Small elements (badges) */
--pmd-radius-md:  6px;     /* Default elements */
--pmd-radius-lg:  8px;     /* Cards, modals */
--pmd-radius-xl:  12px;    /* Large surfaces */
```

---

## Component Specifications

### 1. Toolbar (`.pmd-chrome`)

**Appearance:**
- Height: 44px (slightly taller for a more substantial feel)
- Background: `--pmd-bg-elevated` with subtle bottom border
- No heavy shadows — depth comes from the border
- Contains: File menu, title section, mode segmented control, theme button

**States:**
- Default: clean with subtle separator from content
- Hover on buttons: background `--pmd-bg-muted`, 120ms transition

### 2. Buttons

**Primary Button:**
```css
background: var(--pmd-accent);
color: var(--pmd-accent-foreground);
padding: var(--pmd-space-2) var(--pmd-space-4);
border-radius: var(--pmd-radius-md);
font-weight: var(--pmd-font-medium);
transition: all 120ms ease-out;
```

**Ghost Button (toolbar actions):**
```css
background: transparent;
color: var(--pmd-fg);
padding: var(--pmd-space-2) var(--pmd-space-3);
border-radius: var(--pmd-radius-md);
```
Hover: `background: var(--pmd-bg-muted)`

**Icon Button:**
- 32x32px, centered icon, `var(--pmd-radius-md)`
- Focus: `--pmd-ring` offset by 2px

### 3. Mode Segmented Control

A segmented button group for Source/Split/Preview:
```css
.pmd-segmented {
  display: inline-flex;
  background: var(--pmd-bg-muted);
  border-radius: var(--pmd-radius-lg);
  padding: 2px;
  gap: 2px;
}

.pmd-segmented-btn {
  padding: var(--pmd-space-2) var(--pmd-space-4);
  border-radius: var(--pmd-radius-md);
  font-size: var(--pmd-text-sm);
  font-weight: var(--pmd-font-medium);
  color: var(--pmd-fg-muted);
  transition: all 120ms ease-out;
}

.pmd-segmented-btn[data-active] {
  background: var(--pmd-bg);
  color: var(--pmd-fg);
  box-shadow: var(--pmd-shadow-sm);
}
```

### 4. Dropdown Menus

Shadcn-style dropdown:
```css
.pmd-dropdown {
  background: var(--pmd-bg-elevated);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-lg);
  padding: var(--pmd-space-1);
  min-width: 180px;
  box-shadow: var(--pmd-shadow-lg);
}

.pmd-dropdown-item {
  padding: var(--pmd-space-2) var(--pmd-space-3);
  border-radius: var(--pmd-radius-md);
  font-size: var(--pmd-text-sm);
  cursor: pointer;
  transition: background 80ms;
}

.pmd-dropdown-item:hover,
.pmd-dropdown-item[data-highlighted] {
  background: var(--pmd-bg-muted);
}

.pmd-dropdown-item[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### 5. Modal / Dialog Overlay

```css
.pmd-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 150ms ease-out;
}

.pmd-dialog {
  background: var(--pmd-bg-elevated);
  border-radius: var(--pmd-radius-xl);
  box-shadow: var(--pmd-shadow-xl);
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  animation: scaleIn 150ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
```

### 6. Input Fields

```css
.pmd-input {
  width: 100%;
  padding: var(--pmd-space-2) var(--pmd-space-3);
  font-size: var(--pmd-text-sm);
  background: var(--pmd-bg);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-md);
  color: var(--pmd-fg);
  transition: border-color 120ms, box-shadow 120ms;
}

.pmd-input:focus {
  outline: none;
  border-color: var(--pmd-accent);
  box-shadow: 0 0 0 3px var(--pmd-ring);
}

.pmd-input::placeholder {
  color: var(--pmd-fg-subtle);
}
```

### 7. Cards (Theme Picker)

```css
.pmd-card {
  background: var(--pmd-bg);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 120ms, box-shadow 120ms, transform 80ms;
}

.pmd-card:hover {
  border-color: var(--pmd-accent);
  box-shadow: var(--pmd-shadow-md);
  transform: translateY(-2px);
}

.pmd-card[data-selected] {
  border-color: var(--pmd-accent);
  box-shadow: 0 0 0 2px var(--pmd-accent);
}
```

### 8. Status Bar

- Height: 28px
- Background: transparent
- Font-size: `var(--pmd-text-xs)`
- Color: `var(--pmd-fg-muted)`
- Padding: 0 `var(--pmd-space-3)`
- No heavy background — just subtle text

### 9. Preview Pane Typography

Refined prose styling:
```css
.pmd-preview {
  padding: var(--pmd-space-8);
  max-width: 75ch;
  margin: 0 auto;
  line-height: 1.75;
}

.pmd-preview h1 {
  font-size: var(--pmd-text-2xl);
  font-weight: var(--pmd-font-bold);
  margin-bottom: var(--pmd-space-4);
  letter-spacing: -0.02em;
}

.pmd-preview h2 {
  font-size: var(--pmd-text-xl);
  font-weight: var(--pmd-font-semibold);
  margin-top: var(--pmd-space-8);
  margin-bottom: var(--pmd-space-3);
}

.pmd-preview p {
  margin-bottom: var(--pmd-space-4);
}

.pmd-preview code {
  background: var(--pmd-inline-code-bg);
  color: var(--pmd-inline-code-fg);
  padding: 0.15em 0.4em;
  border-radius: var(--pmd-radius-sm);
  font-size: 0.9em;
}
```

---

## Transitions & Animations

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Button hover | background, color | 120ms | ease-out |
| Card hover | border-color, box-shadow, transform | 120ms | ease-out |
| Modal enter | opacity, transform | 150ms | ease-out |
| Modal exit | opacity | 100ms | ease-in |
| Focus ring | box-shadow | 120ms | ease-out |
| Dropdown | opacity, transform | 150ms | ease-out |

---

## Dark Mode Adaptations

Dark mode should feel equally refined:
- Background surfaces use subtle blue-grey tints, not pure black
- Borders are slightly lighter than backgrounds for definition
- Text has sufficient contrast (WCAG AA minimum)
- Accent colors are adjusted for dark backgrounds
- Shadows are subtler (using rgba with low opacity)

---

## Accessibility

- All interactive elements have visible focus states (`--pmd-ring`)
- Color is never the only indicator (icons + text for states)
- Minimum touch target: 32x32px
- `aria-label` on icon-only buttons
- `role="dialog"` and focus trap on modals
- Reduced motion: respect `prefers-reduced-motion`

---

## Implementation Notes

1. **CSS Files Structure:**
   - `design-system.css` — Variables, resets, typography base
   - `base.css` — Component styles (will be refactored)
   - `components.css` — Reusable component classes (NEW)
   - `picker.css` — Theme picker specific styles
   - `mermaid-theme.css` — Mermaid diagram styling

2. **Class Naming:** BEM-inspired with `pmd-` prefix
   - Block: `.pmd-dropdown`
   - Element: `.pmd-dropdown__item`
   - Modifier: `.pmd-dropdown__item--disabled`

3. **Radix-style patterns** for interactive components:
   - All state managed via attributes (`data-state`, `data-disabled`, `data-active`)
   - CSS handles all visual states
   - JavaScript only toggles attributes

