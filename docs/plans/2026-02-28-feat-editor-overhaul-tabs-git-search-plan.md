---
title: "feat: Editor Overhaul - Tabs, Markdown Fix, Activity Bar, Search & Git"
type: feat
status: active
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# feat: Editor Overhaul - Tabs, Markdown Fix, Activity Bar, Search & Git

## Overview

A cohesive set of improvements to Quipu that bring it closer to a VSCode-like editing experience, built in 4 incremental phases. Fixes the markdown save bug, adds multi-tab file management, introduces a VSCode-style Activity Bar with panel system, and adds full-text search and git source control integration.

(see brainstorm: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md)

## Problem Statement / Motivation

Three user-reported issues drive this work:

1. **Cannot close a file** - No tab bar or close button exists. The app shows one active file with no way to dismiss it.
2. **Markdown files lose formatting on save** - `WorkspaceContext.saveFile()` calls `editorInstance.getText()` for non-quipu files, which strips all markdown syntax (`#`, `**`, `*`, etc.). Root cause at [WorkspaceContext.jsx:117](src/context/WorkspaceContext.jsx#L117).
3. **No Activity Bar or Source Control** - Only a FileExplorer sidebar exists. Users want a VSCode-style icon rail with Explorer, Search, and Source Control panels.

## Proposed Solution

Build in 5 incremental phases, each shippable independently:

| Phase       | Scope                                          | Dependencies        |
| ----------- | ---------------------------------------------- | ------------------- |
| **Phase 0** | Security hardening + error notification system | None (prerequisite) |
| **Phase 1** | Fix markdown round-trip save                   | Phase 0             |
| **Phase 2** | Multi-tab file system                          | Phase 1             |
| **Phase 3** | Activity Bar + Explorer migration              | Phase 2             |
| **Phase 4** | Search + Source Control panels                 | Phase 3             |

## Technical Considerations

- **Architecture**: Single `WorkspaceContext` extended (no new state libraries). New service files (`gitService.js`, `searchService.js`) following the `fileSystem.js` adapter pattern.
- **Performance**: Tab cap at 12 to limit memory. Search results capped at 500. Git status polling every 5s only when panel visible.
- **Security**: Go server must sandbox file paths to workspace root. Git commands use `exec.Command` with argument arrays (no string concatenation). CORS restricted to localhost.

## System-Wide Impact

- **Interaction graph**: File save -> disk write -> toast notification -> git status poll (if SC panel visible) -> SC panel refresh. Tab switch -> JSON snapshot -> state update -> content load -> comment extraction.
- **Error propagation**: All errors surface via toast notifications (replacing current `console.error` pattern). Git stderr messages shown directly in toasts.
- **State lifecycle risks**: Tab switch during save (mitigate by queuing switch). Rapid file opening (debounce). Git checkout with dirty tabs (warn user). External file modification (Electron detects via fs.watch; browser mode cannot -- known limitation).
- **API surface parity**: Every backend operation needs both Go server endpoints AND Electron IPC handlers, following the existing adapter pattern in `fileSystem.js`.

---

## Implementation Phases

### Phase 0: Security Hardening + Error Notification System

The SpecFlow analysis identified critical security vulnerabilities (no path sandboxing, open CORS `*`) and the complete absence of user-facing error messages. These must be fixed before adding new server endpoints.

**Tasks:**

- [ ] **Sandbox file operations to workspace root** in [server/main.go](server/main.go)
  - All file endpoints must validate resolved path is within workspace root using `filepath.Rel()`
  - Reject with `403 Forbidden` if path escapes sandbox
- [ ] **Restrict CORS** from `*` to `http://localhost:5173`
- [ ] **Create toast notification system**
  - New: `src/components/Toast.jsx` + `Toast.css`
  - Bottom-right stack, auto-dismiss 5s, types: error/warning/success/info
  - Add `showToast(message, type)` to WorkspaceContext (or new ToastContext)
- [ ] **Replace all `console.error` calls** in [WorkspaceContext.jsx](src/context/WorkspaceContext.jsx) with `showToast()` calls

**Files:**
- `server/main.go`
- `src/components/Toast.jsx` (new)
- `src/components/Toast.css` (new)
- `src/context/WorkspaceContext.jsx`

---

### Phase 1: Fix Markdown Round-Trip Save

**Library choice: `tiptap-markdown`** - native TipTap extension that handles both parsing and serialization. API: `editor.storage.markdown.getMarkdown()`.

**Tasks:**

- [ ] **Install `tiptap-markdown`** and **remove `marked`**

- [ ] **Add Markdown extension to Editor.jsx**

```jsx
// src/components/Editor.jsx
import { Markdown } from 'tiptap-markdown';

const editor = useEditor({
    extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: 'Start writing...' }),
        Markdown.configure({
            html: false,
            tightLists: true,
            bulletListMarker: '-',
            transformPastedText: true,
            transformCopiedText: true,
        }),
        // existing comment extension (strip in markdown output)
    ],
});
```

- [ ] **Strip comment marks during markdown serialization** by adding markdown serialize config to the comment extension:

```jsx
// In comment extension's .extend() block
addStorage() {
    return {
        markdown: {
            serialize: { open: '', close: '' },
            parse: { /* no-op */ }
        }
    };
},
```

- [ ] **Update save logic in WorkspaceContext.jsx**

```jsx
// src/context/WorkspaceContext.jsx - saveFile
if (activeFile.name.endsWith('.md') || activeFile.name.endsWith('.markdown')) {
    content = editorInstance.storage.markdown.getMarkdown();
} else {
    content = editorInstance.getText();
}
```

- [ ] **Update Editor.jsx file loading** - pass raw markdown text directly to TipTap (tiptap-markdown parses it), removing the `marked.parse()` call

```jsx
if (isMarkdown) {
    editor.commands.setContent(text); // tiptap-markdown handles parsing
}
```

- [ ] **Test round-trip fidelity**: headings, bold, italic, code blocks, lists, links, blockquotes

**Known limitations:**
- TipTap StarterKit lacks tables and task lists - those markdown features will be lost on load (add extensions later)
- Comments on `.md` files are ephemeral - stripped on save (see brainstorm)

**Files:**
- `package.json` (add `tiptap-markdown`, remove `marked`)
- `src/components/Editor.jsx`
- `src/context/WorkspaceContext.jsx`

---

### Phase 2: Multi-Tab File System

**Tab state shape:**

```javascript
{
    id: crypto.randomUUID(),
    path: '/path/to/file.md',
    name: 'file.md',
    content: '...',              // original loaded content
    tiptapJSON: { ... },         // snapshot when switching away
    isDirty: false,
    isQuipu: false,
    isMarkdown: true,
    scrollPosition: 0,
}
```

**Tasks:**

- [ ] **Refactor WorkspaceContext state**:
  - `openTabs` array (Tab[]) + `activeTabId` (string|null) + `MAX_TABS = 12`
  - Derive `activeFile` and `isDirty` from active tab for backward compatibility
  - Update all consumers: `App.jsx`, `Editor.jsx`, `FileExplorer.jsx`

- [ ] **Update `openFile`** to manage tabs:
  - If file already open -> switch to existing tab
  - If at tab cap -> show toast "Close a tab to open more files"
  - Otherwise -> create new tab, set as active

- [ ] **Add tab management functions**: `closeTab(tabId)`, `switchTab(tabId)`, `closeAllTabs()`, `closeOtherTabs(tabId)`, `setTabDirty(tabId, isDirty)`

- [ ] **Handle tab switching in Editor.jsx**:
  - Before switch: `editor.getJSON()` -> store in current tab's `tiptapJSON`
  - After switch: `editor.commands.setContent(newTab.tiptapJSON || newTab.content)`
  - Update `loadedFileRef` to track `activeTabId`

- [ ] **Create TabBar component** (`src/components/TabBar.jsx` + `TabBar.css`)

```jsx
// Tab bar with: file name, dirty dot, close button (X)
// ARIA: role="tablist", role="tab", aria-selected
// Active tab: highlighted background
// Dirty indicator: small dot next to name
// Close button: visible on hover, always visible on active tab
```

- [ ] **Add keyboard shortcuts** in App.jsx:
  - `Ctrl+Tab` / `Ctrl+Shift+Tab` - next/previous tab (positional order)
  - `Ctrl+W` - close active tab

- [ ] **Edge cases**:
  - Closing last tab -> empty editor with placeholder
  - Closing active tab -> switch to adjacent (right, then left)
  - Tab cap reached -> toast, refuse to open
  - Close dirty tab -> `window.confirm("Save changes to {filename}?")` with Save/Don't Save/Cancel

**Known limitation:** Undo/redo history resets on tab switch (single TipTap instance).

**Files:**
- `src/context/WorkspaceContext.jsx` (major refactor)
- `src/components/TabBar.jsx` (new)
- `src/components/TabBar.css` (new)
- `src/components/Editor.jsx`
- `src/App.jsx`
- `src/App.css`

---

### Phase 3: Activity Bar + Explorer Migration

**Target layout:** `[ActivityBar(48px) | SidePanel(250px) | TabBar + editor-pane / terminal-pane]`

**Tasks:**

- [ ] **Create ActivityBar component** (`src/components/ActivityBar.jsx` + `ActivityBar.css`)
  - Narrow icon rail: 48px wide, dark `#252526` background
  - Icons: Explorer (active), Search (disabled), Source Control (disabled)
  - Active indicator: left border (3px accent)
  - Click to toggle panel on/off, click different icon to switch
  - `role="toolbar"`, `aria-label` on each button

- [ ] **Add panel state** to App.jsx:

```jsx
const [activePanel, setActivePanel] = useState('explorer');
const handlePanelToggle = (panelId) => {
    setActivePanel(prev => prev === panelId ? null : panelId);
};
```

- [ ] **Refactor App.jsx layout**:

```jsx
<div className="app-container">
    <ActivityBar activePanel={activePanel} onPanelToggle={handlePanelToggle} />
    {activePanel && (
        <div className="side-panel">
            {activePanel === 'explorer' && <FileExplorer />}
            {activePanel === 'search' && <SearchPanel />}
            {activePanel === 'git' && <SourceControlPanel />}
        </div>
    )}
    <div className="main-area">...</div>
</div>
```

- [ ] **Re-theme FileExplorer** from dark to warm:
  - Background: `var(--bg-color)` instead of `#252526`
  - Text: `var(--text-color)` instead of `#cccccc`
  - Hover/active: warm variants instead of dark VSCode colors
  - Context menu: keep dark for contrast (or warm, designer's choice)

- [ ] **Add CSS variables** for sidebar dark theme in `src/index.css`

- [ ] **Update Ctrl+B** to toggle side panel (Activity Bar always visible)

- [ ] **Add placeholder panels** for Search and Source Control with "Coming soon" message + disabled Activity Bar icons with tooltip

**Files:**
- `src/components/ActivityBar.jsx` (new)
- `src/components/ActivityBar.css` (new)
- `src/components/FileExplorer.css` (re-theme)
- `src/App.jsx`
- `src/App.css`
- `src/index.css`

---

### Phase 4a: Search Panel

**Tasks:**

- [ ] **Add Go server endpoints**:
  - `GET /search?path=<workspace>&q=<query>&regex=false&caseSensitive=false` - shells out to `rg` (fallback `grep`), returns `{ results: [{file, line, text}], truncated: bool }`, max 500 results
  - `GET /files-recursive?path=<workspace>&limit=5000` - flat file list excluding `node_modules`, `.git`, `build`, `dist`

- [ ] **Add Electron IPC handlers** for search + recursive file listing in `main.cjs` + `preload.cjs`

- [ ] **Create `src/services/searchService.js`** following adapter pattern

- [ ] **Create SearchPanel component** (`src/components/SearchPanel.jsx` + `SearchPanel.css`)
  - Search input with case-sensitive toggle + regex toggle
  - Debounced search (300ms)
  - Results grouped by file, each showing line number + matched text
  - Click result -> open file in tab at matching line
  - "Showing first 500 results" indicator if truncated

- [ ] **Create QuickOpen component** (`src/components/QuickOpen.jsx` + `QuickOpen.css`)
  - Floating modal overlay (centered, 500px wide)
  - Fuzzy filename match against flat file list
  - Arrow keys + Enter to select, Escape to close
  - File list fetched once when overlay opens

- [ ] **Add keyboard shortcuts**: `Ctrl+Shift+F` (focus search), `Ctrl+P` (quick open)

- [ ] **Enable Search icon** in ActivityBar

**Files:**
- `server/main.go` (new endpoints)
- `electron/main.cjs` + `electron/preload.cjs` (new IPC handlers)
- `src/services/searchService.js` (new)
- `src/components/SearchPanel.jsx` (new)
- `src/components/SearchPanel.css` (new)
- `src/components/QuickOpen.jsx` (new)
- `src/components/QuickOpen.css` (new)
- `src/App.jsx`
- `src/components/ActivityBar.jsx`

---

### Phase 4b: Source Control Panel

**Diff library: `@git-diff-view/react`** - high-quality React diff component with split mode, syntax highlighting via Shiki, and widget extension support.

**Tasks:**

- [ ] **Add Go server git endpoints** (all validate workspace sandbox, use `exec.Command` with argument arrays):

| Endpoint        | Method | Shells out to                                     |
| --------------- | ------ | ------------------------------------------------- |
| `/git/status`   | GET    | `git status --porcelain -z`                       |
| `/git/diff`     | GET    | `git diff [--cached] -- <file>`                   |
| `/git/stage`    | POST   | `git add <files>`                                 |
| `/git/unstage`  | POST   | `git reset HEAD -- <files>`                       |
| `/git/commit`   | POST   | `git commit -m "<message>"`                       |
| `/git/push`     | POST   | `git push`                                        |
| `/git/pull`     | POST   | `git pull`                                        |
| `/git/branches` | GET    | `git branch --list` + `git branch --show-current` |
| `/git/checkout` | POST   | `git checkout <branch>`                           |
| `/git/log`      | GET    | `git log --oneline -20`                           |

- [ ] **Add Electron IPC handlers** for all git operations

- [ ] **Create `src/services/gitService.js`** following adapter pattern

- [ ] **Create SourceControlPanel component** (`src/components/SourceControlPanel.jsx` + `SourceControlPanel.css`)

```
SourceControlPanel
  |- BranchIndicator (current branch + dropdown to switch)
  |- CommitSection (message textarea + commit button)
  |- StagedChanges (header + unstage-all + file list with A/M/D icons + unstage per-file)
  |- Changes (header + stage-all + file list with M/D/U icons + stage per-file)
  |- UntrackedFiles (file list with "+" to stage)
  |- PushPullButtons (push/pull with remote status)
```

- [ ] **Create DiffViewer component** (`src/components/DiffViewer.jsx` + `DiffViewer.css`)
  - Opens as a special read-only tab in the tab bar (tab name: `file.js (diff)`)
  - Uses `@git-diff-view/react` with `DiffModeEnum.Split`
  - Receives hunks from `gitService.diff()`

```jsx
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

// Usage: <DiffView data={{ oldFile, newFile, hunks }} diffViewMode={DiffModeEnum.Split} />
```

- [ ] **Install `@git-diff-view/react`**

- [ ] **Add git status polling**: every 5s when panel visible + immediate after file save

- [ ] **Handle edge cases**:
  - Non-git workspace: show "Not a git repository" with optional `git init` button
  - Auth failures on push/pull: show toast with error, 30s timeout on commands
  - Nothing staged on commit: show toast "Nothing to commit"
  - Merge conflicts after pull: show files with U status (resolution is manual for MVP)

- [ ] **Enable Source Control icon** in ActivityBar

**Files:**
- `server/main.go` (git endpoints)
- `electron/main.cjs` + `electron/preload.cjs` (git IPC)
- `src/services/gitService.js` (new)
- `src/components/SourceControlPanel.jsx` (new)
- `src/components/SourceControlPanel.css` (new)
- `src/components/DiffViewer.jsx` (new)
- `src/components/DiffViewer.css` (new)
- `src/components/ActivityBar.jsx`
- `src/context/WorkspaceContext.jsx` (save event for git polling)
- `package.json` (add `@git-diff-view/react`)

---

## Acceptance Criteria

- [ ] Markdown files preserve `#`, `**`, `*`, backticks, lists, links, blockquotes through save/reopen cycles
- [ ] Users can have up to 12 files open in tabs simultaneously
- [ ] Tab bar shows file name, unsaved indicator (dot), and close button
- [ ] Closing a dirty tab prompts confirmation
- [ ] Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+W work for tab management
- [ ] Activity Bar shows Explorer, Search, Source Control icons
- [ ] Clicking Activity Bar icon toggles the corresponding panel
- [ ] Full-text search returns results within 2 seconds
- [ ] Ctrl+P opens quick file finder with fuzzy matching
- [ ] Source Control shows changed/staged/untracked files
- [ ] Stage, unstage, commit, push, pull work from UI
- [ ] Branch switching works and refreshes file tree
- [ ] Side-by-side diff viewer shows file changes
- [ ] Go server rejects file operations outside workspace root
- [ ] All errors show toast notifications (no silent console.error)
- [ ] Tab bar, Activity Bar, and panels have ARIA labels

## Dependencies & Risks

**New dependencies:**
- `tiptap-markdown` - markdown round-trip for TipTap v3
- `@git-diff-view/react` - side-by-side diff component
- System: `git` CLI (source control), `grep`/`rg` (search)

**Risks:**

| Risk                                      | Mitigation                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| TipTap undo history lost on tab switch    | Document as known limitation; investigate per-tab ProseMirror history later |
| `tiptap-markdown` drops tables/task lists | Test with representative files; add TipTap extensions later                 |
| Git push/pull hangs on auth prompt        | 30s timeout on exec.Command; toast on timeout                               |
| Large workspace search timeout            | Cap at 500 results; prefer ripgrep; show truncation indicator               |
| Browser mode has no file watching         | Document limitation; manual refresh button                                  |

## Future Considerations

- TipTap table + task list extensions for better markdown fidelity
- Tab drag-to-reorder
- Resizable side panel and terminal pane (drag borders)
- Find-and-replace in Search panel
- Merge conflict resolution UI
- Git branch creation/deletion
- Per-tab undo/redo history

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) -- Key decisions: incremental layers approach, dark Activity Bar + warm panels, shell out to git CLI, cap tabs at 12

### Internal References

- Markdown save bug: [src/context/WorkspaceContext.jsx:117](src/context/WorkspaceContext.jsx#L117)
- File system adapter pattern: [src/services/fileSystem.js](src/services/fileSystem.js)
- Editor TipTap setup: [src/components/Editor.jsx:24-93](src/components/Editor.jsx#L24-L93)
- Go server: [server/main.go](server/main.go)
- Electron IPC: [electron/main.cjs](electron/main.cjs)
- Prior fix doc: [docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md](docs/solutions/integration-issues/file-explorer-editor-integration-fixes.md)

### External References

- tiptap-markdown: https://github.com/aguingand/tiptap-markdown
- @git-diff-view/react: https://github.com/MrWangJustToDo/git-diff-view
- TipTap documentation: https://tiptap.dev/docs
