---
title: "fix: False dirty state when opening files"
type: fix
status: completed
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# fix: False dirty state when opening files

## Overview

When opening any file (especially noticeable with markdown `.md` files), the tab immediately shows a dirty indicator (unsaved changes dot) even though the user hasn't made any edits. This is a false positive caused by TipTap's `setContent` command firing `onUpdate` during programmatic content loading.

## Problem Statement / Motivation

The dirty indicator is the primary signal telling users they have unsaved work. When every file appears dirty on open, users:
- Cannot trust the dirty indicator to reflect actual unsaved changes
- Get unnecessary "unsaved changes" prompts when closing tabs they never edited
- Experience `closeOtherTabs` incorrectly preserving tabs that shouldn't be kept (since all tabs appear dirty)

This was already partially identified in the editor overhaul brainstorm (see brainstorm: [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md)) as part of Phase 1 markdown round-trip work. The round-trip serialization was fixed in commit `2eada56`, but the false dirty state was not addressed.

## Root Cause Analysis

The call chain that causes the bug:

1. File opened → tab created with `isDirty: false` ([WorkspaceContext.jsx:139](src/context/WorkspaceContext.jsx#L139))
2. `useEffect` in Editor.jsx fires due to `activeTabId` change ([Editor.jsx:118](src/components/Editor.jsx#L118))
3. `editor.commands.setContent(text)` called with **no options** ([Editor.jsx:151](src/components/Editor.jsx#L151) for markdown)
4. TipTap's `setContent` defaults to `{ emitUpdate: true }` (tiptap core `setContent.ts:51`)
5. `tiptap-markdown` extension intercepts, parses markdown, delegates to original `setContent` passing through default options
6. TipTap fires `onUpdate` callback ([Editor.jsx:82](src/components/Editor.jsx#L82))
7. `onContentChange()` is called → `handleContentChange` in [App.jsx:117-121](src/App.jsx#L117-L121) calls `setIsDirty(true)`
8. Tab now shows dirty indicator immediately after opening

**Key insight**: There is **zero content comparison** in the dirty detection system. `isDirty` is a simple boolean toggled by every `onUpdate` event, including programmatic loads. This affects **all file types**, not just markdown.

## Proposed Solution

Pass `{ emitUpdate: false }` to all programmatic `setContent` calls in [Editor.jsx](src/components/Editor.jsx). This tells TipTap to set `preventUpdate` meta on the transaction, suppressing the `onUpdate` event while still updating the document state.

### Five `setContent` calls to modify in `Editor.jsx`:

| Line | Context | Current Code | Fixed Code |
|------|---------|-------------|------------|
| ~122 | Clear editor (no file) | `setContent('')` | `setContent('', { emitUpdate: false })` |
| ~136 | Restore tab snapshot | `setContent(activeTab.tiptapJSON)` | `setContent(activeTab.tiptapJSON, { emitUpdate: false })` |
| ~144 | Load .quipu JSON | `setContent(activeFile.content)` | `setContent(activeFile.content, { emitUpdate: false })` |
| ~151 | Load markdown | `setContent(text)` | `setContent(text, { emitUpdate: false })` |
| ~158 | Load plain text | `setContent({...})` | `setContent({...}, { emitUpdate: false })` |

### Why this is safe

- `emitUpdate: false` only suppresses the `update` event. The `transaction` and `selectionUpdate` events still fire normally.
- `extractComments(editor)` is already called **explicitly** after `setContent` on lines 137 and 164, so comment extraction is not affected.
- The ProseMirror document state is still updated — only the event notification is suppressed.
- Tab dirty state lives in `openTabs` state in WorkspaceContext, not in the editor, so existing dirty flags on other tabs are unaffected.

## Technical Considerations

### What this fix does NOT address (pre-existing limitations)

1. **Undo history pollution**: Programmatic `setContent` pushes to the undo stack. Pressing Ctrl+Z immediately after opening a file will clear the content. TipTap's `setContent` does not expose an `addToHistory` option directly. This should be a separate fix.

2. **Undo-to-clean detection**: If a user edits a file then undoes all changes, the tab still shows dirty. There is no content comparison to detect the document returned to its original state. This is a separate enhancement.

3. **Markdown round-trip normalization**: `tiptap-markdown` may normalize bullet markers (`*` → `-`), list spacing, and whitespace. If content comparison were implemented in the future, it would need to compare against post-parse normalized content, not raw file content.

### Edge cases verified by SpecFlow analysis

| Scenario | Expected Behavior | Status |
|----------|------------------|--------|
| Open new file (any type) | Not dirty | Fixed |
| Switch between tabs | Preserve existing dirty state | Fixed |
| Restore tab from snapshot | Preserve existing dirty state | Fixed |
| User types after opening | Dirty (via normal `onUpdate`) | Unaffected |
| Save file | Dirty cleared (via `setTabDirty`) | Unaffected |
| Close dirty tab | Confirm prompt shown | Unaffected |
| Rapid tab switching | Snapshot may be lost for intermediate tabs | Pre-existing, not worsened |

## Acceptance Criteria

- [x] Opening a `.md` file does not show the dirty indicator
- [x] Opening a `.quipu` file does not show the dirty indicator
- [x] Opening a `.txt`/`.js`/other file does not show the dirty indicator
- [x] Switching between tabs preserves each tab's dirty state correctly
- [x] Typing in the editor still marks the tab as dirty
- [x] Saving clears the dirty indicator
- [x] Closing a dirty tab still shows the confirm dialog
- [x] Comments are still extracted correctly after opening a file

## Success Metrics

- Zero false dirty indicators when opening files
- No regressions in save/close/tab-switch workflows

## MVP

### Editor.jsx

The fix touches only [src/components/Editor.jsx](src/components/Editor.jsx) — add `{ emitUpdate: false }` to all five `setContent` calls in the tab-loading `useEffect` (starting around line 118):

```jsx
// Line ~122: Clear editor when no active file
editor.commands.setContent('', { emitUpdate: false });

// Line ~136: Restore tab from TipTap JSON snapshot
editor.commands.setContent(activeTab.tiptapJSON, { emitUpdate: false });

// Line ~144: Load .quipu file (JSON content)
editor.commands.setContent(activeFile.content, { emitUpdate: false });

// Line ~151: Load markdown file
editor.commands.setContent(text, { emitUpdate: false });

// Line ~158: Load plain text file
editor.commands.setContent({
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
}, { emitUpdate: false });
```

## Dependencies & Risks

- **Low risk**: The fix is a single option flag on existing API calls
- **No new dependencies**: Uses existing TipTap API
- **Backwards compatible**: No changes to data formats, state shape, or component interfaces
- **Positive side effect**: `closeOtherTabs` will now correctly close non-dirty tabs (previously kept all tabs since all appeared dirty)

## Future Work (Separate Issues)

1. **Undo history cleanup**: Clear undo history after programmatic `setContent` to prevent Ctrl+Z from clearing document content
2. **Content-comparison dirty detection**: Compare current document state against a stored "clean" baseline so undo-to-original clears the dirty flag
3. **Markdown round-trip fidelity**: Ensure `tiptap-markdown` parse/serialize preserves original formatting as closely as possible

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — Phase 1 markdown round-trip fix identified the serialization issue; this plan addresses the remaining dirty state bug
- **Prior solution:** [docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md](docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md) — Documents the markdown format loss fix (commit `2eada56`)
- **TipTap `setContent` API:** `emitUpdate` option documented in `@tiptap/core/src/commands/setContent.ts`
- **Related commit:** `2eada56 feat(editor): fix markdown round-trip save with tiptap-markdown`
