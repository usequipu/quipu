---
title: "feat: Editor Clash Grotesk font, command palette, and dark/light theme toggle"
type: feat
status: active
date: 2026-03-01
---

# Editor Font, Command Palette & Theme Toggle

Three interconnected features to level up the Quipu editor experience: a distinctive editor typeface, a VS Code-style command palette, and a Claude-inspired dark theme with toggle.

## Overview

1. **Clash Grotesk font** for the editor only (rest of UI stays on Inter)
2. **Command palette** via Ctrl+P `>` prefix and Ctrl+Shift+P direct access
3. **Dark/light theme toggle** — light = current warm beige (Tasokare), dark = Claude.ai dark UI

## Proposed Solution

### Feature 1: Clash Grotesk Editor Font

**Approach:** Introduce a `--font-editor` CSS custom property used exclusively by the ProseMirror editor area. Self-host WOFF2 files in `public/fonts/`.

**Font weights to include:** 400 (body), 500 (medium), 600 (headings h2-h6), 700 (h1, bold)

**Files to change:**

- `public/fonts/` — new directory with Clash Grotesk WOFF2 files (4 weights)
- `src/index.css` — add `@font-face` declarations for each weight
- `src/styles/theme.css` — add `--font-editor` variable in `@theme`
- `src/styles/prosemirror.css:11` — change `var(--font-sans)` → `var(--font-editor)`

**Font-face declaration pattern:**
```css
@font-face {
  font-family: 'Clash Grotesk';
  src: url('/fonts/ClashGrotesk-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* ... repeat for 500, 600, 700 */
```

**Theme variable:**
```css
@theme {
  --font-editor: 'Clash Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

**What stays on Inter:** Everything outside `.ProseMirror` — sidebar, tabs, menus, terminal, titlebar, frontmatter panel, comment sidebar cards. Code blocks inside the editor stay on `--font-mono` (JetBrains Mono).

**Electron/browser parity:** `public/fonts/` is served by both Vite dev server and Electron's static file serving. The `base: './'` in `vite.config.js` ensures relative paths work in production builds.

---

### Feature 2: Command Palette

**Approach:** Extend `QuickOpen.jsx` to support dual modes: file mode (default) and command mode (triggered by `>` prefix). This mirrors VS Code's exact UX and avoids creating a separate component.

**New file:**
- `src/data/commands.js` — shared command definitions (extracted from `MenuBar.jsx` menus + new commands)

**Files to change:**
- `src/components/QuickOpen.jsx` — add command mode with `>` prefix detection
- `src/components/MenuBar.jsx` — import menu definitions from shared `commands.js`
- `src/App.jsx` — add `Ctrl+Shift+P` shortcut, add `theme.toggle` and `view.commandPalette` to `handleMenuAction`

#### Command definitions (`src/data/commands.js`)

Flat array of command objects, imported by both MenuBar and QuickOpen:

```js
export const commands = [
  { label: 'New File', shortcut: 'Ctrl+N', action: 'file.new', category: 'File' },
  { label: 'Open Folder', action: 'file.openFolder', category: 'File' },
  { label: 'Save', shortcut: 'Ctrl+S', action: 'file.save', category: 'File' },
  { label: 'Close Tab', shortcut: 'Ctrl+W', action: 'file.closeTab', category: 'File' },
  { label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit.undo', category: 'Edit' },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit.redo', category: 'Edit' },
  { label: 'Cut', shortcut: 'Ctrl+X', action: 'edit.cut', category: 'Edit' },
  { label: 'Copy', shortcut: 'Ctrl+C', action: 'edit.copy', category: 'Edit' },
  { label: 'Paste', shortcut: 'Ctrl+V', action: 'edit.paste', category: 'Edit' },
  { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: 'edit.findInFiles', category: 'Edit' },
  { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: 'view.explorer', category: 'View' },
  { label: 'Search', shortcut: 'Ctrl+Shift+F', action: 'view.search', category: 'View' },
  { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: 'view.git', category: 'View' },
  { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: 'view.toggleSidebar', category: 'View' },
  { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'view.toggleTerminal', category: 'View' },
  { label: 'Quick Open', shortcut: 'Ctrl+P', action: 'view.quickOpen', category: 'View' },
  { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', action: 'view.commandPalette', category: 'View' },
  { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'terminal.toggle', category: 'Terminal' },
  { label: 'Send to Terminal', action: 'terminal.send', category: 'Terminal' },
  // New
  { label: 'Toggle Theme (Dark/Light)', action: 'theme.toggle', category: 'Preferences' },
];

// MenuBar consumes this grouped by category
export const menus = [
  { label: 'File', items: commands.filter(c => c.category === 'File') },
  { label: 'Edit', items: commands.filter(c => c.category === 'Edit') },
  // ... etc, with separators injected
];
```

#### QuickOpen changes

Mode detection in `handleQueryChange`:
```js
const isCommandMode = query.trimStart().startsWith('>');
```

When in command mode:
- **Placeholder text** changes to `"Type a command..."`
- **Results** show filtered commands instead of files (no async file fetch needed)
- **Each result** shows: `category: label` on left, `shortcut` on right (dimmed)
- **Enter/click** calls `onAction(command.action)` then closes
- **Backspacing past `>`** switches back to file mode

When opened via Ctrl+Shift+P:
- QuickOpen opens with initial value `"> "` pre-filled
- Immediately in command mode

#### Keyboard shortcut in App.jsx

Add before the existing `Ctrl+P` handler (since `e.key === 'P'` when shift is held):

```js
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
  e.preventDefault();
  setIsQuickOpenVisible(true);
  setQuickOpenInitialValue('> ');
  return; // prevent falling through to Ctrl+P handler
}
```

Add `onAction` prop to QuickOpen:
```jsx
<QuickOpen
  isOpen={isQuickOpenVisible}
  onClose={() => setIsQuickOpenVisible(false)}
  onAction={handleMenuAction}
  initialValue={quickOpenInitialValue}
/>
```

#### Missing handleMenuAction cases to add

```js
case 'edit.cut':
  document.execCommand('cut');
  break;
case 'edit.copy':
  document.execCommand('copy');
  break;
case 'edit.paste':
  document.execCommand('paste');
  break;
case 'view.commandPalette':
  setIsQuickOpenVisible(true);
  setQuickOpenInitialValue('> ');
  break;
case 'theme.toggle':
  toggleTheme(); // see Feature 3
  break;
```

---

### Feature 3: Dark/Light Theme Toggle

**Approach:** Override CSS custom properties via a `.dark` class on `<html>`. Persist in `localStorage`. Prevent FOUC with a synchronous script in `index.html`.

#### Dark theme color palette (Claude.ai-inspired)

```css
:root.dark {
  /* Background layers */
  --color-bg-base: #1a1a1a;
  --color-bg-surface: #242424;
  --color-bg-elevated: #2d2d2d;
  --color-bg-overlay: #333333;

  /* Text */
  --color-text-primary: #e8e8e0;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #666666;

  /* Accent - keep terracotta, adjust muted for dark bg */
  --color-accent: #c4835a;
  --color-accent-hover: #d4935a;
  --color-accent-muted: #3d2d20;

  /* Borders */
  --color-border: #383838;
  --color-border-focus: #c4835a;

  /* Editor page (warm dark, not pure black) */
  --color-page-bg: #2b2926;
  --color-page-text: #e8e8e0;
  --color-page-border: #383838;

  /* Semantic - slightly brighter for dark bg visibility */
  --color-success: #3fb950;
  --color-warning: #d29922;
  --color-error: #f85149;
  --color-info: #58a6ff;

  /* Git status - match semantic adjustments */
  --color-git-modified: #d29922;
  --color-git-added: #3fb950;
  --color-git-deleted: #f85149;
  --color-git-renamed: #58a6ff;
  --color-git-untracked: #666666;
}
```

#### Files to change

| File | Change |
|------|--------|
| `src/styles/theme.css` | Add `:root.dark { }` block with all dark overrides |
| `index.html` | Add sync `<script>` for FOUC prevention |
| `src/App.jsx` | Add `toggleTheme()` function, wire to `handleMenuAction` |
| `src/components/Editor.jsx:351` | `bg-white` → `bg-page-bg` |
| `src/components/Editor.jsx:431` | Comment input `bg-white` → `bg-bg-surface` |
| `src/components/Editor.jsx:462` | Comment card `bg-white` → `bg-bg-surface` |
| `src/components/Editor.jsx:471-473` | `#57606a` → `text-text-secondary` |
| `src/components/Editor.jsx:473` | `hover:bg-[#e5e7eb]` → `hover:bg-bg-elevated` |
| `src/styles/prosemirror.css:153-161` | Comment mark colors → use CSS vars with dark overrides |

#### FOUC prevention (`index.html`)

Add before `<div id="root">`:

```html
<script>
  if (localStorage.getItem('quipu-theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
</script>
```

#### Toggle function (in App.jsx)

```js
const toggleTheme = useCallback(() => {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('quipu-theme', isDark ? 'dark' : 'light');
}, []);
```

No React state needed — CSS custom properties handle everything reactively. The `toggleTheme` function is called from `handleMenuAction` when `theme.toggle` fires.

#### Terminal

Terminal keeps its own dark color scheme regardless of app theme (matches VS Code behavior where terminal theme is independent). No changes to `Terminal.jsx`.

#### Comment highlight colors (prosemirror.css)

Replace hardcoded colors with CSS variables:

```css
mark.comment {
  background-color: var(--color-comment-bg, #f7e6b5);
  border-bottom: 2px solid var(--color-warning);
  cursor: pointer;
}
mark.comment:hover {
  background-color: var(--color-comment-bg-hover, #ffe69c);
}
```

Add to dark overrides:
```css
:root.dark {
  --color-comment-bg: #4a3d20;
  --color-comment-bg-hover: #5a4d2a;
}
```

## Acceptance Criteria

### Font
- [ ] Editor body text renders in Clash Grotesk (400 weight)
- [ ] Editor headings render in Clash Grotesk (600/700 weight)
- [ ] Editor code blocks still use JetBrains Mono
- [ ] UI elements (sidebar, tabs, menus, titlebar) stay on Inter
- [ ] Font loads without layout shift (font-display: swap)
- [ ] Works in both Electron and browser runtime

### Command Palette
- [ ] Ctrl+P opens QuickOpen in file mode (existing behavior preserved)
- [ ] Typing `>` as first character switches to command mode
- [ ] Ctrl+Shift+P opens QuickOpen directly in command mode with `> ` pre-filled
- [ ] All menu actions appear as commands with category labels and shortcuts
- [ ] "Toggle Theme" command appears and works
- [ ] Fuzzy filtering works on command labels
- [ ] Keyboard navigation (arrows, enter, escape) works in command mode
- [ ] Backspacing past `>` returns to file mode
- [ ] Selecting a command executes it and closes the palette

### Theme Toggle
- [ ] Light theme (default) matches current warm beige/cream appearance
- [ ] Dark theme applies Claude.ai-inspired dark colors across entire UI
- [ ] Theme persists across page reloads via localStorage
- [ ] No flash of wrong theme on load (FOUC prevention)
- [ ] All hardcoded `bg-white` in Editor.jsx replaced with theme tokens
- [ ] Comment highlights adapt to dark mode
- [ ] Scrollbars adapt (already using CSS vars)
- [ ] Toast notifications adapt
- [ ] Editor "page" rectangle uses `bg-page-bg` (dark warm tone in dark mode)

## Implementation Order

1. **Font first** — most self-contained, no dependencies, quick win
2. **Theme second** — sets up the CSS variable infrastructure the command palette will reference
3. **Command palette last** — depends on `theme.toggle` action existing, requires shared command extraction

## Dependencies & Risks

- **Clash Grotesk WOFF2 files**: Must be downloaded from [Fontshare](https://www.fontshare.com/fonts/clash-grotesk) and placed in `public/fonts/`. The font is free for commercial use.
- **Tailwind v4 + `:root.dark`**: The `:root.dark {}` block sits outside `@theme` and directly overrides CSS custom properties. This works because Tailwind v4 utilities like `bg-bg-base` resolve to `var(--color-bg-base)`, which the dark overrides change at the root level.
- **Editor `bg-white` hardcodes**: Changing these to `bg-page-bg` is required for dark mode to work. Low risk since `--color-page-bg` is `#ffffff` in light mode (identical to current `bg-white`).
- **QuickOpen refactor**: Adding command mode to QuickOpen is the largest single change. The `onAction` prop and mode-switching logic need careful keyboard event handling.
