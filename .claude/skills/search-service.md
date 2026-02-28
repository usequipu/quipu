---
name: search-service
description: Pattern for using and extending the full-text search and file listing services
triggers:
  - search functionality
  - file search
  - text search
  - grep
  - ripgrep
  - quick open
  - Ctrl+P
  - searchService
  - SearchPanel
  - QuickOpen
---

# Search Service Pattern

Use this skill when working with or extending the search functionality in Quipu.

## Service API

`src/services/searchService.js` follows the [dual-runtime-service](dual-runtime-service.md) adapter pattern.

```javascript
import searchService from '../services/searchService';

// Full-text search
const { results, truncated } = await searchService.search(dirPath, query, {
    regex: false,
    caseSensitive: false,
});
// results: [{ file: 'relative/path.js', line: 42, text: 'matched line content' }]
// truncated: true if > 500 results

// Recursive file listing
const { files, truncated } = await searchService.listFilesRecursive(dirPath, 5000);
// files: [{ path: 'relative/path.js', name: 'filename.js' }]
```

## Backend Endpoints

### Go Server (`server/main.go`)

| Endpoint | Method | Params | Returns |
|---|---|---|---|
| `/search` | GET | `path`, `q`, `regex`, `caseSensitive` | `{ results: [{file, line, text}], truncated }` |
| `/files-recursive` | GET | `path`, `limit` | `{ files: [{path, name}], truncated }` |

- Search uses ripgrep (`rg`) with grep fallback
- Max 500 results for search, 5000 for file listing
- Excludes: `node_modules`, `.git`, `build`, `dist`, hidden files

### Electron IPC (`electron/main.cjs`)

| Channel | Args | Returns |
|---|---|---|
| `search-files` | `(dirPath, query, options)` | `{ results, truncated }` |
| `list-files-recursive` | `(dirPath, limit)` | `{ files, truncated }` |

## UI Components

### SearchPanel (`src/components/SearchPanel.jsx`)

Side panel component. Features:
- Debounced search input (300ms)
- Case-sensitive toggle (Aa button)
- Regex toggle (.* button)
- Results grouped by file
- Click result to open file via `openFile()`
- Truncation warning when > 500 results

### QuickOpen (`src/components/QuickOpen.jsx`)

Modal overlay triggered by Ctrl+P. Features:
- Fetches file list on open via `listFilesRecursive()`
- Fuzzy filename matching (simple `includes()`)
- Keyboard navigation (arrows + Enter + Escape)
- Opens file via `openFile()` on selection

## Extending Search

To add new search capabilities (e.g., find-and-replace):

1. Add backend endpoint (Go server + Electron IPC) following [dual-runtime-service](dual-runtime-service.md)
2. Add method to `searchService.js` (both electron and browser implementations)
3. Add UI in SearchPanel.jsx
4. Use `exec.Command` with argument arrays for any shell commands
