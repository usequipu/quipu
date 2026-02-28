---
title: "fix: Editor page white background stops after one viewport height"
type: fix
status: completed
date: 2026-02-28
---

# fix: Editor page white background stops after one viewport height

When opening a file with content longer than the viewport, the white "paper" background of `.editor-page` only extends for one screen height. Content below that renders on the tinted `--bg-color` tan background instead of the white page.

## Root Cause

In [Editor.css](src/components/Editor.css), `.editor-page-container` is `display: flex` with the default `flex-direction: row`. The default `align-items: stretch` causes `.editor-page` to stretch its height to match the container's cross-axis (viewport height), rather than growing with its content.

The container's height is constrained by the flex layout chain:
- `#root` → `100vh`
- `.editor-layout` → `height: 100%; display: flex`
- `.editor-page-container` → `flex: 1; overflow-y: auto`

So `.editor-page` gets `height = container height` (or `min-height: 1056px`, whichever is larger). ProseMirror content that exceeds this overflows visually, but the white background doesn't follow.

## Proposed Fix

Add `align-items: flex-start` to `.editor-page-container` in [Editor.css:9](src/components/Editor.css#L9). This stops the flex stretch behavior and lets `.editor-page` size based on its content (with `min-height: 1056px` as the floor).

```css
/* src/components/Editor.css */
.editor-page-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;   /* ADD THIS LINE */
    overflow-y: auto;
    padding: 3rem 4rem;
    position: relative;
}
```

Scrolling continues to work because `.editor-page-container` has `overflow-y: auto` — when the now-content-sized `.editor-page` exceeds the container, the scrollbar appears on the container as before.

## Acceptance Criteria

- [x] White page background extends to cover the entire document, regardless of length
- [x] Scrollbar still appears on the editor container for long documents
- [x] Short documents (shorter than viewport) still display correctly with `min-height: 1056px`
- [x] Comments track positioning is unaffected
- [x] Responsive media queries still work at all breakpoints (1400px, 1200px, 1150px)

## Context

- **File to change**: [src/components/Editor.css](src/components/Editor.css) (line ~9, `.editor-page-container` rule)
- **One-line fix**: Add `align-items: flex-start;`
