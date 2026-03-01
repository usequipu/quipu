---
title: Tailwind CSS v4 Preflight Reset Breaks TipTap Editor Typography
category: ui-bugs
tags: [tailwind, tiptap, prosemirror, css-reset, typography, styling]
symptoms: Editor headings lost sizes, lists lost bullets/numbers, horizontal rules disappeared, paragraphs lost margins, all HTML elements rendered as unstyled plain text
root_cause: Tailwind v4 @import preflight CSS reset stripped all default browser styles from HTML elements that ProseMirror renders
components: src/styles/prosemirror.css, src/styles/theme.css, src/components/Editor.jsx
date_solved: 2026-02-28
severity: high
recurrence_risk: medium
---

# Tailwind CSS v4 Preflight Reset Breaks TipTap Editor Typography

## Problem

After adding Tailwind CSS v4 (`@import "tailwindcss"` in `theme.css`), all TipTap editor typography broke:

- Headings (h1-h6) rendered at the same size as body text
- Lists lost their bullet/number markers and indentation
- Horizontal rules (`<hr>`) became invisible
- Paragraphs had no spacing between them
- Code blocks had no background color or distinct styling
- Blockquotes had no visual distinction

The editor content was technically present but completely unstyled, making documents unreadable.

## Investigation

The issue appeared after the Tailwind CSS v4 migration. The import order in `main.jsx`:

```jsx
import './styles/theme.css'       // @import "tailwindcss" — includes preflight reset
import './index.css'
import './styles/prosemirror.css'
```

Inspecting the rendered HTML in DevTools confirmed TipTap was generating proper semantic HTML elements (`<h1>`, `<ul>`, `<pre>`, `<hr>`, etc.), but they had no CSS rules applied — all inherited styles were zeroed out by Tailwind's preflight.

## Root Cause

Tailwind CSS v4's preflight reset (included automatically via `@import "tailwindcss"`) strips **all** default browser styles from HTML elements. This is intentional — it provides a blank slate for building UIs with utility classes.

However, TipTap/ProseMirror renders editor content as raw HTML elements within the `.ProseMirror` container. These elements don't have Tailwind utility classes; they rely on default browser styling. When preflight removes those defaults, the editor content becomes completely unstyled.

**Key insight:** Any library that generates its own DOM with semantic HTML elements (not React-managed components) will be affected by Tailwind's preflight reset.

## Solution

Added scoped typography rules inside `.ProseMirror` in `src/styles/prosemirror.css`:

```css
/* --- Typography reset (counters Tailwind preflight) --- */

.ProseMirror h1 { font-size: 2em; font-weight: 700; margin: 1em 0 0.5em; line-height: 1.2; }
.ProseMirror h2 { font-size: 1.5em; font-weight: 600; margin: 0.85em 0 0.4em; line-height: 1.3; }
.ProseMirror h3 { font-size: 1.25em; font-weight: 600; margin: 0.75em 0 0.35em; line-height: 1.35; }
.ProseMirror h4 { font-size: 1.1em; font-weight: 600; margin: 0.7em 0 0.3em; line-height: 1.4; }
.ProseMirror h5,
.ProseMirror h6 { font-size: 1em; font-weight: 600; margin: 0.6em 0 0.25em; }

.ProseMirror p { margin: 0 0 0.75em; }
.ProseMirror hr { border: none; border-top: 1px solid var(--color-border); margin: 1.5em 0; }

.ProseMirror blockquote {
  border-left: 3px solid var(--color-border);
  padding-left: 1em;
  margin: 0.75em 0;
  color: var(--color-text-secondary);
}

.ProseMirror ul { list-style-type: disc; padding-left: 1.5em; margin: 0.5em 0; }
.ProseMirror ol { list-style-type: decimal; padding-left: 1.5em; margin: 0.5em 0; }
.ProseMirror li { margin: 0.25em 0; }

.ProseMirror code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--color-bg-elevated);
  border-radius: 3px;
  padding: 0.15em 0.35em;
}

.ProseMirror pre {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--color-bg-elevated);
  border-radius: 6px;
  padding: 0.75em 1em;
  margin: 0.75em 0;
  overflow-x: auto;
}

.ProseMirror pre code { background: none; padding: 0; border-radius: 0; }
.ProseMirror strong { font-weight: 700; }
.ProseMirror em { font-style: italic; }
.ProseMirror s { text-decoration: line-through; }
.ProseMirror a { color: var(--color-accent); text-decoration: underline; }
.ProseMirror img { max-width: 100%; height: auto; }
```

### Why This Approach

- **Scoped to `.ProseMirror`** — only affects editor content, not the rest of the Tailwind-styled app
- **Import order** — `prosemirror.css` loads after `theme.css` in `main.jsx`, so its rules override the preflight reset
- **Uses CSS variables** — relies on existing design tokens (`--color-border`, `--color-accent`, `--font-mono`) for theme consistency
- **No extra dependencies** — avoids `@tailwindcss/typography` plugin which is harder to customize and adds bundle weight

### Alternatives Considered

| Approach | Why Rejected |
|----------|-------------|
| `@tailwindcss/typography` with `prose` class | Adds dependency, less control over exact sizes, harder to match design system |
| Disable Tailwind preflight entirely | Breaks the rest of the app's utility-class styling |
| `@layer base` overrides | More complex, harder to maintain, specificity issues |

## Prevention Strategies

### When Adding Tailwind to Projects with Rich Text Editors

1. **Identify DOM-generating libraries** before adding Tailwind — rich text editors, date pickers, tooltip libraries, syntax highlighters all create their own HTML
2. **Add scoped typography styles** for each library's container class immediately after enabling preflight
3. **Test visually** with real content: headings, lists, code blocks, links, horizontal rules

### Checklist After Any CSS Framework Migration

- [ ] h1-h6 have distinct sizes and weights
- [ ] Unordered/ordered lists show markers and indentation
- [ ] `<hr>` is visible
- [ ] Blockquotes have visual distinction
- [ ] Code blocks have background and monospace font
- [ ] Inline code has background and padding
- [ ] Links show color and underline
- [ ] Paragraph spacing is correct
- [ ] Nested lists indent properly
- [ ] Bold, italic, strikethrough all render

### Other Editors Affected by the Same Pattern

Any editor that auto-generates semantic HTML: **Slate**, **Draft.js**, **Quill**, **Lexical**, **CKEditor**. The fix pattern is the same — scope typography rules to the editor's container class.

## Related Documentation

- [editor-page-background-height.md](../ui-bugs/editor-page-background-height.md) — CSS layout fixes for TipTap editor container
- [false-dirty-state-on-file-open.md](../ui-bugs/false-dirty-state-on-file-open.md) — TipTap `setContent()` with `emitUpdate: false` pattern
- [Design system migration plan](../../plans/2026-02-28-feat-design-system-shadcn-phosphor-plan.md) — Full Tailwind v4 + shadcn/ui migration plan (lists this preflight risk)
