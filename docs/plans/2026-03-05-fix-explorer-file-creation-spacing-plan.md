---
title: "Fix File Creation Not Updating Explorer and Tree Spacing Inconsistency"
type: fix
status: active
date: 2026-03-05
---

# Fix File Creation Not Updating Explorer and Tree Spacing Inconsistency

## Overview

Two file explorer bugs:
1. Creating a new file doesn't update the explorer tree (or the creation itself fails silently)
2. The indentation distance between a parent folder and child folder differs from parent folder and child file

## Bug 1: File Creation Does Not Work / Explorer Doesn't Update

### Problem

When creating a new file via the explorer's inline input, either:
- The file is not actually created on disk, OR
- The file is created but `refreshDirectory()` doesn't re-render the tree

### Current Flow

1. User types filename in inline input (`FileExplorer.jsx` line 248-263)
2. `handleCreateSubmit` calls `createNewFile(parentPath, name)` or `createNewFolder(parentPath, name)`
3. `WorkspaceContext.jsx` lines 569-589:
   ```javascript
   await fs.createFile(filePath);
   if (workspacePath) await refreshDirectory(workspacePath);
   ```
4. `refreshDirectory` (line 220-229) calls `fs.readDirectory(dirPath)` → `setFileTree(entries)`

### Likely Root Causes to Investigate

1. **Path construction**: `parentPath + '/' + name` may produce incorrect paths (double slashes, wrong parent)
2. **`refreshDirectory` scope**: It re-reads the workspace root, but the tree expansion state may not include the new file's parent — the parent folder might be collapsed or the children might not be re-fetched
3. **Error swallowing**: The `catch` block might fire silently if toast isn't visible
4. **Race condition**: `setIsCreating(null)` in FileExplorer may reset state before the async creation completes
5. **Browser mode**: The Go server endpoint `POST /file` may return an error that's not propagated

### Proposed Investigation & Fix

1. **`src/components/FileExplorer.jsx`** — Check `handleCreateSubmit`:
   - Verify it `await`s the creation properly
   - Ensure the parent folder remains expanded after creation
   - Check that the input blur handler doesn't trigger duplicate submissions
2. **`src/context/WorkspaceContext.jsx`** — Check `createNewFile` / `createNewFolder`:
   - Add error logging if `fs.createFile` fails
   - Verify `refreshDirectory` is called and completes
   - Consider expanding the parent folder after creation
3. **`src/services/fileSystem.js`** — Verify `createFile` in browser mode:
   - Check the Go server response handling
   - Ensure path is correctly constructed
4. **`server/main.go`** — Verify `POST /file` endpoint:
   - Check file creation logic and response codes

### Files to Modify

- `src/components/FileExplorer.jsx` — fix submission flow, ensure parent stays expanded
- `src/context/WorkspaceContext.jsx` — fix createNewFile/createNewFolder, auto-expand parent
- `src/services/fileSystem.js` — verify and fix browser mode file creation
- `server/main.go` — verify POST /file endpoint (if needed)

## Bug 2: Inconsistent Tree Indentation Between Folders and Files

### Problem

The visual distance between a parent folder and a child folder appears different from the distance between a parent folder and a child file, even though the code uses the same padding formula.

### Current Indentation

All items use the same formula (`FileExplorer.jsx` line 210):
```javascript
style={{ paddingLeft: `${12 + depth * 16}px` }}
```

### Root Cause

The **visual** difference comes from the caret icon. Folders have a `CaretDownIcon` / `CaretRightIcon` (14px) before the folder icon, while files go straight to the file icon. This means:

- **Folder child**: `[padding] [Caret 14px] [gap-1] [FolderIcon] [gap-1] [name]`
- **File child**: `[padding] [FileIcon] [gap-1] [name]`

The caret pushes folder names ~18px further right than file names at the same depth level. This creates visual misalignment — files appear closer to the parent than sibling folders.

### Proposed Solution

Add an invisible spacer for files to match the caret width:

```jsx
{!entry.isDirectory && (
  <span className="shrink-0 w-[14px]" /> {/* Match caret width */}
)}
```

This goes in `FileExplorer.jsx` around line 214, right after the `isDirectory` caret block. Files at the same depth will then align with folder names.

### Files to Modify

- `src/components/FileExplorer.jsx` — add invisible spacer for file items

## Acceptance Criteria

- [ ] New files created via explorer appear in the tree immediately
- [ ] New folders created via explorer appear in the tree immediately
- [ ] File names and folder names at the same depth are visually aligned
- [ ] The caret icon for folders doesn't cause misalignment with sibling files
- [ ] Works in both Electron and browser modes
