---
title: Media Viewer Implementation for Image and Video Files
date: 2026-03-01
tags: [media-support, file-handling, ui-feature, electron, browser-compatibility, dual-runtime, binary-files]
problem_type: feature-implementation
component: FileExplorer, WorkspaceContext, MediaViewer, fileSystem service, Go server
symptoms:
  - Image and video files opened from the explorer show binary garbage or fail to render
  - No dedicated viewer for media file types (jpg, png, gif, svg, mp4, webm, etc.)
  - Media files lack proper MIME type detection in Go server responses
  - TipTap editor crashes or hangs when passed binary file content
related:
  - docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md
  - docs/solutions/feature-implementations/inline-git-diff-viewer-source-control.md
  - docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md
---

## Problem Statement

When users opened image or video files from the file explorer, the application attempted to read them as text and pass the content to the TipTap editor. TipTap expects string or JSON content and would crash, hang on large video files, or render unprintable binary characters. There was no media detection guard in `openFile` and no alternate rendering path for binary file types.

## Root Cause

The `openFile` function in `WorkspaceContext.jsx` unconditionally called `fs.readFile()` on every file, then passed the result to the TipTap editor. All files followed the same code path regardless of type. There was no distinction between text-based files (code, markdown, JSON) and binary files (images, video).

Additionally, the Go server's `handleReadFile` always responded with `Content-Type: text/plain`, so even if a browser tried to display a media file directly, it wouldn't know to treat it as an image or video.

## Solution

### 1. Add `getFileUrl` to fileSystem service

Both runtimes need a way to provide a URL the browser can use in `<img>` and `<video>` tags directly — without loading the bytes into JavaScript memory.

```javascript
// src/services/fileSystem.js

// electronFS
getFileUrl: (filePath) => `file://${filePath}`,

// browserFS
getFileUrl: (filePath) => `${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`,
```

### 2. Detect media files in `openFile` and skip `readFile`

Insert a guard before `fs.readFile()` in `WorkspaceContext.jsx`:

```javascript
const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);
if (isMedia) {
  const newTab = {
    id: crypto.randomUUID(),
    path: filePath,
    name: fileName,
    content: null,
    tiptapJSON: null,
    isDirty: false,
    isQuipu: false,
    isMarkdown: false,
    isMedia: true,
    scrollPosition: 0,
    frontmatter: null,
    frontmatterRaw: null,
    frontmatterCollapsed: false,
  };
  setOpenTabs(prev => [...prev, newTab]);
  setActiveTabId(newTab.id);
  return;
}
```

### 3. Create `MediaViewer` component

```jsx
// src/components/MediaViewer.jsx
import React, { useMemo } from 'react';
import fs from '../services/fileSystem';

const MediaViewer = ({ filePath, fileName }) => {
  const url = useMemo(() => fs.getFileUrl(filePath), [filePath]);
  const isImage = /\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(fileName);
  const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(fileName);

  return (
    <div className="flex-1 flex items-center justify-center overflow-auto bg-bg-surface p-8">
      {isImage && (
        <img
          src={url}
          alt={fileName}
          className="max-w-full max-h-full object-contain rounded shadow-md"
        />
      )}
      {isVideo && (
        <video
          src={url}
          controls
          className="max-w-full max-h-[80vh] rounded shadow-md"
        />
      )}
    </div>
  );
};

export default MediaViewer;
```

### 4. Route to `MediaViewer` in `App.jsx`

```jsx
import MediaViewer from './components/MediaViewer';

// In render, replace the bare Editor with:
{activeFile ? (
  activeTab?.isMedia ? (
    <MediaViewer filePath={activeTab.path} fileName={activeTab.name} />
  ) : (
    <Editor ... />
  )
) : (
  /* empty state */
)}
```

### 5. Add MIME type detection in Go server

```go
// server/main.go — add "mime" to imports

// In handleReadFile, replace the static Content-Type header:
ext := filepath.Ext(absPath)
mimeType := mime.TypeByExtension(ext)
if mimeType != "" {
    w.Header().Set("Content-Type", mimeType)
} else {
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
}
w.Write(content)
```

## Key Design Decisions

**`getFileUrl` in the service adapter, not the component.** The URL format differs between runtimes — `file://` for Electron, HTTP for browser. Putting it in the service adapter means `MediaViewer` stays runtime-agnostic and the abstraction is maintained consistently alongside `readFile`, `writeFile`, etc.

**`isMedia` flag on the tab object, not in component state.** Tab metadata must travel with the file when switching tabs. Storing `isMedia` on the tab keeps the data model self-contained: when `activeTab` changes, the rendering decision flows automatically through props without any synchronization code.

**Extension regex as primary guard, MIME as secondary.** MIME type alone cannot be trusted for rendering decisions on the client — the Go server sets it, but the client processes the decision before any network response. Extension regex in `openFile` is the authoritative early gate; MIME headers let the browser natively decode the resource.

## Extending to New File Types

Follow this checklist when adding support for more binary file types (PDF, audio, etc.):

- [ ] Create a new viewer component (e.g., `src/components/PDFViewer.jsx`)
- [ ] Use `fs.getFileUrl(filePath)` — never construct URLs manually
- [ ] Add extension detection in `WorkspaceContext.openFile()` before `fs.readFile()`
- [ ] Add a flag to the tab object (`isPDF`, `isAudio`, etc.)
- [ ] Add a conditional branch in `App.jsx` to route to the new component
- [ ] If the extension isn't covered by Go's `mime.TypeByExtension`, add a custom mapping in `handleReadFile`
- [ ] Test in both Electron (`npm run start`) and browser (`npm run dev` + Go server)
- [ ] Verify the file never loads into JavaScript memory (check DevTools Memory tab for large files)

## Common Pitfalls

**Missing MIME types on Go server (browser mode).** Without `Content-Type`, the browser treats binary data as `application/octet-stream` and `<img>` tags show broken icons. Diagnose by checking the Network tab in DevTools — `Content-Type` must match the actual media type.

**Case-insensitive regex.** Use the `/i` flag. Files named `Photo.JPG` or `Clip.MOV` will fall through to the editor without it.

**Hardcoded URLs instead of `fs.getFileUrl()`.** Hardcoding `http://localhost:3000/...` breaks Electron; hardcoding `file://` breaks browser mode. Always use the service adapter method.

**Updating only one runtime.** The dual-runtime rule requires changes in 4 places for every backend feature: Go server, Electron IPC handler, preload bridge, service adapter. Skipping any layer causes one runtime to silently fail.

**Passing content instead of URL to viewer.** Editor components take file *content* (text in memory). Media viewers take a *URL* (browser fetches on demand). Never pass `readFile` output to a media viewer — it defeats the purpose and will load large video files into memory.
