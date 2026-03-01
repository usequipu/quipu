---
title: Implement editor font, command palette, and three-theme cycling system
date: 2026-03-01
category: ui-bugs
tags: [editor-styling, command-palette, theme-system, font-loading, css-custom-properties]
components: [Editor, QuickOpen, MenuBar, App, theme.css, prosemirror.css, commands.js]
severity: medium
resolution_time: session
---

# Editor Font, Command Palette & Theme Cycling System

## Problem Statement

Quipu Simple needed three interconnected UI enhancements:

1. **Custom editor font** — Replace default sans-serif in the TipTap/ProseMirror editor with Clash Grotesk, while keeping the rest of the UI on Inter
2. **Command palette** — VS Code-style dual-mode QuickOpen: Ctrl+P for file search, `>` prefix (or Ctrl+Shift+P) switches to command mode
3. **Three-theme cycling** — Light (neutral white), Tinted (Tasokare warm cream `#FCF1D4`), Dark (Claude.ai-inspired `#1a1a1a`) cycling via command or keyboard shortcut

## Solution

### Feature 1: Clash Grotesk Editor Font

- Downloaded 4 WOFF2 weights (400, 500, 600, 700) to `public/fonts/`
- Added `@font-face` declarations in `src/index.css` with `font-display: swap`
- Created `--font-editor` CSS variable in `@theme` block, separate from `--font-sans`
- Updated `src/styles/prosemirror.css` to use `font-family: var(--font-editor)`
- Only the ProseMirror editor area gets Clash Grotesk; sidebar, tabs, menus stay on Inter

### Feature 2: Command Palette (Dual-Mode QuickOpen)

- Created `src/data/commands.js` — single source of truth for 20 commands across File, Edit, View, Terminal, Preferences
- Rewrote `src/components/QuickOpen.jsx` with dual mode: file mode (default) and command mode (`>` prefix)
- Ctrl+P opens file finder; typing `>` switches to commands. Ctrl+Shift+P goes directly to command mode
- Updated `MenuBar.jsx` to import from shared commands
- Added `handleMenuAction` dispatcher in `App.jsx` for all command actions

### Feature 3: Three-Theme Cycling System

- Light theme: default `@theme` tokens (no class on `:root`)
- Tinted theme: `:root.tinted` overrides — warm cream from Tasokare (`#FCF1D4` bg, `#5a4e48` text)
- Dark theme: `:root.dark` overrides — Claude.ai-inspired (`#1a1a1a` bg, `#e8e8e0` text)
- `toggleTheme()` cycles light -> tinted -> dark -> light via localStorage + CSS class toggle
- FOUC prevention: synchronous `<script>` in `index.html` reads localStorage before React mounts
- Replaced all hardcoded colors in `Editor.jsx` with theme tokens (`bg-white` -> `bg-page-bg`, etc.)

## Key Code Examples

### Theme toggle (App.jsx)

```javascript
const toggleTheme = useCallback(() => {
  const root = document.documentElement;
  const current = localStorage.getItem('quipu-theme') || 'light';
  const cycle = { light: 'tinted', tinted: 'dark', dark: 'light' };
  const next = cycle[current] || 'light';
  root.classList.remove('dark', 'tinted');
  if (next !== 'light') root.classList.add(next);
  localStorage.setItem('quipu-theme', next);
}, []);
```

### FOUC prevention (index.html)

```html
<script>
  var t = localStorage.getItem('quipu-theme');
  if (t === 'dark' || t === 'tinted') document.documentElement.classList.add(t);
</script>
```

### Dual-mode detection (QuickOpen.jsx)

```javascript
const isCommandMode = query.trimStart().startsWith('>');
```

### Shared command definitions (commands.js)

```javascript
export const commands = [
  { label: 'New File', shortcut: 'Ctrl+N', action: 'file.new', category: 'File' },
  { label: 'Cycle Theme (Light / Tinted / Dark)', action: 'theme.toggle', category: 'Preferences' },
  // ... 18 more
];
```

### Three-theme CSS (theme.css)

```css
@theme {
  --color-bg-base: #f0f0f0;
  --color-page-bg: #ffffff;
  --font-editor: 'Clash Grotesk', 'Inter', sans-serif;
}

:root.dark {
  --color-bg-base: #1a1a1a;
  --color-page-bg: #2b2926;
}

:root.tinted {
  --color-bg-base: #EFE3C4;
  --color-page-bg: #FCF1D4;
}
```

## Errors Encountered

### 1. TipTap Table Named Import Error

**Error:** `"default" is not exported by "@tiptap/extension-table"` at build time.

**Fix:** Changed to named imports:
```javascript
// Before: import Table from '@tiptap/extension-table';
import { Table } from '@tiptap/extension-table';
```

### 2. Hardcoded Colors Breaking Themes

**Symptom:** Editor stayed white in dark mode, comment highlights had wrong colors.

**Fix:** Replaced all hardcoded values with theme tokens:
- `bg-white` -> `bg-page-bg`
- `text-[#57606a]` -> `text-text-secondary`
- `hover:bg-[#e5e7eb]` -> `hover:bg-bg-elevated`
- Comment marks: `background-color: var(--color-comment-bg, #f7e6b5)`

## Prevention Strategies

### Avoid hardcoded colors
Before shipping any theme work, audit components:
```bash
grep -r "bg-white\|text-\[#\|color:\s*#" src/components/
```
Replace all findings with semantic theme tokens.

### Separate font variables by context
Use distinct CSS variables for different UI regions: `--font-sans` (UI), `--font-editor` (editor content), `--font-mono` (code). Prevents font leakage when moving components.

### Always use synchronous FOUC prevention
Place a blocking `<script>` before `<div id="root">` in `index.html` that reads localStorage and applies the theme class. Never rely on React state for initial theme application.

### Verify third-party export types
TipTap extensions vary between default and named exports. Always check before importing.

## Best Practices Established

1. **CSS custom properties for all colors** — `@theme` block defines base, `:root.dark`/`:root.tinted` override. No React state needed for theme switching.
2. **Single command registry** — `src/data/commands.js` is the source of truth for both MenuBar menus and command palette commands.
3. **Self-hosted WOFF2 fonts** — Stored in `public/fonts/` with explicit `@font-face` declarations and `font-display: swap`.
4. **ProseMirror styles in plain CSS** — TipTap generates DOM outside React control; use `prosemirror.css` with CSS variables, not Tailwind utilities.

## Files Modified

| File | Change |
|------|--------|
| `public/fonts/*.woff2` | 4 Clash Grotesk font files (new) |
| `src/index.css` | @font-face declarations |
| `src/styles/theme.css` | `--font-editor`, `:root.dark`, `:root.tinted` blocks |
| `src/styles/prosemirror.css` | Editor font + comment highlight CSS vars |
| `src/data/commands.js` | Shared command definitions (new) |
| `src/components/QuickOpen.jsx` | Dual-mode file/command palette |
| `src/components/MenuBar.jsx` | Import from shared commands |
| `src/components/Editor.jsx` | Theme token replacements, named imports |
| `src/App.jsx` | toggleTheme, Ctrl+Shift+P, handleMenuAction |
| `index.html` | FOUC prevention script |

## Related Documentation

- [Tailwind v4 + TipTap Typography Reset](../ui-bugs/tailwind-v4-tiptap-typography-reset.md)
- [Editor Page Background Height](../ui-bugs/editor-page-background-height.md)
- [Editor Overhaul: Tabs, Search, Git](../ui-bugs/editor-overhaul-tabs-search-git.md)
- [Feature Plan](../../plans/2026-03-01-feat-editor-font-command-palette-theme-toggle-plan.md)
