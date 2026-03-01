# Plan: Image and Video Viewer

## Context
There is no support for viewing images (jpeg, png, gif, svg, webp) or videos (mp4, webm) when opened from the file explorer. They need dedicated viewer components.

## Files to Create
- `src/components/MediaViewer.jsx`

## Files to Modify
- `src/services/fileSystem.js` - Add `getFileUrl` method
- `src/context/WorkspaceContext.jsx` - Skip readFile for media, add `isMedia` flag
- `src/App.jsx` - Conditional rendering for media files
- `server/main.go` - MIME type detection for binary files

## Implementation

### src/services/fileSystem.js - Add getFileUrl

Add to `browserFS`:
```javascript
getFileUrl: (filePath) => `${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`,
```

Add to `electronFS`:
```javascript
getFileUrl: (filePath) => `file://${filePath}`,
```

### src/context/WorkspaceContext.jsx - Skip readFile for media

In `openFile`, detect media files and skip the content read:
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

### src/components/MediaViewer.jsx

```jsx
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
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

### src/App.jsx - Conditional Rendering

Import and use:
```jsx
import MediaViewer from './components/MediaViewer';
import { isMediaFile } from './utils/fileTypes';

// In render:
{activeFile ? (
  activeTab?.isMedia ? (
    <MediaViewer filePath={activeTab.path} fileName={activeFile.name} />
  ) : isCodeFile(activeFile.name) && !activeFile.isQuipu ? (
    <CodeViewer content={activeFile.content} fileName={activeFile.name} />
  ) : (
    <Editor ... />
  )
) : (...empty state...)}
```

### server/main.go - MIME Type Detection

In `handleReadFile`, add MIME type detection before writing the response:
```go
import "mime"

// Before writing response bytes:
ext := filepath.Ext(absPath)
mimeType := mime.TypeByExtension(ext)
if mimeType != "" {
    w.Header().Set("Content-Type", mimeType)
} else {
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
}
```

## Verification
- Open a `.png` or `.jpg` file from file explorer - image displays centered
- Open an `.svg` file - renders in the viewer
- Open a `.mp4` or `.webm` file - video player with controls
- Image/video should be centered and properly sized within the editor area
- No errors in console when opening binary files
