---
title: "feat: Search Result Click Highlight with Sigmoid Fade Animation"
type: feat
status: done
date: 2026-03-01
---

# Search Result Click Highlight with Sigmoid Fade Animation

## Overview

When clicking a search result line in SearchPanel, the matched line should be visually highlighted in the editor, then slowly fade back to the background color using a sigmoid-like easing curve (fast start, slow middle, fast end → perceptually smooth).

## Problem Statement / Motivation

Currently, clicking a search result (`SearchPanel.jsx:89-95`) opens the file but gives no visual feedback about which line matched. Users lose context of what they were searching for, especially in long files.

## Proposed Solution

1. When a search result is clicked, pass the **line number** to the `openFile` flow
2. After the editor loads the file, scroll to the target line
3. Apply a temporary highlight decoration at that line
4. Animate the highlight opacity from 1 → 0 using a sigmoid-like CSS easing curve over ~2 seconds

## Technical Considerations

- **SearchPanel.jsx** needs to pass `match.line` when calling `handleResultClick` (currently only passes `filePath`)
- **theme.css** needs a new keyframe animation with a custom `cubic-bezier` that approximates a sigmoid
- **SearchPanel.jsx** is the only component that changes (plus a keyframe in theme.css)
- The highlight can be implemented as a TipTap decoration or a simple CSS class applied to the DOM line
- Simpler approach: pass the line number via a ref/callback to the Editor and use `editor.commands.setTextSelection()` + a temporary CSS class

## System-Wide Impact

- **SearchPanel.jsx** — Add line number to click handler, add highlight logic
- **theme.css** — Add sigmoid fade keyframe animation
- **No changes to**: Editor.jsx, App.jsx, WorkspaceContext.jsx, any backend/service files

## Acceptance Criteria

- [x] Clicking a search result line opens the file AND scrolls to the matched line
- [x] The matched line gets a visible highlight (accent-colored background)
- [x] Highlight fades out over ~2 seconds with a sigmoid/smooth easing curve
- [x] Multiple rapid clicks reset the animation (don't stack highlights)
- [x] Works with all three themes (light, dark, tinted)

## Success Metrics

- Clear visual connection between "I clicked this search result" and "here's that line in the editor"

## Dependencies & Risks

- Low complexity — CSS animation + one line-number argument
- Needs a way to scroll to a line in the TipTap editor (can use `editor.commands.setTextSelection()` from pos + `scrollIntoView()`)

## MVP

### SearchPanel.jsx — Pass line number on click (~line 89)

```jsx
const handleResultClick = useCallback((filePath, lineNumber) => {
  if (!workspacePath) return;
  const absolutePath = workspacePath + '/' + filePath;
  const fileName = filePath.split('/').pop();
  openFile(absolutePath, fileName, { scrollToLine: lineNumber });
}, [workspacePath, openFile]);

// In the result rendering (~line 194):
onClick={() => handleResultClick(group.file, match.line)}
```

### theme.css — Sigmoid fade animation

```css
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

/* Applied to highlighted search result line */
.search-highlight-line {
  animation: search-highlight-fade 2s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  border-radius: 2px;
}
```

## Sources

- Search result click handler: `src/components/SearchPanel.jsx:89-95`
- Search result render: `src/components/SearchPanel.jsx:190-199`
- Theme animations: `src/styles/theme.css:133-164`
