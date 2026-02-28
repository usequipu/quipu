---
title: Editor page background doesn't extend with long content
date: 2026-02-28
category: ui-bugs
tags:
  - flexbox
  - layout
  - editor
  - css
severity: medium
components:
  - src/components/Editor.css
  - src/components/Editor.jsx
symptoms:
  - White paper background stops after one viewport height
  - Content longer than viewport renders on tan background
root_causes:
  - "Default align-items: stretch on flex-direction: row container constrains .editor-page to viewport height"
resolution_type: css-fix
time_to_resolve: minimal
branch: feat/editor-overhaul
related:
  - docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md
  - docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md
---

# Editor Page Background Doesn't Extend With Long Content

## Problem

When opening a file with content longer than one viewport height, the white "paper" background of `.editor-page` only extended for the initial screen. Content below the fold rendered on the tan background (`#ede8d0`) instead of the expected white background.

## Root Cause Analysis

The CSS layout chain used flexbox with problematic defaults:

```css
/* src/components/Editor.css */
.editor-page-container {
  flex: 1;
  display: flex;
  justify-content: center;
  overflow-y: auto;
  padding: 3rem 4rem;
  /* align-items: stretch; (implicit default) */
}

.editor-page {
  width: 816px;
  min-height: 1056px;
  background: #ffffff;
  flex-shrink: 0;
}
```

The `.editor-page-container` is a `display: flex` container with the default `flex-direction: row`. The implicit `align-items: stretch` caused `.editor-page` to stretch its height to the container's cross-axis (viewport height) rather than growing with its ProseMirror content.

The height constraint chain:
- `#root` → `100vh`
- `.editor-layout` → `height: 100%; display: flex`
- `.editor-page-container` → `flex: 1; overflow-y: auto`

So `.editor-page` got `height = container height` (or `min-height: 1056px`, whichever larger). ProseMirror content overflowed visually, but the white background stopped at the stretch boundary.

## Solution

Added `align-items: flex-start` to `.editor-page-container` in `src/components/Editor.css`:

```css
.editor-page-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;  /* Added — prevents stretch to viewport height */
  overflow-y: auto;
  padding: 3rem 4rem;
  position: relative;
}
```

This stops flex stretch behavior. `.editor-page` now sizes based on its content height (with `min-height: 1056px` as the floor). Scrolling is unaffected since `overflow-y: auto` remains on the container.

## Prevention Strategies

- **Explicit alignment for scrollable containers**: When a flex container holds content that might overflow, always specify `align-items` explicitly. Never rely on the default `stretch` in containers with fixed or viewport-based heights.
- **Test with variable content heights**: During development, verify layouts with both minimal content and content that exceeds viewport height.
- **Separate concerns**: Use flex for layout structure, but let overflow properties handle scrolling. Don't let flex alignment interfere with scroll behavior.

## Patterns Established

**Scrollable flex child pattern:**
```css
.flex-container {
  display: flex;
  flex-direction: row;
  align-items: flex-start;  /* Allow children to set own height */
}

.scrollable-content {
  overflow-y: auto;          /* Handle overflow independently */
  min-height: <desired>;     /* Floor height, content can grow */
}
```

When a flex row container has a fixed height and children that should scroll, use `align-items: flex-start` so children size by content rather than stretching to the container's cross-axis.

## Testing Checklist

- [ ] Open a short file — white background shows with min-height, no excess whitespace
- [ ] Open a long file — white background extends to cover all content, scrollbar appears
- [ ] Resize window — layout responds correctly without background gaps
- [ ] Comments track still positioned correctly relative to the page
- [ ] Responsive breakpoints (1400px, 1200px, 1150px) still work
