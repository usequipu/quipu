---
name: keyboard-shortcuts
description: Pattern for adding keyboard shortcuts to the Quipu editor
triggers:
  - keyboard shortcut
  - keybinding
  - hotkey
  - Ctrl+key
  - key binding
  - shortcut
---

# Keyboard Shortcuts Pattern

Use this skill when adding or modifying keyboard shortcuts in Quipu.

## Current Shortcuts

| Shortcut | Action | Location |
|---|---|---|
| `Ctrl+S` | Save active file | App.jsx |
| `Ctrl+B` | Toggle sidebar | App.jsx |
| `Ctrl+W` | Close active tab | App.jsx |
| `Ctrl+Tab` | Next tab | App.jsx |
| `Ctrl+Shift+Tab` | Previous tab | App.jsx |
| `Ctrl+Shift+F` | Open search panel | App.jsx |
| `Ctrl+P` | Toggle QuickOpen | App.jsx |
| `` Ctrl+` `` | Toggle terminal | App.jsx |
| `Ctrl+Shift+Enter` | Send editor content to terminal | App.jsx |
| `Ctrl+Shift+L` | Send file to Claude with FRAME context | App.jsx |

## Adding a New Shortcut

All global shortcuts are registered in the `useEffect` keydown handler in `src/App.jsx`:

```jsx
useEffect(() => {
    const handler = (e) => {
        // Existing shortcuts...

        // New shortcut
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            e.preventDefault();
            // action here
        }

        // With Shift modifier
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
            e.preventDefault();
            // action here
        }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}, [/* dependencies used in handlers */]);
```

## Rules

1. **Always use `(e.ctrlKey || e.metaKey)`** to support both Windows/Linux (Ctrl) and macOS (Cmd)
2. **Always call `e.preventDefault()`** to suppress browser defaults (e.g., Ctrl+S save dialog, Ctrl+W close tab)
3. **Add all dependencies** to the useEffect dependency array
4. **Check for Shift separately**: `e.shiftKey && e.key === 'F'` (uppercase when Shift is held)
5. **Tab key special case**: `e.key === 'Tab'` with Ctrl modifier -- note that `e.key` is `'Tab'` not `'tab'`

## Key Detection Notes

- `e.key` is case-sensitive when Shift is held: `'f'` vs `'F'`
- For `Ctrl+Tab`, check `e.key === 'Tab'` then check `e.shiftKey` for direction
- Modifier keys: `e.ctrlKey`, `e.metaKey`, `e.shiftKey`, `e.altKey`
- Some shortcuts conflict with browser defaults -- `e.preventDefault()` is essential

## Component-Level Shortcuts

For shortcuts scoped to a specific component (e.g., Ctrl+Enter in a textarea):

```jsx
const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
    }
}, [handleSubmit]);

return <textarea onKeyDown={handleKeyDown} />;
```

## Avoid Conflicts

Before adding a shortcut, check:
1. The current shortcuts table above
2. Browser defaults (Ctrl+L, Ctrl+N, Ctrl+T are hard to override)
3. TipTap editor shortcuts (Ctrl+B = bold, Ctrl+I = italic when editor focused)

TipTap consumes its own shortcuts when the editor has focus. Global shortcuts in App.jsx fire on `document`, so they work even when focus is in the editor -- but may conflict with TipTap bindings.
