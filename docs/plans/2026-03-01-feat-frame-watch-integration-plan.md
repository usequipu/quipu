---
title: "feat: FRAME Watch — Auto-Update Editor on External Changes"
type: feat
status: active
date: 2026-03-01
---

# FRAME Watch — Auto-Update Editor on External Changes

## Overview

When Claude Code (or any external tool) edits a FRAME sidecar file (`.quipu/meta/*.frame.json`), the Quipu editor should automatically detect the change and update the displayed annotations without requiring a manual reload.

## Problem Statement

Currently, FRAME annotations are only loaded when a tab is opened or switched to. If Claude Code modifies the FRAME file while the user has the corresponding file open, the editor shows stale annotations until the user closes and reopens the tab. The user described this as: "Claude isn't editing FRAME properly and Quipu should be notified of changes."

## Proposed Solution

Implement file watching on the `.quipu/meta/` directory to detect FRAME file changes and propagate updates to the editor.

### Dual-Runtime Watchers

**Electron (`electron/main.cjs`):**
- Use `fs.watch()` or `chokidar` on `${workspacePath}/.quipu/meta/` directory
- IPC event: `frame-changed` with `{ filePath }` (the source file path, not the .frame.json path)
- Debounce: 500ms to avoid rapid-fire events from write-then-rename patterns

**Go server (`server/main.go`):**
- Use `fsnotify` package to watch `.quipu/meta/` directory
- WebSocket event or new endpoint: `GET /frame/watch?path=...` (SSE or WebSocket)
- Alternative: Polling approach — the browser client polls `GET /frame/modified?path=...&since=<timestamp>` every 5 seconds

**Service adapter (`src/services/frameService.js`):**
- Add `watchFrame(workspacePath, filePath, callback)` and `unwatchFrame(workspacePath, filePath)` methods
- Electron: IPC listener for `frame-changed`
- Browser: SSE/WebSocket connection or polling interval

### Editor Integration

When a FRAME change is detected for the currently active file:
1. Re-read the FRAME file via `frameService.readFrame()`
2. Extract new/changed annotations
3. Update comment marks in the TipTap editor (add new ones, remove deleted ones)
4. Show a subtle toast: "Annotations updated" (info type)

Avoid a full editor reload — only update the comment marks incrementally.

### Preload Bridge

```javascript
// electron/preload.cjs
watchFrameChanges: (callback) => {
  ipcRenderer.on('frame-changed', (event, data) => callback(data));
},
unwatchFrameChanges: () => {
  ipcRenderer.removeAllListeners('frame-changed');
}
```

## Technical Considerations

- **File lock contention**: If the editor is writing to the FRAME file at the same time Claude Code is, the watcher may fire for our own writes. Filter out self-triggered changes by comparing timestamps or using a "writing" flag.
- **Debouncing**: Many editors write files by creating a temp file and renaming. This triggers multiple fs events. Debounce at 500ms.
- **Memory cleanup**: Unwatch when workspace changes or tab closes. Add to the existing cleanup in `useEffect` return functions.
- **Electron**: `fs.watch` is available but unreliable on some platforms. Consider `chokidar` (already common in Electron apps) for robustness.
- **Browser polling fallback**: If WebSocket/SSE is too complex, a simple 5-second poll of the FRAME file's `mtime` is acceptable for v1.

## Acceptance Criteria

- [ ] When an external tool modifies a FRAME file, the editor updates annotations within 2 seconds
- [ ] Self-triggered writes (from the editor itself) do not cause redundant reloads
- [ ] File watcher is cleaned up on workspace change and tab close
- [ ] Works in Electron runtime (fs.watch or chokidar)
- [ ] Works in browser runtime (polling or WebSocket)
- [ ] Toast notification shown when annotations are externally updated
- [ ] No full editor reload — only comment marks are updated incrementally

## MVP

### src/services/frameService.js (watch methods)

```javascript
// Electron
const electronWatch = {
  watch: (workspacePath, filePath, callback) => {
    window.electronAPI.watchFrameChanges((data) => {
      if (data.filePath === filePath) callback(data);
    });
  },
  unwatch: () => {
    window.electronAPI.unwatchFrameChanges();
  }
};

// Browser (polling fallback)
const browserWatch = {
  watch: (workspacePath, filePath, callback) => {
    const metaPath = `.quipu/meta/${filePath}.frame.json`;
    let lastMtime = null;
    const interval = setInterval(async () => {
      const resp = await fetch(`${SERVER_URL}/file/stat?path=${encodeURIComponent(metaPath)}`);
      const { mtime } = await resp.json();
      if (lastMtime && mtime !== lastMtime) {
        callback({ filePath });
      }
      lastMtime = mtime;
    }, 5000);
    return interval;
  },
  unwatch: (intervalId) => {
    clearInterval(intervalId);
  }
};
```

## Sources

- FRAME service: [src/services/frameService.js](src/services/frameService.js)
- Editor FRAME loading: [src/components/Editor.jsx](src/components/Editor.jsx) (lines 253-316)
- Electron main: [electron/main.cjs](electron/main.cjs)
- Preload bridge: [electron/preload.cjs](electron/preload.cjs)
- Solution doc: [docs/solutions/integration-issues/frame-system-multi-component-sync.md](docs/solutions/integration-issues/frame-system-multi-component-sync.md)
- Existing plan: [docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md](docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md)
