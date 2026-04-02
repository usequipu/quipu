---
title: Bugfix and Polish Sprint — 9 Issues
type: fix
status: active
date: 2026-03-25
---

# Bugfix and Polish Sprint — 9 Issues

## Overview

A consolidated plan covering 9 bugs and improvements across the Quipu Simple editor: file explorer crashes, comment system failures, editor styling, view modes, keyboard shortcuts, and Excalidraw saving. Issues are prioritized by severity (data loss > broken features > UX polish > design decisions).

## Problem Statement / Motivation

Several core workflows are broken or degraded:
- **Data loss**: Excalidraw saves overwrite files with garbage content from a stale TipTap editor reference
- **Crashes**: Opening an empty folder breaks the app in browser mode (Go server returns `null` instead of `[]`)
- **Broken features**: Explorer refresh is a no-op for expanded subdirectories; comments fail to save when parent directories don't exist; `.quipu` file comments don't restore on reopen
- **UX friction**: Bullet spacing is too large; Shift+Enter doesn't submit comments; no raw view mode; no Ctrl+D multi-cursor

## Proposed Solution

Fix all 9 issues in priority order across 5 tiers. Each issue has a clear root cause and targeted fix.

---

## Issue Details

### 🔴 Priority 1 — Data Loss Bugs

#### Issue #9: Excalidraw saving doesn't work

**Root cause**: `editorInstance` in `App.jsx` retains a stale TipTap editor reference when switching to an Excalidraw file. `saveFile(editorInstance)` at [WorkspaceContext.jsx:539](src/context/WorkspaceContext.jsx#L539) checks `if (!editorInstance && activeTab.content)` — since `editorInstance` is truthy (stale ref), it falls through to TipTap serialization instead of writing `activeTab.content`.

**Fix**:
1. In `saveFile` ([WorkspaceContext.jsx:535-577](src/context/WorkspaceContext.jsx#L535-L577)), add a file-type check: if the active file is an Excalidraw file (or any non-TipTap file), bypass the `editorInstance` check and write `activeTab.content` directly
2. In `App.jsx`, null out `editorInstance` when the active file is not a TipTap-rendered file type (e.g., in the `useEffect` that responds to `activeFile` changes)

**Edge cases**:
- User switches between markdown and Excalidraw tabs rapidly — `editorInstance` must update correctly each time
- User has two tabs open (markdown + Excalidraw), edits Excalidraw, then Ctrl+S — save must use the Excalidraw tab's content, not the markdown editor's
- After saving with the wrong path, file watcher could trigger reload with corrupted data

**Acceptance criteria**:
- [ ] Open `.excalidraw` file, draw shapes, Ctrl+S, close tab, reopen — shapes persist
- [ ] Switch between text file and Excalidraw file, save each — correct content saved for both
- [ ] Works in both Electron and browser runtimes

**Files to modify**:
- `src/context/WorkspaceContext.jsx` — `saveFile` function
- `src/App.jsx` — `editorInstance` lifecycle management

#### Issue #1: Empty folder breaks the program

**Root cause**: Go server's `handleListFiles` ([server/main.go:187](server/main.go#L187)) uses `var files []FileEntry` which is a nil slice. `json.Marshal(nil)` produces `null`, not `[]`. Client calls `.map()` on `null` and crashes.

**Fix**:
1. In `server/main.go`, change `var files []FileEntry` → `files := []FileEntry{}` so JSON always marshals to `[]`
2. In `src/services/fileSystem.js` (browser adapter), add a null guard: `return data || []` in `readDirectory`
3. In `FileExplorer.jsx` / `FileTreeItem`, add defensive `(children || []).map(...)` guards

**Edge cases**:
- User creates a new folder via context menu, then immediately expands it — must show empty, not crash
- User deletes all files in a folder via terminal, then navigates to it in explorer
- `loadSubDirectory` returns null for a deleted directory — must not crash

**Acceptance criteria**:
- [ ] Open a workspace containing empty folders — no crash
- [ ] Create a new folder, expand it immediately — shows empty, no crash
- [ ] Delete all files in a folder externally, refresh explorer — shows empty folder
- [ ] Works in both Go server (browser) and Electron runtimes

**Files to modify**:
- `server/main.go` — `handleListFiles` nil slice initialization
- `src/services/fileSystem.js` — null guard in browser `readDirectory`
- `src/components/FileExplorer.jsx` — defensive `.map()` guards

---

### 🟠 Priority 2 — Broken Features

#### Issue #7: Reload explorer doesn't really reload

**Root cause**: `refreshDirectory` ([WorkspaceContext.jsx:221-230](src/context/WorkspaceContext.jsx#L221-L230)) updates `fileTree` (root level) but does NOT increment `directoryVersion`. `FileTreeItem`'s `useEffect` ([FileExplorer.jsx:71-75](src/components/FileExplorer.jsx#L71-L75)) depends on `directoryVersion` to re-fetch expanded subdirectories.

**Fix**: Add `setDirectoryVersion(v => v + 1)` inside `refreshDirectory`.

**Edge cases**:
- After a `git checkout` that changes file structure, refresh should show new tree
- If a subdirectory was deleted externally while expanded, stale children should be cleared
- Consider also pruning `expandedFolders` set for paths that no longer exist (nice-to-have)

**Acceptance criteria**:
- [ ] Create a file via terminal, click refresh — file appears in explorer
- [ ] Delete a file via terminal, click refresh — file disappears from expanded subdirectory
- [ ] Expanded subdirectories re-fetch their contents on refresh

**Files to modify**:
- `src/context/WorkspaceContext.jsx` — `refreshDirectory` function

**Institutional learning**: The `directoryVersion` counter pattern is already documented in [docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md](docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md). Follow the same pattern.

#### Issue #3: Comments not created if folder doesn't exist

**Root cause**: `frameService.ensureFrameDir()` ([src/services/frameService.js:35-42](src/services/frameService.js#L35-L42)) calls `fs.createFolder(dir)` which uses `os.MkdirAll` on Go (handles nested dirs). However, the Electron `write-file` IPC handler ([electron/main.cjs:149-151](electron/main.cjs#L149-L151)) does NOT create parent directories before writing.

**Fix**:
1. In `electron/main.cjs` `write-file` handler, add `await fs.promises.mkdir(path.dirname(filePath), { recursive: true })` before writing
2. In `server/main.go` `handleWriteFile`, add `os.MkdirAll(filepath.Dir(absPath), 0755)` before `os.WriteFile` as a safety net
3. Verify the error handling in `frameService.ensureFrameDir` — the catch block silently swallows all errors, not just "already exists"

**Edge cases**:
- First-ever comment in a brand new workspace (no `.quipu/` directory at all)
- Comment on a deeply nested file: `src/a/b/c/Component.jsx` → `.quipu/meta/src/a/b/c/Component.jsx.frame.json`
- Two comments created rapidly on files in different directories — parallel `mkdir` calls

**Acceptance criteria**:
- [ ] In a workspace with no `.quipu/` directory, add a comment to any file — comment persists after reopen
- [ ] Add a comment to a deeply nested file — FRAME file created with all intermediate directories
- [ ] Works in both Go server and Electron runtimes

**Files to modify**:
- `electron/main.cjs` — `write-file` IPC handler
- `server/main.go` — `handleWriteFile` safety net
- `src/services/frameService.js` — improve error handling in `ensureFrameDir`

#### Issue #8: Comments from .quipu files are not being read

**Root cause**: `.quipu` files store comments inline in TipTap JSON (as `comment` marks with `id` and `comment` attributes). FRAME loading is explicitly skipped for `.quipu` files ([Editor.jsx:444-448](src/components/Editor.jsx#L444-L448)). The round-trip should work: `getJSON()` serializes marks → file saved → `setContent(json)` restores marks → `extractComments(editor)` reads them.

**Investigation needed**: The code path looks correct on paper. Possible failure points:
1. The custom `comment` mark's `addAttributes` may not properly serialize/deserialize `id` and `comment` attrs in JSON mode
2. `extractComments(editor)` may be called before `setContent` completes (timing issue)
3. The mark type may conflict with the `Highlight` extension it extends from

**Fix approach**:
1. Debug with a test `.quipu` file containing comments — inspect the saved JSON to verify marks are present
2. Add logging to `extractComments` to check if marks are found after loading
3. If attrs are missing from JSON, fix the `addAttributes` configuration on the comment mark extension
4. If timing issue, ensure `extractComments` runs after `setContent` via `editor.on('create')` or a `setTimeout`

**Acceptance criteria**:
- [ ] Create a `.quipu` file, add comments, save, close, reopen — comments appear in sidebar
- [ ] Comment text and highlight are both restored correctly
- [ ] Multiple comments on the same file all persist

**Files to modify**:
- `src/components/Editor.jsx` — comment mark extension and/or `extractComments` timing

---

### 🟡 Priority 3 — UX Polish

#### Issue #2: Shift+Enter should submit the comment

**Root cause**: Comment textarea's `onKeyDown` ([Editor.jsx:1010-1018](src/components/Editor.jsx#L1010-L1018)) only checks for `Ctrl+Enter` / `Cmd+Enter`. No Shift+Enter handler.

**Fix**: Add `e.shiftKey && e.key === 'Enter'` as an additional submit trigger.

**Design decision**: Shift+Enter submits (matching issue request). Plain Enter inserts newline (current behavior preserved). This matches comment systems in GitHub, Notion, etc.

**Acceptance criteria**:
- [ ] Shift+Enter submits the comment
- [ ] Ctrl+Enter / Cmd+Enter still works
- [ ] Plain Enter inserts a newline in the textarea
- [ ] Escape still cancels

**Files to modify**:
- `src/components/Editor.jsx` — comment textarea `onKeyDown` handler

#### Issue #4: Space between bullet points should be smaller

**Root cause**: TipTap renders `<li><p>text</p></li>`. The `<p>` inside `<li>` inherits `margin: 0 0 0.75em` from [prosemirror.css:63](src/styles/prosemirror.css#L63), stacking with `<li>` margin of `0.25em 0` ([prosemirror.css:93](src/styles/prosemirror.css#L93)).

**Fix**:
```css
.ProseMirror li > p {
  margin: 0;
}

/* Preserve spacing for multi-paragraph list items */
.ProseMirror li > p + p {
  margin-top: 0.5em;
}
```

**Edge cases**:
- Nested lists (`li > ul > li > p`) — spacing should not collapse entirely
- Multi-paragraph list items — spacing between paragraphs within one `<li>` should be preserved
- Ordered lists — same fix applies

**Acceptance criteria**:
- [ ] Bullet list items have tighter spacing (closer to GitHub/Obsidian rendering)
- [ ] Nested lists maintain reasonable visual hierarchy
- [ ] Multi-paragraph list items still have spacing between paragraphs

**Files to modify**:
- `src/styles/prosemirror.css` — add `li > p` margin override

---

### 🔵 Priority 4 — Investigate & Clarify

#### Issue #5: View mode option — raw / obsidian / rich text

**Current state**: Two modes exist (`richtext` and `obsidian`), toggled via `editorMode` state stored in `localStorage`. The toggle cycles between them ([Editor.jsx:84-94](src/components/Editor.jsx#L84-L94)).

**Proposed approach**: Add a third `raw` mode to the cycle: `richtext → obsidian → raw → richtext`.

**Open design questions**:
1. **Renderer**: Plain `<textarea>` (simplest), CodeMirror (syntax highlighting), or Monaco (full IDE)? **Recommendation**: Start with `<textarea>` with monospace font — minimal viable, can upgrade later.
2. **Editability**: If editable, switching raw → richtext requires re-parsing markdown. TipTap's round-trip is lossy (whitespace normalization). **Recommendation**: Make raw mode read-only initially, with a "copy to clipboard" button.
3. **What "raw" shows per file type**:
   - `.md` → raw markdown source
   - `.quipu` → TipTap JSON (pretty-printed)
   - Code files → same as current (already raw)
   - Excalidraw → JSON source
4. **Mode persistence**: Global (all files) via `localStorage`, matching current behavior.

**Acceptance criteria**:
- [ ] Toggle cycles through three modes: richtext → obsidian → raw
- [ ] Raw mode shows source text in monospace font
- [ ] Mode persists across sessions via localStorage
- [ ] Visual indicator shows current mode

**Files to modify**:
- `src/components/Editor.jsx` — add `raw` to mode cycle, render `<textarea>` or `<pre>` when mode is `raw`
- `src/styles/prosemirror.css` — styling for raw mode container (if needed)

#### Issue #6: Ctrl+D = multiple cursors

**Architectural constraint**: ProseMirror/TipTap uses a single-selection model. Multi-cursor editing is fundamentally not supported and cannot be added without replacing the editor engine.

**Recommendation**: **Defer this issue.** Instead, implement find-and-replace (Ctrl+H) as a future feature, which covers the most common use case (renaming occurrences). If code-file editing with multi-cursor is needed, consider using CodeMirror 6 for code files in a future iteration.

**Acceptance criteria (find-and-replace alternative)**:
- [ ] Document this as a known limitation of TipTap
- [ ] Track find-and-replace as a separate future feature

**Files to modify**: None for now. Add a note to project documentation.

---

## Technical Considerations

### Architecture impacts
- Issue #9 introduces file-type-aware save logic in `WorkspaceContext.saveFile` — this pattern should be generalized for any future non-TipTap editor (code viewer, image editor, etc.)
- Issue #5 adds a third rendering mode, increasing the state space of the editor. The `editorMode` state + file type matrix must be tested thoroughly
- Issue #1 fix touches the Go server API contract — any other endpoints returning slices should be audited for the same nil-slice problem

### Performance implications
- Issue #7 fix causes all expanded subdirectories to re-fetch on refresh. For large trees this could mean many parallel API calls. Consider debouncing or limiting concurrent requests if performance issues arise.

### Security considerations
- Issue #3 creates directories based on user file paths. Both Go (`os.MkdirAll`) and Electron (`fs.mkdir recursive`) must validate that the resulting path stays within the workspace root (path traversal prevention). The existing `safePath` validation in the Go server handles this.

## System-Wide Impact

- **Interaction graph**: Issues #1, #3, #7, #9 all flow through the dual-runtime adapter layer (`src/services/`). Changes to Go server endpoints must be mirrored in Electron IPC handlers.
- **Error propagation**: Issue #3's silent error swallowing in `ensureFrameDir` masks failures. Fix should log errors via `showToast` so users know when comment saving fails.
- **State lifecycle risks**: Issue #9's stale `editorInstance` ref is a class of bug that could recur with any new non-TipTap viewer. The fix should establish a pattern (e.g., always null out `editorInstance` when active file type changes).
- **API surface parity**: Issue #1's nil-slice fix in Go should be audited across all Go endpoints that return arrays (`handleSearch`, `handleGitStatus`, etc.).

## Acceptance Criteria

- [ ] All 7 implementable issues fixed and manually tested
- [ ] Issue #6 documented as known limitation with find-and-replace tracked as alternative
- [ ] Fixes work in both browser (Go server) and Electron runtimes where applicable
- [ ] No regressions in existing file open/save/edit workflows
- [ ] Toast notifications shown for user-facing errors (per CLAUDE.md conventions)

## Success Metrics

- Zero crashes when opening workspaces with empty directories
- Excalidraw files save and restore correctly 100% of the time
- Explorer refresh correctly updates all visible subdirectories
- Comments persist across file close/reopen for both `.md` (FRAME) and `.quipu` (inline JSON) files

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Issue #8 root cause unclear | May require deeper investigation | Start with debug logging; the fix may be simple (timing) or complex (mark serialization) |
| Issue #5 raw→rich round-trip lossy | User confusion when switching modes | Make raw mode read-only initially |
| Issue #7 refresh triggers many API calls | Performance on large trees | Debounce or batch requests if needed |
| Issue #9 fix pattern needed for future viewers | Recurring stale-ref bugs | Establish a clear pattern in `App.jsx` for viewer lifecycle |

## Implementation Order

```
Phase 1 (Critical):  #9 Excalidraw save  →  #1 Empty folder crash
Phase 2 (Features):  #7 Explorer refresh  →  #3 Comment dir creation  →  #8 .quipu comments
Phase 3 (Polish):    #2 Shift+Enter       →  #4 Bullet spacing
Phase 4 (Design):    #5 Raw view mode     →  #6 Ctrl+D (defer/document)
```

## Sources & References

### Internal References
- File explorer version counter pattern: [docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md](docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md)
- Editor mode toggle pattern: [docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md](docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md)
- False dirty state fix: [docs/solutions/ui-bugs/false-dirty-state-on-file-open.md](docs/solutions/ui-bugs/false-dirty-state-on-file-open.md)
- Tailwind v4 + TipTap styling: [docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md](docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md)
- Excalidraw integration: [docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md](docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md)

### Key Files
- `src/context/WorkspaceContext.jsx` — state management, file operations, `saveFile`, `refreshDirectory`
- `src/components/Editor.jsx` — TipTap editor, comment system, view modes
- `src/components/FileExplorer.jsx` — file tree rendering, refresh button
- `src/services/frameService.js` — FRAME annotation persistence
- `src/services/fileSystem.js` — dual-runtime file system adapter
- `server/main.go` — Go HTTP server, `handleListFiles`, `handleWriteFile`
- `electron/main.cjs` — Electron IPC handlers
- `src/styles/prosemirror.css` — TipTap/ProseMirror DOM styles
