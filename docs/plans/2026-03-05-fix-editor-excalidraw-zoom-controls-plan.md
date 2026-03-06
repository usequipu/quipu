---
title: "Fix Excalidraw File Handling and Move Zoom Controls to Toolbar"
type: fix
status: active
date: 2026-03-05
---

# Fix Excalidraw File Handling and Move Zoom Controls to Toolbar

## Overview

Two editor-related bugs:
1. `.excalidraw` files are opened as markdown/rich-text instead of being rendered properly
2. Zoom controls (magnifying lenses) are floating at the bottom of the document instead of being in the rich text toolbar

## Bug 1: Excalidraw Files Opened as Markdown

### Problem

The file type routing in `src/utils/fileTypes.js` has no awareness of `.excalidraw` files. The `getViewerType()` function falls through to the default `'editor'` case (line 51), which opens the file in the TipTap rich text editor. Since `.excalidraw` files are JSON, TipTap tries to render them as markdown text.

### Root Cause

- `.excalidraw` is not in `CODE_EXTENSIONS`, `MEDIA_EXTENSIONS`, or any detection logic
- No `ExcalidrawViewer` component exists
- No `isExcalidraw` flag exists in the tab data structure

### Proposed Solution

Add Excalidraw rendering support using the `@excalidraw/excalidraw` React component:

1. **`package.json`** — Install `@excalidraw/excalidraw`
2. **`src/utils/fileTypes.js`** — Add `.excalidraw` detection:
   - Add `isExcalidrawFile(fileName)` function checking for `.excalidraw` extension
   - Update `getViewerType()` to return `'excalidraw'` for excalidraw files
3. **`src/components/ExcalidrawViewer.jsx`** — New component:
   - Parse file content as JSON
   - Render `<Excalidraw>` component with parsed data
   - Handle save by serializing back to JSON
   - Dark theme support matching the app theme
4. **`src/context/WorkspaceContext.jsx`** — Add `isExcalidraw` flag to tab data (around line 416):
   - Detect `.excalidraw` extension during `openFile()`
   - Store raw JSON content (no markdown/frontmatter parsing)
5. **`src/App.jsx`** — Add viewer routing (around line 661):
   - Add condition for `isExcalidrawFile(activeFile.name)` before the default Editor fallback

### Files to Modify

- `package.json` — add `@excalidraw/excalidraw` dependency
- `src/utils/fileTypes.js` — add excalidraw detection
- `src/components/ExcalidrawViewer.jsx` — **new file**
- `src/context/WorkspaceContext.jsx` — add `isExcalidraw` tab flag
- `src/App.jsx` — add routing to ExcalidrawViewer

## Bug 2: Zoom Controls Should Be in the Rich Text Toolbar

### Problem

Zoom controls are rendered as a sticky floating element at the bottom center of the editor (`Editor.jsx` lines 1020-1049). The user expects them to be in the rich text toolbar at the top.

### Current Location

```jsx
{/* Zoom Controls - currently sticky bottom-center */}
<div className="sticky bottom-4 left-0 right-0 flex justify-center pointer-events-none z-10">
```

### Proposed Solution

Move the zoom controls into the toolbar row (`Editor.jsx` line 728), placing them after the table button and before the `<div className="flex-1" />` spacer, or after the spacer alongside the "Rich Text" mode toggle. The most natural position is at the **right side of the toolbar**, grouped with the mode toggle:

1. **`src/components/Editor.jsx`**:
   - Remove the sticky bottom zoom controls block (lines 1020-1049)
   - Add zoom controls to the toolbar (after line 826, before the flex-1 spacer or after it):
     - `MagnifyingGlassMinusIcon` button
     - Zoom percentage label
     - `MagnifyingGlassPlusIcon` button
   - Use same `ToolbarButton` component for consistency
   - Ensure zoom controls also appear in `obsidian` mode toolbar

### Files to Modify

- `src/components/Editor.jsx` — move zoom controls from bottom to toolbar

## Acceptance Criteria

- [ ] `.excalidraw` files render in an interactive Excalidraw canvas, not as text
- [ ] Excalidraw changes can be saved back to the file
- [ ] Zoom controls appear in the rich text toolbar, not floating at the bottom
- [ ] Zoom controls also appear in obsidian mode toolbar
- [ ] Zoom persists in localStorage as before
