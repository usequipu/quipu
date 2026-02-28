---
title: "Editor Overhaul: Multi-tab System, Markdown Round-trip, Activity Bar, Search & Git"
date: 2026-02-28
category: ui-bugs
tags:
  - markdown-formatting
  - file-management
  - editor-features
  - tabs
  - activity-bar
  - git-integration
  - search
  - security
  - dual-runtime
severity: high
components:
  - src/context/WorkspaceContext.jsx
  - src/components/Editor.jsx
  - src/components/TabBar.jsx
  - src/components/ActivityBar.jsx
  - src/components/SearchPanel.jsx
  - src/components/QuickOpen.jsx
  - src/components/SourceControlPanel.jsx
  - src/components/Toast.jsx
  - src/services/fileSystem.js
  - src/services/searchService.js
  - src/services/gitService.js
  - server/main.go
  - electron/main.cjs
  - electron/preload.cjs
  - src/App.jsx
symptoms:
  - Users cannot close open files in editor
  - Markdown formatting lost on save (headers, bold, italics stripped)
  - No tab bar or file management UI
  - No Activity Bar sidebar
  - No source control integration
  - No file search or quick-open functionality
root_causes:
  - "editorInstance.getText() used for all non-.quipu files, stripping markdown syntax"
  - "Single activeFile state with no multi-tab infrastructure"
  - "Flat sidebar architecture with no panel system"
  - "No path sandboxing on Go server (directory traversal possible)"
  - "CORS set to * allowing any origin"
resolution_type: architecture-change
time_to_resolve: "2-3 days"
branch: feat/editor-overhaul
commits:
  - "732595b: Security hardening + toast notifications"
  - "2eada56: Markdown round-trip fix"
  - "115ff82: Multi-tab file system"
  - "79c55a2: Activity Bar + Explorer migration"
  - "c4bf9a2: Search panel + QuickOpen"
  - "71df934: Source Control panel"
related:
  - docs/plans/2026-02-28-feat-editor-overhaul-tabs-git-search-plan.md
  - docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
  - docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md
---

# Editor Overhaul: Multi-tab System, Markdown Round-trip, Activity Bar, Search & Git

## Problem

Three critical usability gaps in the Quipu Simple editor prevented it from being production-ready:

1. **No tab/file management system**: Users could only view one file at a time with no way to close it or switch between open files
2. **Markdown corruption on save**: `.md` files lost all formatting (`#` headers, `**bold**`, etc.) after saving because the save logic used `getText()` which strips markdown syntax entirely
3. **Missing IDE UI components**: No Activity Bar, Search panel, or Source Control panel -- features essential for modern code editors

Additionally, security audit revealed: no path sandboxing (directory traversal possible), open CORS (`*`), and command injection risk via string-concatenated shell commands.

## Root Cause Analysis

### Markdown Format Loss

**Location**: `src/context/WorkspaceContext.jsx` (original line ~117)

The save logic treated all non-`.quipu` files identically:

```javascript
} else {
  content = editorInstance.getText();  // Strips ALL formatting!
}
```

TipTap stores headings as `heading` node types, not `# text`. When `getText()` extracts content, it produces `heading text` not `# heading text`. Bold, italic, links, and all other marks are also stripped.

### No Tab Architecture

The context used a single `activeFile` object:

```javascript
const [activeFile, setActiveFile] = useState(null);
const [isDirty, setIsDirty] = useState(false);
```

Switching files discarded the current editor state. No concept of "open files" existed.

### Missing UI Panels

The file explorer was hardcoded as the only sidebar with no panel switching infrastructure.

### Security Gaps

- Go server had no workspace root concept -- any path could be read/written
- CORS was set to `*` allowing any origin to call the API
- Git/shell commands were at risk of injection if paths were string-concatenated

## Solution

5-phase incremental overhaul, each phase shippable independently.

### Phase 0: Security + Toast (732595b)

1. **Workspace path sandboxing** in `server/main.go`:
   ```go
   func isWithinWorkspace(absPath string) bool {
     rel, err := filepath.Rel(workspaceRoot, resolved)
     if err != nil || strings.HasPrefix(rel, "..") {
       return false  // Path escapes workspace
     }
     return true
   }
   ```
   Applied to all 6 file operation handlers.

2. **CORS restriction** from `*` to localhost origins only.

3. **Toast notification system**: `ToastProvider` context with `useToast()` hook. Replaced all `console.error` calls with `showToast(message, type)`.

### Phase 1: Markdown Fix (2eada56)

Replaced `marked` with `tiptap-markdown` for bidirectional conversion:

- **Save**: `editor.storage.markdown.getMarkdown()` for `.md`/`.markdown` files
- **Load**: Pass raw markdown to `editor.commands.setContent(text)` (extension auto-parses)
- Removed `marked` dependency entirely

### Phase 2: Multi-Tab System (115ff82)

Refactored state from single file to tab array:

```javascript
const MAX_TABS = 12;
const [openTabs, setOpenTabs] = useState([]);
const [activeTabId, setActiveTabId] = useState(null);

// Backward-compatible derived values
const activeTab = openTabs.find(t => t.id === activeTabId) || null;
const activeFile = activeTab ? { path, name, content, isQuipu } : null;
const isDirty = activeTab?.isDirty ?? false;
```

Tab switching snapshots TipTap JSON before switch, restores on return:
```javascript
snapshotTab(loadedTabRef.current, editor.getJSON(), 0);  // Before switch
editor.commands.setContent(activeTab.tiptapJSON);          // On return
```

Created `TabBar` component with dirty indicators, close buttons, keyboard shortcuts (Ctrl+W, Ctrl+Tab).

### Phase 3: Activity Bar (79c55a2)

- 48px dark `ActivityBar` component with CSS-only icons
- Re-themed `FileExplorer` from dark to warm tan
- Replaced `sidebarVisible` boolean with `activePanel` state
- Layout: `[ActivityBar | side-panel | main-area]`

### Phase 4a: Search Panel (c4bf9a2)

Full dual-runtime implementation:

- **Go server**: `/search` (ripgrep with grep fallback) + `/files-recursive` (filepath.WalkDir)
- **Electron IPC**: `search-files` + `list-files-recursive` handlers
- **Service adapter**: `searchService.js` following `fileSystem.js` pattern
- **SearchPanel**: Debounced 300ms search, case-sensitive/regex toggles, grouped results
- **QuickOpen** (Ctrl+P): Modal with fuzzy filename matching, keyboard navigation

### Phase 4b: Source Control (71df934)

10 git operations across both runtimes:

- **Go server**: `/git/status`, `/git/diff`, `/git/stage`, `/git/unstage`, `/git/commit`, `/git/push`, `/git/pull`, `/git/branches`, `/git/checkout`, `/git/log` -- all with 30s timeout and `exec.Command` argument arrays
- **Electron IPC**: Mirror all 10 with `execFile` argument arrays
- **Service adapter**: `gitService.js` with same pattern
- **SourceControlPanel**: Staged/unstaged/untracked sections, branch switching, commit, push/pull, recent commits. Polls every 5s when visible.

## Key Design Decisions

1. **Dual-runtime adapter pattern**: `isElectron()` at module load selects Electron IPC or Go REST implementation. New features need implementation in 4 places: Go server, Electron IPC, preload bridge, service adapter.

2. **Single WorkspaceContext**: No new state libraries. Extended existing context with `openTabs[]` and `activeTabId`. Derived `activeFile`/`isDirty` for backward compatibility.

3. **TipTap JSON snapshots**: Each tab stores `tiptapJSON: editor.getJSON()` when switching away. Enables instant content restoration without re-parsing from disk.

4. **Path sandboxing with `filepath.Rel()`**: Robustly detects both `../` traversal and symlink attacks in one check. Applied to every endpoint.

5. **30s timeout on git operations**: Prevents UI freeze from network issues on push/pull. Uses `context.WithTimeout` (Go) or `timeout` option (Electron `execFile`).

6. **CSS-only Activity Bar icons**: Avoids icon library dependency. Simple CSS content attributes suffice for 3 panel icons.

## Prevention Strategies

### Multi-Runtime Feature Checklist

When adding new backend features, enforce the "4-place rule":
1. Go server endpoint (`server/main.go`)
2. Electron IPC handler (`electron/main.cjs`)
3. Preload bridge (`electron/preload.cjs`)
4. Service adapter (`src/services/<name>.js`)

### Serialization Format Validation

Use explicit conditional checks for file extensions:
```javascript
if (name.endsWith('.md') || name.endsWith('.markdown')) {
  content = editorInstance.storage.markdown.getMarkdown();
} else if (isQuipu) {
  content = JSON.stringify({ type: 'quipu', content: editor.getJSON() });
} else {
  content = editorInstance.getText();
}
```
Never use `getText()` as a default for files that might contain formatting.

### Security Validation

- Validate every user-supplied path with `isWithinWorkspace()` before filesystem operations
- Use `exec.Command` / `execFile` with argument arrays -- never string concatenation
- Whitelist CORS origins explicitly -- never use `*`

## Testing Checklist

- [ ] Markdown round-trip: Create `.md` with headings/bold/lists, save, reopen -- verify formatting preserved
- [ ] Tab system: Open 3+ files, switch between them, verify content/dirty state preserved
- [ ] Close dirty tab: Verify confirmation dialog appears
- [ ] Tab cap: Open 12 files, try opening 13th -- verify toast warning
- [ ] Keyboard shortcuts: Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+S, Ctrl+B, Ctrl+Shift+F, Ctrl+P
- [ ] Activity Bar: Click icons to toggle panels, verify only one panel visible at a time
- [ ] Search: Type query, verify debounced results grouped by file
- [ ] QuickOpen: Ctrl+P, type filename, arrow keys + Enter to open
- [ ] Git status: Open Source Control panel, verify staged/unstaged/untracked files shown
- [ ] Git operations: Stage, unstage, commit, verify status refreshes
- [ ] Path traversal: Attempt to read `../../etc/passwd` via Go API -- verify 403
- [ ] CORS: Verify requests from non-localhost origin are rejected

## Patterns Established

### 1. Dual-Runtime Adapter Pattern
See `src/services/fileSystem.js`, `searchService.js`, `gitService.js`. Module-load selection via `isElectron()`.

### 2. Tab State Management Pattern
Array of tabs with UUID keys, derived computed values for backward compatibility, JSON snapshots for editor state preservation.

### 3. Security Validation Pattern
`isWithinWorkspace()` using `filepath.Rel()`, `corsMiddleware` with origin whitelist, `exec.Command` with argument arrays.

### 4. Panel System Pattern
Single `activePanel` state in `App.jsx`, toggle function `setActivePanel(prev => prev === id ? null : id)`, conditional rendering in side-panel container.
