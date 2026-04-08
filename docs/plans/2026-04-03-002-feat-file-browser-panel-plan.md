---
title: "feat: Add full file browser panel with grid/list views"
type: feat
status: active
date: 2026-04-03
deepened: 2026-04-03
---

# feat: Add Full File Browser Panel with Grid/List Views

## Overview

Add a new "File Browser" sidebar context (alongside Explorer, Search, Source Control) that provides a full file manager experience with grid and list view modes, breadcrumb navigation, multi-select, and drag-and-drop. The browser starts at the workspace parent directory and can navigate freely without changing the workspace. Clicking a Quipu-openable file opens it in the editor tabs; other files open with the system default application.

## Problem Frame

The current Explorer sidebar is workspace-scoped and tree-only. Users need a way to browse the filesystem more broadly — navigate parent directories, see files as icons in a grid (like a native file manager), and open or move files between locations. This bridges the gap between Quipu as an editor and a file management tool.

## Requirements Trace

- R1. New Activity Bar icon that opens a "File Browser" panel in the existing sidebar slot
- R2. Grid view mode: files/folders displayed as icon cards with name labels (Nautilus/Files style)
- R3. List view mode: files/folders displayed as rows with name, size, and modified date
- R4. View mode toggle (grid/list) persisted in the panel header
- R5. Breadcrumb navigation bar with back button; navigating does NOT change the workspace root
- R6. The browser defaults to the workspace parent directory on open
- R7. Clicking a Quipu-openable file (md, code, media, pdf, excalidraw, mermaid, quipu) opens it in the editor via `openFile()` and switches to the Explorer panel
- R8. Clicking a non-Quipu-openable file opens it with the system default application (`shell.openPath` in Electron, download/no-op in browser)
- R9. Multi-select: Ctrl+click to toggle individual items, Shift+click for range selection
- R10. Drag-and-drop: move files/folders within the browser, and drag files into the workspace explorer
- R11. Right-click context menu with standard file operations (open, rename, delete, copy path, new file/folder)
- R12. Respects the existing hidden directory blocklist pattern (no blanket dotfile filtering)

## Scope Boundaries

- No thumbnail previews for images (use file-type icons only — thumbnails can be added later)
- No file copy/paste between directories (move via drag-and-drop only for now)
- No column sorting in list view (alphabetical directories-first, matching existing pattern)
- No file size/date display in grid view (list view only)
- No workspace switching from the browser — navigation is independent of workspace

## Context & Research

### Relevant Code and Patterns

- `src/components/ActivityBar.jsx` — `PANELS` array defines sidebar contexts; adding a new entry is the standard pattern
- `src/App.jsx` lines 670-683 — conditional render of panel content based on `activePanel` state; `handlePanelToggle` handles expand/collapse/switch generically
- `src/components/FileExplorer.jsx` — existing file tree with HTML5 drag-and-drop, context menus, inline rename. `FileTreeItem` is recursive with lazy loading via `loadSubDirectory()`
- `src/services/fileSystem.js` — dual-runtime adapter with `readDirectory()`, `readFile()`, `renamePath()`, `deletePath()`, `getFileUrl()`, `getHomeDir()`
- `src/utils/fileTypes.js` — `isCodeFile()`, `isMediaFile()`, `isPdfFile()`, `isExcalidrawFile()`, `isMermaidFile()` for determining openability
- `src/context/WorkspaceContext.jsx` — `openFile()` handles tab creation with type detection; `directoryVersion` counter triggers refresh on mutations
- `src/components/ContextMenu.jsx` — reusable context menu component with `{ items, position, onClose }` shape

### Institutional Learnings

- **Hidden file filtering**: Must use the targeted `HIDDEN_DIRS` blocklist, never blanket `.startsWith('.')`. Filtering exists in 4 places (Go readdir, Go recursive, Electron readdir, Electron recursive) — see `docs/solutions/ui-bugs/hidden-dotfiles-filtered-from-explorer.md`
- **Directory refresh**: Use `directoryVersion` counter from WorkspaceContext in `useEffect` deps — see `docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md`
- **Resizable panels**: The sidebar is a single `<Panel>` container; contents are swapped by `activePanel` — see `docs/solutions/integration-issues/resizable-panels-library-integration.md`
- **Drag-and-drop visuals**: 2px accent drop indicator, 0.5 opacity ghost, `bg-accent/20` for drop targets — established in FileExplorer.jsx

## Key Technical Decisions

- **Reuse sidebar slot**: The file browser renders inside the same collapsible `<Panel>` as Explorer/Search/Git, controlled by `activePanel`. No new panel container needed.
- **Independent navigation state**: The browser's current directory is component-local state, not stored in WorkspaceContext. It does not affect `workspacePath` or `fileTree`.
- **Multi-select is component-local**: Selection state (`Set<string>` of selected paths + last-clicked index for shift-select) stays in `FileBrowser`. Only lifted to context if other components need it later.
- **System open via new IPC**: Need to add `shell.openPath` exposure for Electron and a Go endpoint for browser mode to open files with OS default application.
- **File metadata in readDirectory**: The current `readDirectory` returns `{ name, path, isDirectory }`. Grid view needs only this. List view additionally needs `size` and `modifiedTime`. Use a `?metadata=true` query parameter on the Go `/files` endpoint (and equivalent boolean flag on the Electron IPC call) so only the FileBrowser pays the `os.Stat()`-per-entry cost. Existing FileExplorer callers are unaffected.
- **Go server sandbox relaxation for browsing**: The Go server's `isWithinWorkspace()` blocks paths outside the workspace root when `workspaceExplicit` is true. The FileBrowser needs to read directories outside the workspace. Add a new `/browse` endpoint that is exempt from the workspace sandbox but restricted to read-only directory listing (no write/delete/rename). The existing `/files` endpoint remains sandboxed. In Electron mode this is not an issue since `readDirectory` reads any path.
- **Quipu-openable detection**: Centralize in a new `isQuipuOpenable(fileName)` function in `fileTypes.js` that combines all existing type checks (md, code, media, pdf, excalidraw, mermaid, quipu).

## Open Questions

### Resolved During Planning

- **Q: Should the browser share FileExplorer's component or be separate?** Separate component (`FileBrowser.jsx`). The tree view and grid/list views have fundamentally different rendering and state (recursive tree vs. flat directory listing). They share the same sidebar slot via `activePanel` switching.
- **Q: How to handle files outside the workspace?** Use `openFile()` with the full path. The current `openFile` reads any file by absolute path — it works for out-of-workspace files. The tab will show the file but it won't appear in the workspace file tree.
- **Q: What icon for the Activity Bar?** `FolderOpen` from Phosphor Icons — distinct from `FilesIcon` (used by Explorer) and clearly communicates file browsing.

### Deferred to Implementation

- **Q: Exact grid item dimensions and responsive breakpoints?** Determine during implementation based on sidebar width (200-400px). Likely 80-100px wide items.

## Implementation Units

- [ ] **Unit 1: Backend — Browse endpoint, metadata flag, and system open**

  **Goal:** Add a read-only `/browse` endpoint exempt from workspace sandbox for the FileBrowser. Add `?metadata=true` support for file size and modified time. Add a `shell.openPath` equivalent for both runtimes.

  **Requirements:** R3 (list view needs metadata), R5 (navigate outside workspace), R6 (default to workspace parent), R8 (system open for non-Quipu files)

  **Dependencies:** None

  **Files:**
  - Modify: `server/main.go` — add `/browse` endpoint (read-only directory listing, no workspace sandbox); add `?metadata=true` query param support that calls `os.Stat()` per entry; add `/open-file` endpoint that runs `xdg-open` / `open` / `start`
  - Modify: `electron/main.cjs` — add `browse-directory` IPC handler (reads any directory, not workspace-sandboxed); add `?metadata` flag to `read-directory`; add `open-with-system` IPC handler using `shell.openPath()`
  - Modify: `electron/preload.cjs` — expose `browseDirectory`, `openWithSystem` via contextBridge
  - Modify: `src/services/fileSystem.js` — add `browseDirectory(dirPath, { metadata })` and `openWithSystem(filePath)` to the adapter

  **Approach:**
  - **Go `/browse` endpoint**: Same shape as `/files` (`Array<{ name, path, isDirectory, size?, modifiedTime? }>`) but does NOT call `isWithinWorkspace()`. Restricted to read-only listing — no write, delete, or rename operations. Uses the same `HIDDEN_DIRS` blocklist for filtering.
  - **Metadata flag**: When `?metadata=true` is passed, call `os.Stat()` for each entry and include `size` (bytes, number) and `modifiedTime` (ISO 8601 string). Without the flag, these fields are omitted — existing `/files` callers are unaffected.
  - **Go `/open-file` endpoint**: use `exec.Command` with argument array (not string concat) per security conventions — `xdg-open` on Linux, `open` on macOS, `cmd /c start` on Windows. Not sandboxed (the user is explicitly choosing to open a file).
  - **Electron `browse-directory`**: Uses `fs.promises.readdir({ withFileTypes: true })`. When metadata requested, calls `fs.promises.stat()` per entry (N+1 pattern — acceptable for typical directory sizes; revisit if perf issues arise).
  - **Electron `open-with-system`**: `shell.openPath(filePath)` is the built-in API.
  - **Service adapter**: `browseDirectory()` calls `/browse` (browser) or `browse-directory` IPC (Electron). `openWithSystem()` calls `/open-file` or IPC.

  **Patterns to follow:**
  - Existing dual-runtime 4-place pattern from `docs/solutions/feature-implementations/media-viewer-image-video-support.md`
  - Argument array pattern for `exec.Command` per CLAUDE.md security rules
  - `HIDDEN_DIRS` blocklist from `docs/solutions/ui-bugs/hidden-dotfiles-filtered-from-explorer.md`

  **Test scenarios:**
  - Happy path: `browseDirectory("/home/user", { metadata: true })` returns entries with `size` and `modifiedTime` populated for files, `null`/`0` for directories
  - Happy path: `browseDirectory("/home/user")` (no metadata) returns entries without `size`/`modifiedTime` fields
  - Happy path: `browseDirectory` works for paths outside the workspace in both runtimes
  - Happy path: `openWithSystem("/path/to/file.docx")` invokes the correct OS command without error
  - Edge case: `browseDirectory` on a directory with permission-denied files — returns entries it can stat, skips or nullifies metadata for inaccessible ones
  - Edge case: `browseDirectory` applies `HIDDEN_DIRS` blocklist (`.git`, `node_modules` filtered)
  - Error path: `browseDirectory` on a nonexistent directory — returns error, not empty array
  - Error path: `openWithSystem` on a nonexistent file — returns an error, does not crash

  **Verification:**
  - `browseDirectory` works outside workspace in both Electron and browser runtimes
  - Metadata is only fetched when requested
  - `openWithSystem` opens files in the system default application

- [ ] **Unit 2: File type detection — `isQuipuOpenable` helper**

  **Goal:** Add a single function that determines whether Quipu can natively open a given file, consolidating all existing type checks.

  **Requirements:** R7 (route clicks to editor vs system open)

  **Dependencies:** None

  **Files:**
  - Modify: `src/utils/fileTypes.js` — add `isQuipuOpenable(fileName)` export

  **Approach:**
  - Combine: `isCodeFile || isMediaFile || isPdfFile || isExcalidrawFile || isMermaidFile || endsWithMd || endsWithQuipu`
  - Used by FileBrowser to decide click behavior: openable → `openFile()`, not openable → `openWithSystem()`

  **Patterns to follow:**
  - Existing `isCodeFile()`, `isMediaFile()` pattern in `src/utils/fileTypes.js`

  **Test scenarios:**
  - Happy path: `isQuipuOpenable("readme.md")` → true
  - Happy path: `isQuipuOpenable("style.css")` → true (code file)
  - Happy path: `isQuipuOpenable("photo.png")` → true (media)
  - Happy path: `isQuipuOpenable("doc.pdf")` → true
  - Happy path: `isQuipuOpenable("report.docx")` → false
  - Edge case: `isQuipuOpenable("Makefile")` → false (no extension, not in code set)
  - Edge case: `isQuipuOpenable(".gitignore")` → true (in CODE_EXTENSIONS)

  **Verification:**
  - Function correctly classifies all Quipu-supported file types as openable

- [ ] **Unit 3: ActivityBar integration + FileBrowser shell**

  **Goal:** Register the File Browser as a new sidebar context and render a minimal shell component when selected.

  **Requirements:** R1 (Activity Bar icon), R6 (default to workspace parent)

  **Dependencies:** None

  **Files:**
  - Modify: `src/components/ActivityBar.jsx` — add `{ id: 'browser', label: 'File Browser', Icon: FolderOpenIcon }` to `PANELS`
  - Modify: `src/App.jsx` — add `{activePanel === 'browser' && <FileBrowser />}` in the sidebar panel; add keyboard shortcut (Ctrl+Shift+B or similar)
  - Create: `src/components/FileBrowser.jsx` — shell with navigation bar (back button + breadcrumb path) and empty content area

  **Approach:**
  - The `FileBrowser` component resolves the initial `currentDir` by calling `browseDirectory` on the workspace parent path. The server/Electron returns entries with resolved absolute paths — extract the parent from the first entry's path (or use a simple client-side path normalizer that strips trailing `/..` segments by splitting on `/` and popping). Store the resolved absolute path as `currentDir` state — never display unresolved `..` segments in breadcrumbs.
  - Navigation bar: a back button (ArrowLeft icon) that goes to parent directory, and a breadcrumb showing the current absolute path. Path segments are clickable to jump to ancestors. At filesystem root (`/`), the back button is disabled and no parent segment renders.
  - The panel header supports both a fixed label ("FILE BROWSER") and optional dynamic content area (used later by Unit 5 for selection count). Structure: flex row with label left, actions/status right.
  - **Error recovery**: If `browseDirectory(currentDir)` fails (ENOENT, permission denied), navigate to parent directory. If parent also fails, fall back to workspace root. Show a toast for the error.
  - **Refresh on mutations**: Include `directoryVersion` from WorkspaceContext in the `useEffect` dependency array that loads directory contents, so the browser refreshes when files are created/deleted/renamed in any panel.
  - `currentDir` is component-local state. When the sidebar collapses and reopens, `currentDir` persists (component stays mounted inside the panel container). If the component unmounts (e.g., switching to Explorer), it resets to workspace parent on next mount.
  - `handlePanelToggle` in App.jsx already handles expand/collapse/switch generically — no changes needed to the toggle logic.

  **Patterns to follow:**
  - `PANELS` array pattern in `ActivityBar.jsx`
  - Conditional render pattern in `App.jsx` sidebar section
  - Panel header: `h-[35px]`, `text-[11px]`, `font-semibold`, `tracking-wider`, `text-text-tertiary`, `uppercase`

  **Test scenarios:**
  - Happy path: Clicking the File Browser icon in Activity Bar opens the panel with the workspace parent directory loaded
  - Happy path: Breadcrumbs display the resolved absolute path (no `..` segments)
  - Happy path: Clicking the back button navigates to the parent of the current directory
  - Happy path: Clicking a breadcrumb segment navigates to that ancestor directory
  - Edge case: At filesystem root (`/`), back button is disabled and breadcrumb shows only `/`
  - Edge case: Current directory deleted externally — browser navigates to parent with error toast
  - Edge case: Permission denied on a directory — browser navigates to parent with error toast
  - Happy path: File created in another panel → browser refreshes if viewing the same directory (via `directoryVersion`)
  - Happy path: Toggling the same icon again collapses the sidebar (existing `handlePanelToggle` behavior)

  **Verification:**
  - File Browser icon appears in Activity Bar and correctly toggles the panel
  - Navigation bar shows resolved absolute path and supports back + breadcrumb navigation
  - Error recovery works when directories are inaccessible

- [ ] **Unit 4: Grid and list view rendering**

  **Goal:** Implement the two view modes for displaying directory contents.

  **Requirements:** R2 (grid view), R3 (list view), R4 (view toggle), R12 (hidden dir blocklist)

  **Dependencies:** Unit 3 (FileBrowser shell), Unit 1 (metadata for list view)

  **Files:**
  - Modify: `src/components/FileBrowser.jsx` — add grid view, list view, and view mode toggle

  **Approach:**
  - **View mode state**: `viewMode` state (`'grid'` | `'list'`), toggled via icons in the panel header (grid icon / list icon from Phosphor)
  - **Grid view**: Uses `browseDirectory(currentDir)` (no metadata). CSS grid of icon cards. Each card shows a Phosphor file-type icon (Folder, FileText, FileCode, FileImage, FilePdf, File) + truncated name below. Folders use `FolderSimple`, files use type-specific icons derived from `getFileExtension()`.
  - **List view**: Uses `browseDirectory(currentDir, { metadata: true })`. Rows with icon + name + size (formatted: KB/MB) + modified date (relative or short date). Row height ~28px.
  - **Filtering**: Apply the `HIDDEN_DIRS` blocklist (import from the same source as FileExplorer, or define a shared constant). Show dotfiles that aren't in the blocklist.
  - **Sorting**: Directories first, then alphabetical by name (matching existing `readDirectory` server-side sort).
  - **Double-click folders** to navigate into them. **Single-click files** to select. **Double-click files** to open: import `isQuipuOpenable` from `fileTypes.js` — if true, call `openFile(path, name)` from WorkspaceContext and switch `activePanel` to `'explorer'`; if false, call `openWithSystem(path)` from the file system service.
  - **Empty state**: Show a message when the directory is empty.

  **Patterns to follow:**
  - Grid item styling: `bg-bg-surface`, `hover:bg-white/[0.06]`, `rounded-md`, `text-[12px]` for name
  - List row styling: match `FileTreeItem` height/padding pattern but with additional columns
  - Hidden dir blocklist: `HIDDEN_DIRS` Set pattern from `docs/solutions/ui-bugs/hidden-dotfiles-filtered-from-explorer.md`
  - `directoryVersion` from WorkspaceContext in `useEffect` deps for refresh

  **Test scenarios:**
  - Happy path: Grid view renders folder icons and file-type icons with names for all entries in the current directory
  - Happy path: List view renders rows with icon, name, formatted size, and modified date
  - Happy path: Toggling view mode switches between grid and list without losing current directory
  - Happy path: Double-clicking a folder navigates into it and loads its contents
  - Happy path: Double-clicking a `.md` file calls `openFile()` and switches to Explorer panel
  - Happy path: Double-clicking a `.docx` file calls `openWithSystem()`
  - Edge case: Directory with 0 entries shows empty state message
  - Edge case: Very long file names are truncated with ellipsis in grid view
  - Edge case: Hidden directories in the blocklist (`.git`, `node_modules`) are filtered out

  **Verification:**
  - Both view modes render correctly with appropriate icons and layout
  - File opens route correctly based on `isQuipuOpenable` result
  - View mode toggle persists within the session

- [ ] **Unit 5: Multi-select**

  **Goal:** Enable selecting multiple files/folders with Ctrl+click and Shift+click.

  **Requirements:** R9 (multi-select)

  **Dependencies:** Unit 4 (grid and list views)

  **Files:**
  - Modify: `src/components/FileBrowser.jsx` — add selection state and keyboard-modified click handlers

  **Approach:**
  - **State**: `selectedPaths` as a `Set<string>`, `lastClickedIndex` as a number (for shift-range).
  - **Single click (no modifier)**: Clear selection, select clicked item, set `lastClickedIndex`.
  - **Ctrl+click** (Cmd+click on macOS): Toggle the clicked item in/out of selection. Update `lastClickedIndex`.
  - **Shift+click**: Select range from `lastClickedIndex` to clicked index (inclusive), replacing current selection.
  - **Visual feedback**: Selected items get `bg-accent/20 outline outline-1 outline-accent/40` in both grid and list views.
  - **Click on empty space**: Clear selection.
  - **Selection count**: Show count in panel header when >0 (e.g., "3 selected").
  - Multi-select affects drag-and-drop (Unit 6) and context menu (bulk operations).

  **Patterns to follow:**
  - `cn()` for conditional selected styling
  - `e.metaKey || e.ctrlKey` for cross-platform Ctrl/Cmd detection (existing pattern in App.jsx keyboard shortcuts)

  **Test scenarios:**
  - Happy path: Single click selects one item and deselects others
  - Happy path: Ctrl+click on an unselected item adds it to selection
  - Happy path: Ctrl+click on a selected item removes it from selection
  - Happy path: Shift+click selects the range between last-clicked and current item
  - Happy path: Selected items show visual highlight in both grid and list views
  - Edge case: Shift+click with no prior click (no `lastClickedIndex`) selects only the clicked item
  - Edge case: Clicking empty space clears all selection
  - Happy path: Selection count appears in header when items are selected

  **Verification:**
  - Multi-select works correctly in both grid and list view modes
  - Visual feedback clearly indicates which items are selected

- [ ] **Unit 6: Drag-and-drop**

  **Goal:** Enable moving files/folders via drag-and-drop within the browser and from the browser to the workspace explorer.

  **Requirements:** R10 (drag-and-drop)

  **Dependencies:** Unit 5 (multi-select — dragging selected items), Unit 4 (view rendering)

  **Files:**
  - Modify: `src/components/FileBrowser.jsx` — add drag source handlers to grid/list items, drop target handlers to folders and the browser background
  - Modify: `src/components/FileExplorer.jsx` — add drop target acceptance for files dragged from FileBrowser (may already work if using same `dataTransfer` format)

  **Approach:**
  - **Drag source**: Set `draggable` on grid items and list rows. On `dragStart`, put selected paths (or just the dragged item if not in selection) into `dataTransfer` as JSON array in `text/plain`. Also set a custom MIME type `application/x-quipu-paths` with the JSON array to distinguish FileBrowser drags from FileExplorer single-path drags.
  - **Drop target — folders in browser**: Accept drops, move all dragged paths into the target folder via `renamePath()`.
  - **Drop target — workspace explorer (requires explicit FileExplorer changes)**: Both `FileTreeItem.handleDrop` (~line 235) and the root `FileExplorer.handleDrop` (~line 406) must be updated. The change: check for `application/x-quipu-paths` MIME type first — if present, parse JSON array and move each path sequentially via `renameEntry()`. If absent, fall back to existing single-path `text/plain` handling. This keeps backward compatibility for intra-tree drags while supporting multi-file drops from the FileBrowser.
  - **Visual feedback**: Reuse existing `bg-accent/20 outline outline-1 outline-accent/50` pattern on drop targets.
  - **Validation**: No dropping a folder into itself or its descendants. No dropping onto a file (only folders are valid targets). For batch moves, validate each path individually and skip invalid ones with a toast.

  **Patterns to follow:**
  - HTML5 drag-and-drop pattern from `FileExplorer.jsx` `FileTreeItem`
  - `quipu-drag-end` custom event for cleanup
  - `renamePath(oldPath, newPath)` from WorkspaceContext for move operations

  **Test scenarios:**
  - Happy path: Drag a single file onto a folder in the browser → file moves into that folder
  - Happy path: Drag multiple selected files onto a folder → all move
  - Happy path: Drag a file from the browser onto the workspace Explorer tree → file moves into the workspace
  - Edge case: Drag a folder onto itself → no-op
  - Edge case: Drag a folder onto one of its descendants → no-op (prevented)
  - Error path: Drag onto a file (not a folder) → no drop indicator, drop is rejected
  - Happy path: After drop, the browser refreshes to reflect the moved files

  **Verification:**
  - Files can be moved within the browser and from the browser to the workspace explorer
  - Visual drop indicators appear on valid targets

- [ ] **Unit 7: Context menu**

  **Goal:** Add right-click context menu with standard file operations.

  **Requirements:** R11 (context menu)

  **Dependencies:** Unit 5 (multi-select for bulk operations), Unit 4 (view rendering)

  **Files:**
  - Modify: `src/components/FileBrowser.jsx` — add context menu handlers using the existing `ContextMenu` component

  **Approach:**
  - Right-click on an item: if the item is not in the current selection, select only that item first. Then show context menu.
  - **Menu items for files**: Open, Open with System, Rename, Delete, Copy Path
  - **Menu items for folders**: Open (navigate into), Rename, Delete, New File, New Folder, Copy Path
  - **Menu items on empty space**: New File, New Folder, Refresh (Paste omitted in v1 — no copy/paste scope)
  - **Bulk selection menu** (when multiple items selected): Delete, Copy Paths
  - Use existing `ContextMenu` component with `{ items, position, onClose }` shape.
  - Rename uses inline editing (input field replacing the name label), matching the `FileExplorer` pattern.
  - Delete calls `deletePath()` from WorkspaceContext with a confirmation.

  **Patterns to follow:**
  - `ContextMenu` component from `src/components/ContextMenu.jsx`
  - Inline rename pattern from `FileTreeItem` in `FileExplorer.jsx`
  - `data-context="file-browser-item"` to prevent App.jsx global context menu from firing

  **Test scenarios:**
  - Happy path: Right-click a file → shows Open, Open with System, Rename, Delete, Copy Path
  - Happy path: Right-click a folder → shows Open, Rename, Delete, New File, New Folder, Copy Path
  - Happy path: Right-click empty space → shows New File, New Folder, Refresh
  - Happy path: Selecting "Rename" shows inline input, pressing Enter commits the rename
  - Happy path: Selecting "Delete" on a single file removes it after confirmation
  - Happy path: Right-click with 3 items selected → shows Delete (with count), Copy Paths
  - Edge case: Right-clicking an unselected item when other items are selected → clears selection, selects right-clicked item, shows single-item menu

  **Verification:**
  - Context menu appears with correct items for files, folders, empty space, and multi-selection
  - All operations (rename, delete, copy path, new file/folder) work correctly

## System-Wide Impact

- **Interaction graph:** ActivityBar gains a 4th panel. `handlePanelToggle` in App.jsx routes to FileBrowser. FileBrowser uses `browseDirectory()` (new, unsandboxed) for listing and `openFile()` (WorkspaceContext) for Quipu-openable files, `fs.openWithSystem()` for others. File mutations (rename, delete, create) increment `directoryVersion`, which refreshes both the workspace Explorer and the FileBrowser's current directory.
- **Error propagation:** File system errors (permission denied, file not found) surface via `showToast(message, 'error')`. Navigation errors trigger fallback to parent directory. No silent failures.
- **State lifecycle risks:** The browser's `currentDir` is component-local — if the directory is deleted externally, the `browseDirectory` call fails and the browser navigates to the parent (see Unit 3 error recovery). `currentDir` persists while the component is mounted but resets to workspace parent on unmount/remount.
- **API surface parity:** `browseDirectory`, metadata flag, and `openWithSystem` must work in both Electron and browser runtimes. The Go `/browse` endpoint is new and has no Electron sandbox equivalent (Electron reads any path natively).
- **Unchanged invariants:** The workspace Explorer, file tree, `workspacePath`, existing `/files` endpoint sandboxing, and all existing tab behavior are unchanged. The FileBrowser is additive — it uses its own `browseDirectory` API and does not alter workspace state or navigation.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `browseDirectory` with metadata and large directories (1000+ files) — N+1 `stat()` calls | Metadata is opt-in (`?metadata=true`), only used in list view. Grid view skips it. If still slow, add server-side pagination |
| Multi-select drag of many files could overwhelm `renamePath` calls | Batch moves sequentially with a progress indicator; limit to reasonable count |
| Files outside workspace opened via `openFile()` — save/watch may not work in browser mode | Out-of-workspace files open read-only in browser mode (Go sandbox blocks writes). In Electron mode, full read/write works. Document this limitation |
| Go `/browse` endpoint exposes filesystem outside workspace | Restricted to read-only directory listing only. No write/delete/rename. CORS still restricted to localhost. Equivalent to what Electron already allows |
| `shell.openPath` may not exist in older Electron versions | Electron 39.2 supports it; not a concern for this project |

## Sources & References

- Related code: `src/components/ActivityBar.jsx`, `src/components/FileExplorer.jsx`, `src/services/fileSystem.js`, `src/utils/fileTypes.js`
- Learnings: `docs/solutions/ui-bugs/hidden-dotfiles-filtered-from-explorer.md`, `docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md`, `docs/solutions/integration-issues/resizable-panels-library-integration.md`
