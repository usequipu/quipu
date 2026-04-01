---
title: Bugfix and Polish Sprint — April 2026
type: fix
status: completed
date: 2026-04-01
---

# Bugfix and Polish Sprint — April 2026

## Overview

Updated sprint plan building on [2026-03-25-fix-bugfix-and-polish-sprint-plan.md](2026-03-25-fix-bugfix-and-polish-sprint-plan.md). Several issues from the March plan remain unresolved; three new items added: `.quipu` folder visibility, find-in-document (Ctrl+F), and image paste.

Issues are ordered by severity and implementation simplicity.

---

## Issue Details

### 🔴 Priority 1 — Crashes / Broken Features

#### Issue A: Empty folder still breaks the program

**Root cause**: Go server's `handleListFiles` uses `var files []FileEntry` (nil slice). `json.Marshal(nil)` produces `null`, not `[]`. Client `.map()` call on `null` crashes.

**Fix**:
1. `server/main.go` — change `var files []FileEntry` → `files := []FileEntry{}`
2. `src/services/fileSystem.js` — add null guard: `return data || []` in browser `readDirectory`
3. `src/components/FileExplorer.jsx` — add `(children || []).map(...)` guard

**Acceptance criteria**:
- [ ] Open workspace with empty folder — no crash
- [ ] Create folder, expand immediately — shows empty, no crash
- [ ] Works in both Go server and Electron runtimes

**Files**:
- `server/main.go`
- `src/services/fileSystem.js`
- `src/components/FileExplorer.jsx`

---

#### Issue B: Comments not created on .quipu files

Two sub-problems from the March plan, both still open:

**B1 — FRAME dir not created (for non-.quipu files)**
`frameService.ensureFrameDir()` calls `fs.createFolder(dir)`, but the Electron `write-file` IPC handler does NOT create parent directories before writing.

Fix:
- `electron/main.cjs` — add `await fs.promises.mkdir(path.dirname(filePath), { recursive: true })` before writing
- `server/main.go` `handleWriteFile` — add `os.MkdirAll(filepath.Dir(absPath), 0755)` as safety net

**B2 — .quipu file comments not restored on reopen**
`.quipu` files store comments as inline TipTap JSON marks. The round-trip should work but comments don't appear on reopen. Likely cause: the `comment` mark's `addAttributes` may not serialize/deserialize `id` and `comment` attrs correctly, or `extractComments` is called before `setContent` completes.

Fix approach:
1. Inspect saved `.quipu` JSON — verify comment marks are present with their attrs
2. If attrs missing: fix `addAttributes` on the comment mark extension in `src/components/Editor.jsx`
3. If timing issue: move `extractComments` call to after `editor.on('create')` event

**Acceptance criteria**:
- [ ] First comment in new workspace (no `.quipu/` dir) saves and restores correctly
- [ ] Comment on deeply nested file creates intermediate directories
- [ ] Open `.quipu` file with comments, close, reopen — comments appear in sidebar

**Files**:
- `electron/main.cjs`
- `server/main.go`
- `src/services/frameService.js`
- `src/components/Editor.jsx`

---

#### Issue C: Excalidraw files instantly show as modified

**Root cause**: `ExcalidrawViewer.jsx` skips the first 2 `onChange` calls to filter initialization noise, but Excalidraw fires more events during mount than the hardcoded skip count handles.

**Fix options** (in order of preference):
1. Compare initial serialized JSON to the first emitted content — only mark dirty if they differ
2. Increase skip count from 2 to a larger value (fragile, version-dependent)
3. Add a 500ms initialization window during which `onChange` does not propagate to `onContentChange`

**Acceptance criteria**:
- [ ] Open `.excalidraw` file — dirty indicator does NOT appear immediately
- [ ] Draw a shape, then Ctrl+S — saves correctly
- [ ] Reopen file — shapes persist

**Files**:
- `src/components/ExcalidrawViewer.jsx`

---

### 🟠 Priority 2 — UX Broken / Missing

#### Issue D: Raw view mode not accessible

**Current state**: Raw mode is implemented in `src/components/Editor.jsx` (lines 84–95 for state, lines 999–1008 for render), but it is only accessible via the global `window.__quipuToggleEditorMode()` function or the command palette (`editor.toggleMode`). There is no visible UI toggle.

**Fix**:
1. Expose the three-way mode cycle (`richtext → obsidian → raw`) in the editor toolbar or title bar — a small toggle button cycling through modes
2. Show the current mode as a visual indicator (e.g., a badge or icon in the toolbar)
3. Verify the raw `<pre>` render works for each file type:
   - `.quipu` → pretty-printed TipTap JSON (`JSON.stringify(activeFile.content, null, 2)`)
   - `.md` → raw markdown (`editor.storage.markdown.getMarkdown()`)
   - Others → `activeFile.content` as string

**Acceptance criteria**:
- [ ] Mode toggle button visible in editor UI
- [ ] Clicking cycles through richtext → obsidian → raw
- [ ] Raw mode shows source text for all file types
- [ ] Mode persists in `localStorage` across sessions

**Files**:
- `src/components/Editor.jsx` — verify raw render path
- Where the mode toggle button lives (editor toolbar area)

---

#### Issue E: Reload does not reload file content

**Current state**: The explorer refresh button calls `refreshDirectory` which updates the file tree but does NOT increment `directoryVersion`, so expanded subdirectories don't re-fetch. Additionally, `reloadTabFromDisk` exists in `WorkspaceContext` but is not wired to any keyboard shortcut or button.

**Fix**:
1. `WorkspaceContext.jsx` `refreshDirectory` — add `setDirectoryVersion(v => v + 1)` to force subdirectory re-fetch
2. Wire `reloadTabFromDisk` to a keyboard shortcut (suggest `Ctrl+Shift+R`) and/or a reload button in the editor title bar

**Acceptance criteria**:
- [ ] Create file via terminal → click refresh → file appears in expanded subdirectory
- [ ] Press `Ctrl+Shift+R` → current file reloads from disk
- [ ] File reload clears the dirty indicator

**Files**:
- `src/context/WorkspaceContext.jsx`
- `src/App.jsx` — keyboard shortcut registration
- Editor toolbar or title bar component — reload button

---

#### Issue F: Paste image does not work

**Current state**: Image paste is implemented at `src/components/Editor.jsx` lines 281–296. The `handlePaste` intercepts clipboard `image/*` items and calls `handleImageUpload`. User reports it doesn't work — likely a TipTap v3 API change broke the `editorProps.handlePaste` hook.

**Fix approach**:
1. Verify `editorProps.handlePaste` is still the correct API in TipTap v3 — it may have moved to an extension or the `Editor` constructor config
2. Check that `handleImageUpload` is receiving the file and that `fs.uploadImage` is succeeding
3. If API changed: migrate to the TipTap v3 clipboard API or use a ProseMirror plugin for paste handling
4. Add a `showToast('error', ...)` on failure so it's visible to users

**Acceptance criteria**:
- [ ] Copy image from browser/filesystem, paste into editor — image appears inline
- [ ] Works in both Electron (file://) and browser (Go server URL) runtimes
- [ ] Error toast shown if upload fails

**Files**:
- `src/components/Editor.jsx`

---

### 🟡 Priority 3 — UX Polish

#### Issue G: Space between bullet points is still too large

**Root cause**: TipTap wraps `<li>` content in `<p>` tags. The `<p>` inside `<li>` inherits paragraph margin (`margin: 0 0 0.75em` from prosemirror.css line 63), stacking with the `<li>` margin.

**Fix** (already designed in March plan):
```css
/* src/styles/prosemirror.css */
.ProseMirror li > p {
  margin: 0;
}
.ProseMirror li > p + p {
  margin-top: 0.5em;
}
```

**Acceptance criteria**:
- [ ] Bullet list items have tight spacing
- [ ] Multi-paragraph list items still have spacing between their paragraphs
- [ ] Nested lists maintain visual hierarchy

**Files**:
- `src/styles/prosemirror.css`

---

#### Issue H: .quipu folder is hidden

**Current state**: `.quipu` is in `hiddenDirs` in both `server/main.go` (line 533) and `electron/main.cjs` (line 18), filtering it from file tree and search results.

**User request**: Make it visible in the explorer.

**Trade-off**: The `.quipu/meta/` folder stores FRAME annotation JSON files. Accidental edits/deletions could break comments. Consider making it visible but non-editable, or simply unhiding it.

**Fix (simple approach)**: Remove `.quipu` from `hiddenDirs` in both runtimes. Leave `.git` hidden.

**Acceptance criteria**:
- [ ] `.quipu` folder appears in the file explorer
- [ ] Can navigate into `.quipu/meta/` and see FRAME files
- [ ] `.git` remains hidden

**Files**:
- `server/main.go`
- `electron/main.cjs`

---

### 🔵 Priority 4 — New Feature

#### Issue I: Find in document (Ctrl+F)

**Current state**: Cross-file search (Ctrl+Shift+F via `SearchPanel.jsx`) exists. In-editor find-in-document does not.

**Approach**: Install and configure `@tiptap/extension-search-and-replace` (check availability for TipTap v3 first). Fallback: implement a custom find bar with ProseMirror decorations.

**Design**:
- `Ctrl+F` opens a find bar (floating or docked at the top of the editor area)
- Typing highlights all matches in the document
- `Enter` / `F3` / down arrow jumps to next match
- `Shift+Enter` / up arrow jumps to previous match
- `Escape` closes the find bar and removes highlights
- Match counter shown: "3 of 12"

**Find bar state**: Local to `Editor.jsx` (not in WorkspaceContext — scoped to the editor UI).

**Implementation notes**:
- If `@tiptap/extension-search-and-replace` supports TipTap v3: add to extension list, call `editor.commands.find(term)` / `editor.commands.findNext()`
- If not available: add a ProseMirror plugin that decorates matches using `DecorationSet`
- The find bar overlay should not shift the document layout — use absolute positioning within the editor container

**Acceptance criteria**:
- [ ] `Ctrl+F` opens find bar
- [ ] Typing highlights all matches in document
- [ ] `Enter`/`Shift+Enter` navigate between matches
- [ ] `Escape` dismisses the bar
- [ ] Works in richtext and obsidian modes (not needed for raw mode)
- [ ] Does not interfere with `Ctrl+Shift+F` (cross-file search)

**Files**:
- `src/components/Editor.jsx`
- `src/App.jsx` — register `Ctrl+F` shortcut
- Possibly new `src/components/FindBar.jsx`

---

## Implementation Order

```
Phase 1 (Crashes):  A (empty folder)  →  C (Excalidraw dirty)
Phase 2 (Broken):   B1 (comment dirs)  →  B2 (.quipu comments)  →  E (reload)  →  F (paste image)
Phase 3 (Polish):   G (bullet spacing)  →  H (.quipu visible)  →  D (raw mode UI)
Phase 4 (Feature):  I (find in document)
```

## Technical Considerations

- **Dual runtime**: Issues A, B1, E, F all touch both Go server and Electron — changes to Go endpoints must be mirrored in Electron IPC handlers and service adapters
- **TipTap v3 API**: Issues D, F, I may be blocked by TipTap v3 breaking changes — verify current API before implementing
- **Issue H trade-off**: Unhiding `.quipu` could confuse users who see FRAME JSON files. Consider adding a note in the explorer or leaving it for a settings flag later

## Acceptance Criteria (Sprint)

- [ ] All 9 issues addressed (implemented or explicitly deferred)
- [ ] No crashes when opening workspaces with empty folders
- [ ] Comments persist for both `.quipu` (inline marks) and `.md` (FRAME) files
- [ ] Excalidraw opens without false dirty state
- [ ] Bullet list spacing tightened
- [ ] Raw mode accessible from UI
- [ ] File reload wired to keyboard shortcut
- [ ] Find-in-document implemented

## Sources & References

- Previous sprint plan: [docs/plans/2026-03-25-fix-bugfix-and-polish-sprint-plan.md](2026-03-25-fix-bugfix-and-polish-sprint-plan.md)
- Directory version counter pattern: [docs/solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md](../solutions/ui-bugs/file-creation-explorer-refresh-and-tree-spacing.md)
- False dirty state: [docs/solutions/ui-bugs/false-dirty-state-on-file-open.md](../solutions/ui-bugs/false-dirty-state-on-file-open.md)
- Tailwind + TipTap typography: [docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md](../solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md)
- Excalidraw integration: [docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md](../solutions/feature-implementations/excalidraw-viewer-file-type-routing.md)
- Editor mode toggle: [docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md](../solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md)
- Media/image handling: [docs/solutions/feature-implementations/media-viewer-image-video-support.md](../solutions/feature-implementations/media-viewer-image-video-support.md)

### Key Files
- `src/context/WorkspaceContext.jsx` — state, file ops, reload, refresh
- `src/components/Editor.jsx` — TipTap, comment marks, view modes, paste, find
- `src/components/FileExplorer.jsx` — file tree, refresh
- `src/components/ExcalidrawViewer.jsx` — dirty state logic
- `src/services/frameService.js` — FRAME annotation persistence
- `server/main.go` — Go server, nil slice fix, mkdir safety
- `electron/main.cjs` — IPC handlers, hidden dirs
- `src/styles/prosemirror.css` — list spacing
