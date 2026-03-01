---
title: "Editor Enhancements Phase 2 — Seven Feature Plans for Next Sprint"
problem_type: planning
component: Editor, Terminal, VCS, Windows, FRAME
symptoms:
  - After Phase 1 (PRs #7–#16), multiple UX gaps remained unaddressed
  - No way to search terminal output scrollback
  - Unsaved-tab dot indicator missing; users couldn't see pending changes at a glance
  - Table editing had no UI despite TipTap Table extension being loaded
  - FRAME annotations went stale until tab was manually closed and reopened
  - Long filenames in title area caused frontmatter panel overlap
  - Each workspace session required manual folder selection (no history)
tags:
  - planning
  - editor
  - terminal
  - vcs
  - drag-drop
  - frontmatter
  - windows-installer
  - frame-watch
  - phase2
date: 2026-03-01
status: planned
---

# Editor Enhancements Phase 2 — Seven Feature Plans for Next Sprint

## Context

After Phase 1 delivered the core editor framework (PRs #7–#16: landing page, hidden files, search highlight, rich text toolbar, file title, code/media viewers, diff viewer, toolbar fix), a second sprint of improvements was planned to address remaining UX gaps, add editing power, and improve cross-platform packaging.

## Seven Plans Created

### 1. Editor Font, Syntax, and Table Editing
**Plan file:** `docs/plans/2026-03-01-feat-editor-enhancements-font-tables-plan.md`

**Problem:** Clash Grotesk was functional but Geist Sans offers better long-form readability. Reveal-syntax decorations in Obsidian mode used harsh terracotta that distracted from content. TipTap Table extension was loaded but had no UI.

**Key decisions:**
- Switch `--font-editor` from Clash Grotesk (self-hosted woff2) to Geist Sans via Google Fonts
- Replace terracotta reveal-syntax color with `--color-info` at 0.3 opacity + underline decoration
- Table context menu on right-click inside a cell (8 operations: add/delete rows/columns, delete table) — follows the `FileExplorer.jsx` state-based context menu pattern
- Table toolbar button (TableIcon, disabled when already inside table)
- Markdown round-trip for tables must be verified before shipping

**Files:** `src/index.css`, `src/styles/theme.css`, `src/styles/prosemirror.css`, `src/components/Editor.jsx`, `src/extensions/RevealMarkdown.js`, `public/fonts/` (cleanup)

**Acceptance criteria:** 12

---

### 2. Terminal Enhancements — Search, Multi-Instance, Padding
**Plan file:** `docs/plans/2026-03-01-feat-terminal-enhancements-plan.md`

**Problem:** No way to search terminal scrollback. Users had to rely on a single terminal for everything, forcing external terminals for parallel work. Terminal text touched container edges.

**Key decisions:**
- xterm `SearchAddon` with Ctrl+F overlay (VS Code style, top-right of terminal)
- Multi-terminal tabs via ID multiplexing: `Map<terminalId, ptyProcess>` on Electron, separate WebSocket channels on browser
- New `src/services/terminalService.js` adapter following the `fileSystem.js` dual-runtime pattern
- Max 5 concurrent terminals (toast warning); last terminal close shows a placeholder
- Terminal tab metadata lives in `WorkspaceContext`; xterm instances/refs stay local to `Terminal`
- 8px padding (`p-2`) around xterm viewport with matching background

**Files:** `Terminal.jsx`, `terminalService.js`, `electron/main.cjs`, `electron/preload.cjs`, `server/main.go`, `src/data/commands.js`, `WorkspaceContext.jsx`

**Acceptance criteria:** 12

---

### 3. File & VCS Status Indicators
**Plan file:** `docs/plans/2026-03-01-feat-file-vcs-status-indicators-plan.md`

**Problem:** `isDirty` existed per-tab but had no visual indicator. Source Control icon badge showed no count; users had to click through to see pending changes.

**Key decisions:**
- Small filled dot on dirty tabs positioned after filename, before close button; on hover, dot becomes × (VS Code convention)
- Lift `gitChangeCount` to `WorkspaceContext` from `SourceControlPanel`'s local state to share it with `ActivityBar`
- `SourceControlPanel` polls git status every 5s and propagates count via callback
- Activity Bar badge capped at "99+"

**Files:** `TabBar.jsx`, `ActivityBar.jsx`, `SourceControlPanel.jsx`, `WorkspaceContext.jsx`, `src/styles/theme.css`

**Acceptance criteria:** 8

---

### 4. Block Drag & Drop — Notion-Style Block Reordering
**Plan file:** `docs/plans/2026-03-01-feat-block-drag-drop-plan.md`

**Problem:** No way to reorder blocks by dragging — only cut/paste, which is slow for large sections. Notion and modern editors set user expectations for draggable blocks.

**Key decisions:**
- Custom TipTap extension `BlockDragHandle.js` using ProseMirror plugin (decoration + event handler)
- H1 headings drag entire section (all content until next H1); other blocks drag individually
- 6-dot handle icon appearing within 48px of left edge, 150ms fade transition
- Single atomic ProseMirror transaction for delete+insert (undo-safe)
- Visual feedback: 2px accent drop indicator line, 0.5 opacity ghost, 0.3 opacity source dimming
- Drop snaps between top-level blocks only

**Files:** `src/extensions/BlockDragHandle.js`, `Editor.jsx`, `prosemirror.css`, `theme.css`

**Acceptance criteria:** 17

---

### 5. Title & Frontmatter UI Fixes
**Plan file:** `docs/plans/2026-03-01-feat-title-frontmatter-ui-fixes-plan.md`

**Problem:** Long filenames wrapped to multiple lines and overlapped the frontmatter panel. Frontmatter defaulted to expanded, cluttering the UI on every file open. Array values had no add/delete UI; no raw YAML editing escape hatch.

**Key decisions:**
- Remove fixed height from title wrapper; use natural flow (`min-h-fit`)
- Change `frontmatterCollapsed` default from `false` → `true` in `WorkspaceContext`
- Array values: render as tags with × to delete, + to add new items
- "Edit Raw" toggle: swaps between structured editor and textarea showing raw YAML; blur triggers re-parse with toast on error
- Inline tag editing: click text → contenteditable field

**Files:** `Editor.jsx`, `FrontmatterProperties.jsx`, `WorkspaceContext.jsx`

**Acceptance criteria:** 7

---

### 6. Windows MSI Installer + Workspace History
**Plan file:** `docs/plans/2026-03-01-feat-windows-installer-workspace-history-plan.md`

**Problem:** NSIS installer is functional but MSI is the standard Windows enterprise format. Users must pick a workspace folder on every launch — no memory of previous sessions.

**Key decisions (phased):**
- **Phase 1 (Workspace History):** `lastWorkspace` + `recentWorkspaces[]` (max 10) via `electron-store` (Electron) or `localStorage` (browser); auto-open last workspace on startup; `File > Open Recent` submenu
- **Phase 2 (MSI):** `electron-builder` MSI target with WiX Toolset; `oneClick: false`, `perMachine: true`, desktop + Start Menu shortcuts
- **Phase 3:** `.quipu` file associations, stable upgrade GUID, optional PATH entry
- New `src/services/storageService.js` dual-runtime adapter

**Files:** `storageService.js`, `electron/main.cjs`, `electron/preload.cjs`, `WorkspaceContext.jsx`, `commands.js`, `MenuBar.jsx`, `package.json`

**Acceptance criteria:** 14

---

### 7. FRAME Watch — Auto-Update Editor on External Changes
**Plan file:** `docs/plans/2026-03-01-feat-frame-watch-integration-plan.md`

**Problem:** FRAME annotations only load when a tab opens or switches. External edits to `.frame.json` files by Claude Code don't auto-reflect in the editor — users see stale annotations until they close and reopen the tab.

**Key decisions:**
- **Electron:** `fs.watch()` (or chokidar) on `${workspacePath}/.quipu/meta/` with 500ms debounce
- **Browser:** `fsnotify` with SSE/WebSocket push, or polling `GET /frame/modified?since=<ts>` every 5s
- New `src/services/frameService.js` with `watchFrame()`/`unwatchFrame()` following established adapter pattern
- On frame change: re-read FRAME file, update comment marks incrementally (no full editor reload)
- Self-write filter via timestamp comparison or `isWriting` flag to avoid reload loops
- "Annotations updated" info toast on success

**Files:** `frameService.js`, `electron/main.cjs`, `electron/preload.cjs`, `server/main.go`, `Editor.jsx`

**Acceptance criteria:** 7

---

## Implementation Patterns Used Across All Plans

### Dual-Runtime Service Adapters
Every feature touching the backend follows the `fileSystem.js` pattern:
```javascript
const impl = isElectron() ? electronImpl : browserImpl;
export default { methodA, methodB };
```
New services planned: `terminalService.js`, `storageService.js`, `frameService.js`.

### State Lifting
Shared state (git change count, terminal tabs, workspace history) moves to `WorkspaceContext` so multiple components can consume it without prop-drilling. Component-local state (xterm instances, DOM refs) stays local.

### Context Menu Pattern
New context menus (table operations) follow the existing `FileExplorer.jsx` approach: state `{ x, y }` for position, click-outside + Escape to dismiss, no external library.

### Toast for User Feedback
All error handling and state transitions use `showToast(message, type)` — never bare `console.error`.

## Total Scope

| Metric | Value |
|--------|-------|
| Plans created | 7 |
| Total acceptance criteria | 77 |
| New components | ~4 (BlockDragHandle, terminalService, storageService, frameService) |
| Files touched (est.) | 40+ |
| Backend changes needed | 4 of 7 plans require dual-runtime backend work |

## Related Docs

- [Inline Git Diff Viewer](./inline-git-diff-viewer-source-control.md) — git status state and SourceControlPanel patterns
- [Diff Viewer State Lifting](./diff-viewer-state-lifting-to-main-editor.md) — state lifting precedent
- [Media Viewer](./media-viewer-image-video-support.md) — fileSystem service adapter pattern
- [FRAME System](../integration-issues/frame-system-multi-component-sync.md) — FRAME architecture
- [Terminal Workspace Sync](../integration-issues/claude-terminal-workspace-sync.md) — Terminal dual-runtime patterns
- [TipTap Toolbar Mode Toggle](../editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md) — editor extension patterns
