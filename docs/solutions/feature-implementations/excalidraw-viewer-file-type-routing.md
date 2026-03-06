---
title: "Excalidraw Files Opening as Markdown Instead of Visual Editor"
date: 2026-03-05
category: feature-implementations
tags: [file-viewer, excalidraw, routing, file-types]
severity: high
component: App.jsx, ExcalidrawViewer.jsx, fileTypes.js, WorkspaceContext.jsx
root_cause: "Missing .excalidraw file handler; files fell through to default TipTap editor"
related_prs: ["#35"]
---

# Excalidraw Files Opening as Markdown Instead of Visual Editor

## Symptom

Opening a `.excalidraw` file displayed raw JSON text in the TipTap rich text editor instead of an interactive Excalidraw canvas.

## Root Cause

`getViewerType()` in `src/utils/fileTypes.js` had no handling for `.excalidraw` files. The routing priority is: diff > media > quipu > markdown > code > media > **default (editor)**. Since `.excalidraw` wasn't in any set, it fell to the TipTap editor.

## Solution

### 1. File type detection (`src/utils/fileTypes.js`)

```javascript
export function isExcalidrawFile(fileName) {
  return fileName.endsWith('.excalidraw');
}
```

Added `isExcalidrawFile` check in `getViewerType()` before the code file check.

### 2. ExcalidrawViewer component (`src/components/ExcalidrawViewer.jsx`)

New component using `@excalidraw/excalidraw`:
- Parses JSON content on mount via `useRef` (avoids re-parsing on every render)
- `onChange` calls `onContentChange(serializedJSON)` to update tab content
- Skips first onChange (initial render) via `isInitializedRef`
- Dark theme enabled

### 3. Viewer routing (`src/App.jsx`)

Added `isExcalidrawFile(activeFile.name)` check before `isCodeFile` in the rendering conditional.

### 4. Non-TipTap save path (`src/context/WorkspaceContext.jsx`)

- Added `updateTabContent(tabId, content)` — stores content directly on tab for non-TipTap editors
- Modified `saveFile()` to handle `!editorInstance` case — writes `activeTab.content` directly
- Modified Ctrl+S handler and menu action to not require `editorInstance`

## Pattern: Adding a New Viewer Type

1. Add detection function in `src/utils/fileTypes.js`
2. Update `getViewerType()` with the new return value
3. Create viewer component in `src/components/`
4. Add routing in `src/App.jsx` render conditional (order matters)
5. If the viewer modifies content, use `updateTabContent` + `onContentChange(stringContent)`

## Related

- [Syntax Highlighted Code Viewer](../feature-implementations/syntax-highlighted-code-viewer-component.md)
- [Media Viewer Image Video Support](../feature-implementations/media-viewer-image-video-support.md)
