---
title: "Rich Text Editor Mode with Toolbar and Comment Keyboard Shortcuts"
type: feature
status: solved
date: 2026-03-01
component: Editor
tags: [richtext, toolbar, editor-mode, tiptap, comments, ux, prosemirror, phosphor-icons]
symptoms:
  - "Formatting options only appeared on text selection (bubble menu) — hard to discover"
  - "No way to toggle between WYSIWYG and markdown-syntax viewing modes"
  - "Comment submission required mouse click — no keyboard shortcut support"
root_cause: "Editor relied solely on bubble menu for formatting, lacked mode toggle system, and comment interface didn't support standard keyboard shortcuts (Ctrl+Enter to submit, Escape to cancel)"
severity: medium
related:
  - docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md
  - docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md
  - docs/solutions/ui-bugs/false-dirty-state-on-file-open.md
  - docs/solutions/integration-issues/frame-system-multi-component-sync.md
  - docs/plans/2026-02-28-feat-markdown-frontmatter-reveal-syntax-plan.md
  - docs/plans/2026-03-01-feat-editor-rich-text-mode-comment-ux-plan.md
---

# Rich Text Editor Mode with Toolbar and Comment Keyboard Shortcuts

## Problem

The TipTap editor in Quipu Simple had three UX gaps:

1. **Formatting discovery** — The only way to format text was a bubble menu that appeared on selection. New users had no way to discover available formatting options.
2. **No mode switching** — The RevealMarkdown extension showed raw markdown syntax (`**`, `#`, etc.) but there was no way to toggle between WYSIWYG and markdown-syntax modes.
3. **Comment workflow** — Submitting a comment required clicking the "Comment" button; no Ctrl+Enter keyboard shortcut.

## Solution

### Files Modified

| File | Changes |
|------|---------|
| `src/components/Editor.jsx` | Mode state, toolbar UI, keyboard shortcuts, CSS class wrapper |
| `src/styles/prosemirror.css` | Toolbar button styles, RevealMarkdown visibility toggle |
| `src/data/commands.js` | Command palette entry for mode toggle |

### 1. Editor Mode State with localStorage Persistence

```javascript
const [editorMode, setEditorMode] = useState(() => {
    return localStorage.getItem('quipu-editor-mode') || 'richtext';
});

const toggleEditorMode = useCallback(() => {
    setEditorMode(prev => {
        const next = prev === 'richtext' ? 'obsidian' : 'richtext';
        localStorage.setItem('quipu-editor-mode', next);
        return next;
    });
}, []);
```

- Lazy initializer reads localStorage once on mount
- Default is `'richtext'` (WYSIWYG with toolbar)
- `'obsidian'` mode shows RevealMarkdown syntax decorations
- Preference persists across sessions

### 2. Rich Text Toolbar

A persistent formatting toolbar rendered above `<EditorContent>`, only in richtext mode:

```jsx
const ToolbarButton = ({ onClick, isActive, title, children }) => (
    <button
        className={cn('editor-toolbar-btn', isActive && 'active')}
        onClick={onClick}
        title={title}
        onMouseDown={(e) => e.preventDefault()}  // Prevents editor blur
    >
        {children}
    </button>
);
```

Toolbar buttons: Bold, Italic, Strikethrough | H1, H2, H3 | Bullet List, Ordered List | Blockquote, Code, Code Block.

Each button uses the TipTap command chain pattern:
```javascript
editor.chain().focus().toggleBold().run()
```

Active state via `editor.isActive('bold')` — synchronous read on every render, always reflects current editor state.

### 3. CSS-Based RevealMarkdown Toggle

Instead of re-creating the editor or modifying the RevealMarkdown extension, the `<EditorContent>` is wrapped with a mode class:

```jsx
<div className={editorMode === 'richtext' ? 'editor-richtext' : 'editor-obsidian'}>
    <EditorContent editor={editor} />
</div>
```

```css
.editor-richtext .reveal-syntax {
    display: none;
}
```

This approach:
- Has zero performance cost (pure CSS)
- Preserves editor state, cursor position, and undo history
- Causes no DOM disruption or flickering
- Keeps RevealMarkdown always loaded (decorations exist but are invisible)

### 4. Comment Keyboard Shortcuts

```jsx
<textarea
    onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            addComment();
        }
        if (e.key === 'Escape') {
            cancelComment();
        }
    }}
/>
```

Supports both Ctrl (Windows/Linux) and Cmd (macOS).

### 5. Command Palette Integration

```javascript
// src/data/commands.js
{ label: 'Toggle Editor Mode (Rich Text / Obsidian)', action: 'editor.toggleMode', category: 'Preferences' }
```

Toggle exposed via `window.__quipuToggleEditorMode` for App.jsx to wire through `handleMenuAction`.

## Key Design Decisions

### Why CSS toggle instead of extension recreation?

TipTap doesn't support adding/removing extensions after initialization. The alternatives were:
- **Destroy and recreate editor** — loses undo history, selection, unsaved state
- **Toggle extension `enabled` flag** — doesn't exist in TipTap API
- **CSS visibility** — zero cost, preserves everything

### Why `onMouseDown={preventDefault}` on toolbar buttons?

Clicking a toolbar button normally causes browser focus to move to the button, blurring the editor and losing the selection. `preventDefault` on `mousedown` suppresses the focus change while still allowing the `click` event to fire.

### Why window bridge instead of context/props?

The editor mode state lives in `Editor.jsx` but needs to be triggered from the command palette (in `App.jsx`). Since the plan scoped changes to only 3 files (not App.jsx), a window bridge provides cross-component communication without prop drilling or context changes.

## Prevention Strategies

### Toolbar Focus Management
- All toolbar buttons MUST have `onMouseDown={(e) => e.preventDefault()}`
- Call `editor.chain().focus()` before any command to restore focus
- Check `editor` existence before calling methods (null during loading)

### Extension Visibility Toggling
- Never add/remove TipTap extensions dynamically
- Use CSS `display: none` (not `visibility: hidden`) to fully hide decorations
- Keep extensions always loaded — toggle visibility only

### State Persistence
- Use lazy initializer (`useState(() => ...)`) for localStorage reads
- Update localStorage inside the state setter, not in a separate effect
- Validate stored values (whitelist check) to handle corruption

### Button State Synchronization
- Call `editor.isActive()` on every render — don't cache or memoize
- Don't maintain separate state for button active status
- Use `cn()` for conditional className composition

## Toolbar CSS

```css
.editor-toolbar-btn {
    padding: 4px 6px;
    border-radius: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--color-text-secondary);
    transition: background 0.15s, color 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.editor-toolbar-btn:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
}

.editor-toolbar-btn.active {
    background: var(--color-accent-muted);
    color: var(--color-accent);
}
```

Uses theme tokens from `src/styles/theme.css` for consistent styling across all three themes (light, tinted, dark).

## Future Work

- Wire `editor.toggleMode` action through `App.jsx` `handleMenuAction` switch
- Add Underline, Link, and text alignment buttons (requires installing `@tiptap/extension-underline`, `@tiptap/extension-link`, `@tiptap/extension-text-align`)
- Obsidian mode backspace behavior (pressing backspace at mark boundary should toggle the mark off)
- Keyboard shortcut for mode toggle (e.g., Ctrl+Shift+M)
