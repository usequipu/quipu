---
title: Search Result Click Highlight with Sigmoid Fade Animation
description: Clicking a search result in the SearchPanel now scrolls to and visually highlights the matched line in the TipTap editor using a CSS animation that fades from accent-muted to transparent, providing clear visual feedback for the matched location.
type: feat
category: ui-bugs
components:
  - SearchPanel
  - Editor
date: 2026-03-01
status: solved
tags:
  - search
  - highlight
  - animation
  - tiptap
  - prosemirror
  - css-animation
  - scrollIntoView
  - visual-feedback
  - sidebar
  - theme
---

# Search Result Click Highlight with Sigmoid Fade Animation

## Problem

Clicking a search result in `SearchPanel` opened the file but gave no visual feedback about which line was matched. Users lost context of what they searched for, especially in long files. The `match.line` number was displayed in the sidebar but never used for navigation or highlighting.

**Symptom**: User clicks a search result → file opens → cursor lands at the top of the file → no indication of which line matched.

## Root Cause

`handleResultClick` only passed `filePath` to `openFile` — the `match.line` number was rendered in the UI but silently discarded:

```jsx
// Before — SearchPanel.jsx lines 89-95
const handleResultClick = useCallback((filePath) => {
  if (!workspacePath) return;
  const absolutePath = workspacePath + '/' + filePath;
  const fileName = filePath.split('/').pop();
  openFile(absolutePath, fileName);
}, [workspacePath, openFile]);

// Match onClick — line 194
onClick={() => handleResultClick(group.file)}
```

## Solution

Two files modified: `src/components/SearchPanel.jsx` and `src/styles/theme.css`. No changes to `Editor.jsx`, `WorkspaceContext.jsx`, App.jsx, or any backend files.

### SearchPanel.jsx

```jsx
// Add ref alongside debounceRef and inputRef
const highlightTimeoutRef = useRef(null);

const highlightEditorLine = useCallback((lineNumber) => {
  // Clear any pending highlight and remove existing ones (rapid-click reset)
  if (highlightTimeoutRef.current) {
    clearTimeout(highlightTimeoutRef.current);
  }
  document.querySelectorAll('.search-highlight-line').forEach(el => {
    el.classList.remove('search-highlight-line');
  });

  // Wait briefly for the file to load in the editor, then highlight
  highlightTimeoutRef.current = setTimeout(() => {
    const editorEl = document.querySelector('.ProseMirror');
    if (!editorEl) return;
    const blocks = Array.from(editorEl.children);
    const targetEl = blocks[lineNumber - 1];
    if (!targetEl) return;
    targetEl.classList.add('search-highlight-line');
    targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    highlightTimeoutRef.current = setTimeout(() => {
      targetEl.classList.remove('search-highlight-line');
    }, 2500);
  }, 300);
}, []);

const handleResultClick = useCallback((filePath, lineNumber) => {
  if (!workspacePath) return;
  const absolutePath = workspacePath + '/' + filePath;
  const fileName = filePath.split('/').pop();
  openFile(absolutePath, fileName);
  if (lineNumber) {
    highlightEditorLine(lineNumber);
  }
}, [workspacePath, openFile, highlightEditorLine]);

// Match row onClick — pass match.line
onClick={() => handleResultClick(group.file, match.line)}
```

### theme.css

```css
/* In @theme block */
--animate-search-highlight: search-highlight-fade 2s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;

/* Keyframe — holds accent-muted 0-15%, then fades to transparent */
@keyframes search-highlight-fade {
  0% {
    background-color: var(--color-accent-muted);
  }
  15% {
    background-color: var(--color-accent-muted);
  }
  100% {
    background-color: transparent;
  }
}

/* Applied via DOM manipulation from SearchPanel */
.search-highlight-line {
  animation: var(--animate-search-highlight);
  border-radius: 2px;
}
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| DOM manipulation instead of TipTap Decoration API | Strict constraint: only `SearchPanel.jsx` and `theme.css` modified. Avoids cross-component coupling with `Editor.jsx`. |
| 300ms delay | Allows file I/O + TipTap `setContent` + React re-render to settle before DOM query. |
| `highlightTimeoutRef` for rapid-click reset | Clears pending timeout; `querySelectorAll` removes existing class. Multiple rapid clicks never stack highlights. |
| `Array.from(editorEl.children)` | Direct children of `.ProseMirror` (paragraphs, headings). Ripgrep line numbers align with block node index for plain text and most markdown files. |
| `--color-accent-muted` for highlight color | Already defined for all three themes (light, dark, tinted) — no per-theme overrides needed. |
| 2.5s cleanup timeout | Removes class after animation completes (2s animation + 0.5s buffer). |

## Prevention & Best Practices

### When `Array.from(editorEl.children)[lineNumber - 1]` Breaks Down

The approach assumes 1:1 mapping between ProseMirror direct children and logical file lines. This fails for:

| Situation | Failure Mode |
|---|---|
| Nested lists | Only `<ul>`/`<ol>` is a direct child; `<li>` items are not |
| Tables | Entire table is one child; row line numbers don't map |
| Fenced code blocks | Entire block is one `<pre>` child |
| Hard breaks (`Shift+Enter`) | `<br>` does not create a new child; line numbers drift |
| `.quipu` JSON files | No meaningful raw-file line numbers |
| YAML frontmatter rendered as a block | Shifts all subsequent indices by 1+ |

### Timing Fragility

The 300ms delay is a race condition dressed as a solution. It fails silently when:
- The file is large (parsing is slow)
- The Go server is under load (late REST response)
- WSL with Windows Defender scanning delays disk reads
- TipTap re-renders asynchronously in the same window

There is no retry, no fallback, and no user-visible error when the timeout fires and the target element is `undefined`.

### Safe Extension Patterns

**Scope `document.querySelector` to the editor wrapper** (survives future split-view):
```javascript
// Use a ref scoped to the specific editor instance
const editorEl = editorWrapperRef.current?.querySelector('.ProseMirror');
```

**Replace fixed delay with a readiness signal** when modifying `WorkspaceContext` becomes acceptable:
```javascript
// After setContent resolves:
setEditorReady(false);
await loadFileContent(...);
requestAnimationFrame(() => setEditorReady(true));
// Highlight caller waits on isEditorReady transition
```

**Guard all DOM access** — silence is worse than a toast:
```javascript
const target = children[lineNumber - 1];
if (!target) {
  showToast('Could not scroll to line', 'warning');
  return;
}
```

### When to Use TipTap Decoration API Instead

Prefer the Decoration API when any of the following apply:

- **Highlight must survive re-renders** (user types while highlight is active)
- **Target is inside a nested node** (table cell, list item, code block)
- **Multiple simultaneous highlights** (highlight all matches, not just clicked one)
- **Highlight interacts with selection or cursor**
- **Split-view / multiple editor instances** (`document.querySelector` is global and breaks isolation)
- **File type is `.quipu`** (JSON format; no raw-file line numbers; use character offsets instead)

Use DOM manipulation only when:
- File type is plain text or Markdown
- Highlight is purely cosmetic and transient (< 2s animation)
- Single editor instance
- Strict "do not modify Editor component" constraint is in force

### Manual Test Checklist

- [ ] Open a 20+ line `.md` file. Click a search result for line 15. Verify editor scrolls and correct line highlights.
- [ ] Click the same result twice rapidly. Verify animation resets without a stuck highlight.
- [ ] Click a result in file A, then immediately click a result in file B. Verify highlight applies to file B's correct line.
- [ ] File starts with `# Heading`. Search for text in paragraph on line 3. Verify heading=line 1, paragraph=line 3.
- [ ] File contains a fenced code block. Search for text inside it. Observe whether highlight lands on the `<pre>` or silently fails.
- [ ] File contains YAML frontmatter. Search for text after frontmatter. Verify line numbers are correct.
- [ ] After animation completes, inspect DOM. Verify `.search-highlight-line` class has been removed.
- [ ] Trigger a highlight, then type a character before animation ends. Verify no console errors and class is eventually removed.

## Related Documentation

- [`docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md`](./editor-overhaul-tabs-search-git.md) — SearchPanel architecture, dual-runtime search service, debounce pattern
- [`docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md`](./tailwind-v4-tiptap-typography-reset.md) — ProseMirror CSS scoping, why DOM styles must live in `prosemirror.css` or global CSS
- [`docs/solutions/integration-issues/frame-system-multi-component-sync.md`](../integration-issues/frame-system-multi-component-sync.md) — `posToLineNumber()` / `lineNumberToPos()` helpers; TipTap position-to-DOM patterns
- [`docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md`](./editor-font-command-palette-theme-toggle.md) — Three-theme CSS system; `--color-accent-muted` token definitions per theme
- [`docs/solutions/integration-issues/resizable-panels-library-integration.md`](../integration-issues/resizable-panels-library-integration.md) — Panel architecture; `Ctrl+Shift+F` SearchPanel focus management
