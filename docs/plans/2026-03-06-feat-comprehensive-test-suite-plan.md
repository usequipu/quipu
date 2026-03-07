---
title: "Comprehensive Test Suite for Quipu Simple"
type: feat
status: active
date: 2026-03-06
---

# Comprehensive Test Suite for Quipu Simple

## Overview

Set up testing infrastructure and write tests for all major components and utilities, with focus on the three recently shipped features: Excalidraw viewer, explorer file creation/spacing, and terminal WebSocket reconnection.

## Phase 1: Testing Infrastructure Setup

### Install Dependencies

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

### Configuration

**`vitest.config.js`** — Extend existing vite.config.js:
```javascript
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
}));
```

**`src/test/setup.js`** — Global test setup:
- Import `@testing-library/jest-dom`
- Mock `window.electronAPI` as undefined (browser mode by default)
- Mock `localStorage`
- Mock `crypto.randomUUID`

**`package.json`** — Add scripts:
```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

## Phase 2: Unit Tests

### 2.1 `src/utils/fileTypes.test.js`

Test all utility functions:
- `getFileExtension()` — standard extensions, no extension, multiple dots
- `isCodeFile()` — all CODE_EXTENSIONS, negative cases
- `isMediaFile()` — all MEDIA_EXTENSIONS, negative cases
- `isExcalidrawFile()` — `.excalidraw`, negative cases, case sensitivity
- `getLanguage()` — known mappings, unknown extensions
- `getViewerType()` — all routing paths: diff, media, quipu, excalidraw, markdown, code, default editor

### 2.2 `src/context/WorkspaceContext.test.jsx`

Test context functions (mock fileSystem service):
- `createNewFile` — calls `fs.createFile`, increments `directoryVersion`, calls `refreshDirectory`
- `createNewFolder` — calls `fs.createFolder`, increments `directoryVersion`, calls `refreshDirectory`
- `deleteEntry` — increments `directoryVersion`, closes open tab if deleted
- `renameEntry` — increments `directoryVersion`, updates tab path/name
- `updateTabContent` — stores content on tab
- `saveFile` without editorInstance — writes tab.content directly (excalidraw path)
- `saveFile` with editorInstance — TipTap serialization paths (quipu, markdown, text)

### 2.3 `src/components/ExcalidrawViewer.test.jsx`

Mock `@excalidraw/excalidraw`:
- Renders without crashing with valid JSON content
- Parses initial data correctly (elements, appState, files)
- Handles invalid JSON gracefully (empty canvas)
- Calls `onContentChange` with serialized JSON on change
- Skips first onChange (initialization)

### 2.4 `src/components/FileExplorer.test.jsx`

Mock WorkspaceContext:
- File items render with 14px invisible spacer
- Folder items render with caret icon (no spacer)
- `handleCreateSubmit` awaits async operations before resetting state
- Directory children re-fetch when `directoryVersion` changes
- Inline create input appears at correct depth

### 2.5 `src/components/Terminal.test.jsx`

Mock WebSocket and xterm.js:
- Browser mode: creates WebSocket with correct URL
- Reconnection: retries up to 5 times on close
- Reconnection: shows yellow messages during retry
- Reconnection: shows red message after max retries
- `stopReconnect()` prevents further reconnection attempts
- Intentional close (tab close) doesn't trigger reconnection
- Electron mode: uses IPC instead of WebSocket

## Phase 3: Integration-style Tests

### 3.1 `src/App.test.jsx`

- Renders ExcalidrawViewer for `.excalidraw` files
- Renders CodeViewer for code files
- Renders MediaViewer for media files
- Renders Editor for markdown files
- Ctrl+S saves excalidraw files (no editorInstance needed)

## Files to Create

- `vitest.config.js`
- `src/test/setup.js`
- `src/utils/fileTypes.test.js`
- `src/context/WorkspaceContext.test.jsx`
- `src/components/ExcalidrawViewer.test.jsx`
- `src/components/FileExplorer.test.jsx`
- `src/components/Terminal.test.jsx`
- `src/App.test.jsx`

## Files to Modify

- `package.json` — add test dependencies and scripts

## Verification

```bash
npm test          # Run all tests in watch mode
npm run test:run  # Run all tests once (CI mode)
```

All tests should pass. Focus on the three new features but also cover the foundational utilities.
