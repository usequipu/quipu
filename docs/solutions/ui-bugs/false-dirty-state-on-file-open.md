---
title: Files incorrectly marked dirty on open due to TipTap setContent emitUpdate default
date: 2026-02-28
category: ui-bugs
module: Editor, App
tags:
  - tiptap
  - dirty-state
  - file-loading
  - markdown
  - editor-state
  - setContent
symptoms:
  - Files appear as modified immediately upon opening
  - Dirty indicator shows unsaved changes when no edits were made
  - Affects all file types (most noticeable with markdown)
  - Unnecessary save prompts when closing unedited tabs
root_cause: TipTap setContent defaults to emitUpdate:true, triggering onUpdate which unconditionally marks file as dirty during programmatic loads
fix_type: code-change
complexity: simple
files_changed:
  - src/components/Editor.jsx
---

# Files Incorrectly Marked Dirty on Open

## Problem

When opening any file in the editor, the tab immediately shows a dirty indicator (unsaved changes dot) even though no user edits occurred. This caused:
- Users cannot trust the dirty indicator to reflect actual unsaved changes
- Unnecessary "unsaved changes" prompts when closing tabs that were never edited
- `closeOtherTabs` incorrectly preserving all tabs (since all appeared dirty)

## Root Cause

TipTap's `setContent()` defaults to `{ emitUpdate: true }`, which fires the `onUpdate` callback even during programmatic content loading. The `onUpdate` handler unconditionally calls `setIsDirty(true)`.

**Call chain:**

1. File opened → tab created with `isDirty: false` (`WorkspaceContext.jsx:139`)
2. `useEffect` in `Editor.jsx:118` fires due to `activeTabId` change
3. `editor.commands.setContent(text)` called with no options (`Editor.jsx:151` for markdown)
4. TipTap's `setContent` defaults to `{ emitUpdate: true }` (`@tiptap/core setContent.ts:51`)
5. `tiptap-markdown` intercepts, parses markdown, delegates to original `setContent` with default options
6. TipTap fires `onUpdate` callback (`Editor.jsx:82`)
7. `onContentChange()` called → `handleContentChange` in `App.jsx:119` calls `setIsDirty(true)`
8. Tab shows dirty indicator immediately after opening

**Key insight:** There is zero content comparison in the dirty detection system. `isDirty` is a simple boolean toggled by every `onUpdate` event, including programmatic loads.

## Solution

Add `{ emitUpdate: false }` to all 5 programmatic `setContent` calls in the tab-loading `useEffect` of `src/components/Editor.jsx`.

### Before

```javascript
// Line 122 - Clear editor when no file
editor.commands.setContent('');

// Line 136 - Restore tab snapshot
editor.commands.setContent(activeTab.tiptapJSON);

// Line 144 - Load .quipu JSON
editor.commands.setContent(activeFile.content);

// Line 151 - Load markdown
editor.commands.setContent(text);

// Line 158-161 - Load plain text
editor.commands.setContent({
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
});
```

### After

```javascript
// Line 122 - Clear editor when no file
editor.commands.setContent('', { emitUpdate: false });

// Line 136 - Restore tab snapshot
editor.commands.setContent(activeTab.tiptapJSON, { emitUpdate: false });

// Line 144 - Load .quipu JSON
editor.commands.setContent(activeFile.content, { emitUpdate: false });

// Line 151 - Load markdown
editor.commands.setContent(text, { emitUpdate: false });

// Line 158-161 - Load plain text
editor.commands.setContent({
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
}, { emitUpdate: false });
```

### Why This Is Safe

- `emitUpdate: false` only suppresses the `update` event. `transaction` and `selectionUpdate` events still fire normally.
- `extractComments(editor)` is already called explicitly after `setContent` on lines 137 and 164, so comment extraction is unaffected.
- ProseMirror document state is still updated — only the event notification is suppressed.
- User edits still trigger `onUpdate` normally and correctly mark tabs as dirty.

## Prevention Strategy

**The Rule:** Every `setContent` call that is programmatic (not user-initiated) must include `{ emitUpdate: false }`.

| Scenario | Use `emitUpdate: false`? | Why |
|----------|--------------------------|-----|
| Load file from disk | Yes | Programmatic load, not user action |
| Restore tab snapshot | Yes | Programmatic restore |
| Clear editor (no file) | Yes | Programmatic housekeeping |
| User typing/pasting | No (native) | User action should mark dirty |
| User formatting (bold, italic) | No (native) | User action should mark dirty |

**Code review checklist for future `setContent` calls:**
- Is this called during programmatic content loading? → Add `{ emitUpdate: false }`
- Is there an accompanying `extractComments(editor)` call after?
- Were all file types (.md, .quipu, .txt) tested?

## Testing Checklist

- [ ] Open `.md` file → no dirty indicator
- [ ] Open `.quipu` file → no dirty indicator
- [ ] Open `.txt`/`.js`/other → no dirty indicator
- [ ] Edit file → dirty indicator appears
- [ ] Save → dirty indicator clears
- [ ] Switch tabs → dirty state preserved per tab
- [ ] Close dirty tab → confirm dialog shown
- [ ] Close clean tab → no confirm dialog

## Known Limitations (Not Addressed)

1. **Undo history pollution**: Programmatic `setContent` pushes to undo stack. Ctrl+Z after open clears content. TipTap's `setContent` does not expose `addToHistory` option.
2. **No undo-to-clean detection**: If user edits then undoes all changes, tab still shows dirty. No content comparison exists.
3. **Markdown round-trip normalization**: `tiptap-markdown` may normalize bullet markers, list spacing, whitespace. Opening and saving `.md` without edits may produce whitespace diffs.

## Related

- **Origin brainstorm:** `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md` — Phase 1 markdown round-trip work
- **Prior fix:** `docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md` — Documents the markdown format loss fix (commit `2eada56`)
- **Plan:** `docs/plans/2026-02-28-fix-false-dirty-state-on-file-open-plan.md`
- **TipTap API:** `emitUpdate` option in `@tiptap/core/src/commands/setContent.ts`
