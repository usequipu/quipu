# Plan: Search Text Highlighting (Matched Text, Not Whole Line)

## Context
The search panel highlights the entire line when clicking a search result. It should highlight only the matched text within the line.

## Files to Modify
- `src/components/SearchPanel.jsx`
- `src/styles/theme.css`

## Implementation

### SearchPanel.jsx - Modify highlightEditorLine

Replace the current `highlightEditorLine` function (lines 90-112) to highlight matched text instead of the whole block:

```jsx
const highlightEditorLine = useCallback((lineNumber, searchText) => {
  if (highlightTimeoutRef.current) {
    clearTimeout(highlightTimeoutRef.current);
  }
  // Remove previous text highlights
  document.querySelectorAll('.search-highlight-text').forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });

  highlightTimeoutRef.current = setTimeout(() => {
    const editorEl = document.querySelector('.ProseMirror');
    if (!editorEl) return;
    const blocks = Array.from(editorEl.children);
    const targetEl = blocks[lineNumber - 1];
    if (!targetEl) return;

    targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Find and wrap matched text within the block
    if (searchText) {
      const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT);
      const searchLower = isCaseSensitive ? searchText : searchText.toLowerCase();
      let node;
      while ((node = walker.nextNode())) {
        const text = isCaseSensitive ? node.textContent : node.textContent.toLowerCase();
        const idx = text.indexOf(searchLower);
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + searchText.length);
          const mark = document.createElement('mark');
          mark.className = 'search-highlight-text';
          range.surroundContents(mark);
          break;
        }
      }
    }

    highlightTimeoutRef.current = setTimeout(() => {
      document.querySelectorAll('.search-highlight-text').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      });
    }, 2500);
  }, 300);
}, [isCaseSensitive]);
```

Update `handleResultClick` to pass the query:
```jsx
const handleResultClick = useCallback((filePath, lineNumber) => {
  if (!workspacePath) return;
  const absolutePath = workspacePath + '/' + filePath;
  const fileName = filePath.split('/').pop();
  openFile(absolutePath, fileName);
  if (lineNumber) {
    highlightEditorLine(lineNumber, query);  // Pass query
  }
}, [workspacePath, openFile, highlightEditorLine, query]);
```

### theme.css - Add text highlight style

Add after the existing `.search-highlight-line` rule:

```css
.search-highlight-text {
  background-color: var(--color-accent-muted);
  border-radius: 2px;
  padding: 1px 0;
  animation: search-highlight-fade 2s ease-out;
}
```

## Verification
- Search for a term, click a result
- Only the matched text should be highlighted with accent color, not the whole line
- Highlight should fade out after ~2 seconds
- Scrolls to the match smoothly
