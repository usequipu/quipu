---
title: "feat: PDF commenting, CodeViewer cursor fix, auto-reopen last workspace"
type: feat
status: completed
date: 2026-04-02
deepened: 2026-04-02
---

# PDF Commenting, CodeViewer Cursor Fix, Auto-Reopen Last Workspace

## Overview

Three changes: (1) Enable text-selection-based commenting on PDF files, with its own comment sidebar inline in PdfViewer, reusing the existing FRAME sidecar system. (2) Fix the CodeViewer cursor misalignment caused by a hardcoded textarea `paddingLeft` that doesn't match the dynamic line-number gutter width. (3) Auto-reopen the last workspace on app launch in both Electron and browser modes.

## Problem Frame

**PDF commenting:** The editor supports commenting on markdown and `.quipu` files via TipTap marks + FRAME sidecar storage. PDF files are view-only with no annotation capability. Users want to comment on PDFs the same way they comment on markdown — select text, add a comment, see it in a sidebar — without modifying the PDF itself.

**Auto-reopen workspace:** On app launch, only Electron mode auto-opens the last workspace. Browser mode always starts with the folder picker, even though it has the same `recentWorkspaces` storage via localStorage. The `isElectronRuntime()` guard at `WorkspaceContext.jsx:105` unnecessarily restricts this to Electron.

**Cursor misalignment:** The CodeViewer overlays a transparent `<textarea>` on a syntax-highlighted `<pre>`. The textarea's `paddingLeft` is hardcoded to `3.5rem`, but the line-number gutter width is dynamic (depends on digit count). This causes the cursor to appear ~1 character off from the highlighted text beneath it, worsening as line count grows.

## Requirements Trace

### PDF Commenting
- R1. Users can select text on a PDF page and add a comment anchored to that selection
- R2. PDF comments persist via the existing FRAME sidecar system and reload on file reopen
- R3. Comments filter by current page — navigating pages shows only that page's comments
- R4. Comments can be resolved (deleted) the same way as markdown comments
- R5. The comment sidebar UI is visually consistent with the markdown comment experience
- R7. No modifications to the PDF file itself

### Auto-Reopen Workspace
- R8. On app launch, automatically reopen the last workspace in both Electron and browser modes

### CodeViewer
- R6. The CodeViewer cursor aligns precisely with the highlighted text at all line counts

## Scope Boundaries

- No PDF text editing or annotation embedding (PDF remains read-only)
- No point/sticky-note commenting — text selection only
- No multi-page comment indicator badges (future polish)
- No orphaned comment recovery when PDF content changes (comments persist but may not re-anchor)
- No changes to the TipTap-based comment system for markdown/quipu files (those continue unchanged)
- No shared CommentSidebar extraction — PdfViewer gets its own inline comment UI (extract later if convergence is proven)

## Context & Research

### Relevant Code and Patterns

- `src/components/PdfViewer.jsx` — current PDF viewer (104 lines, read-only, react-pdf with TextLayer)
- `src/components/Editor.jsx` — comment system lives here: comment mark extension (~lines 273-315), `extractComments()` (~line 620), `addComment()` (~line 716), `resolveComment()` (~line 753), comment sidebar JSX (~lines 1075-1148), overlap prevention effect (~lines 589-618)
- `src/services/frameService.js` — FRAME sidecar storage with `addAnnotation()`, `removeAnnotation()`, `readFrame()`, `watchFrames()`. Note: `addAnnotation` explicitly destructures and lists fields in the push — new fields must be added to both the destructure and the pushed object
- `src/components/CodeViewer.jsx` — transparent textarea over highlighted `<pre>`, hardcoded `paddingLeft: 3.5rem` at line 163
- Viewer routing chain in `App.jsx` (~lines 682-696): `isPdf → PdfViewer`, `isCodeFile → CodeViewer`, default → `Editor`

### Institutional Learnings

- **Media viewer pattern** (`docs/solutions/feature-implementations/media-viewer-image-video-support.md`): PDF files use `fs.getFileUrl(filePath)` for URL-based rendering; never load binary content into JS memory. Tab already has `isPdf: true` flag.
- **Comment system** (`docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md`): Interactive elements near the editor must use `onMouseDown={preventDefault}` to prevent focus theft. Comment submission uses Ctrl+Enter / Escape.
- **Code viewer layout** (`docs/solutions/feature-implementations/syntax-highlighted-code-viewer-component.md`): Line numbers and content must use identical `leading-6`. The 816px centered page container with responsive breakpoints is the established layout for all viewers.
- **Tailwind v4 resets** (`docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md`): react-pdf's TextLayer generates its own DOM; Tailwind's preflight may affect it. Already mitigated by importing `react-pdf/dist/Page/TextLayer.css`.

## Key Technical Decisions

- **Text-selection anchoring for PDFs**: Store `{ page, selectedText, occurrence }` in FRAME annotations. `occurrence` is the nth match of `selectedText` on that page (determined by DOM ordering of TextLayer `<span>` elements — walk spans in document order, count substring matches, identify which match contains the selection range). More resilient to minor PDF re-exports than character offset ranges.
- **No shared CommentSidebar extraction (yet)**: The comment sidebar in Editor.jsx is coupled to TipTap's coordinate system (`coordsAtPos`, mark-based positioning). PdfViewer needs a fundamentally different positioning model (TextLayer DOM rect-based, `scale`-dependent). Duplicating the ~75 lines of sidebar JSX in PdfViewer is simpler and safer than extracting a premature abstraction. Extract into a shared component later if both converge.
- **Comment highlight via overlay divs**: TextLayer spans are rendered by react-pdf and lost on re-render (page nav, zoom). Rather than mutating TextLayer DOM directly, position semi-transparent overlay `<div>`s using `getBoundingClientRect()` of matched TextLayer spans. Recalculate on zoom/page change.
- **Dynamic gutter measurement for CodeViewer**: Use a ref + `useLayoutEffect` to measure the line-number gutter's `offsetWidth` rather than calculating mathematically. Handles font loading edge cases and is always accurate.
- **FRAME schema extension**: Modify `addAnnotation()` to explicitly destructure and push `page`, `selectedText`, and `occurrence` fields alongside existing `line` field. Backward-compatible — existing annotations without `page` are markdown annotations.

## Open Questions

### Resolved During Planning

- **Text selection vs sticky notes?** Text selection — confirmed by user. Consistent with markdown commenting UX.
- **Shared component vs duplicate UI?** Duplicate for now. The Editor uses TipTap `coordsAtPos` for positioning; PdfViewer uses TextLayer DOM rects. Different enough to warrant separate implementations. Extract later if convergence is proven.
- **Ref-based vs math-based gutter width?** Ref-based — handles async font loading and is inherently accurate.
- **How to highlight commented text in PDFs?** Overlay `<div>`s positioned via `getBoundingClientRect()` of TextLayer spans, not direct DOM mutation. Survives re-renders.

### Deferred to Implementation

- **TextLayer selection stability across zoom changes**: react-pdf re-renders the TextLayer on zoom. Whether `window.getSelection()` produces stable text content across renders needs to be verified during implementation. If unstable, may need to capture selection before zoom and re-apply after.
- **Exact sidebar positioning formula for dynamic PDF page widths**: The sidebar position depends on the rendered page width (which scales with the `scale` state). The implementer should compute sidebar `left` from the `<Page>` element's actual rendered width, not a hardcoded value. Add `scale` as a dependency in the positioning effect so comments reposition on zoom.

## Implementation Units

- [ ] **Unit 1: PDF text-selection commenting**

**Goal:** Users can select text on a PDF page, click a comment button, type a comment, and see it in a sidebar. Comments persist via FRAME and reload on file reopen. Includes FRAME schema extension and wiring `workspacePath` into PdfViewer.

**Requirements:** R1, R2, R3, R4, R5, R7

**Dependencies:** None

**Files:**
- Modify: `src/components/PdfViewer.jsx` (main work — selection capture, comment UI, FRAME integration, highlight overlays)
- Modify: `src/services/frameService.js` (extend `addAnnotation` to accept and persist `page`, `selectedText`, `occurrence`)
- Modify: `src/App.jsx` (only if PdfViewer needs new props — check if `useWorkspace()` is available directly)

**Approach:**

*FRAME schema extension (~3 lines in `frameService.js`):*
- In `addAnnotation()` at line 77, add `page, selectedText, occurrence` to the destructured parameters
- Add those same fields to the object pushed into `frame.annotations` (currently line 81-87 explicitly lists `id, line, text, type, author, timestamp` — the new fields must be added here too, or they will be silently dropped)
- Existing callers passing `{ line, text }` are unaffected — new fields are optional

*PdfViewer commenting:*
- Access `workspacePath` via `useWorkspace()` hook (same pattern as other components)
- Add state: `comments` array, `showCommentInput`, `commentText`, `commentInputTop`, `selectedTextInfo` (captured selection data)
- **Selection capture**: Listen for `mouseup` on the PDF `<Page>` container. Use `window.getSelection()` to get selected text. If non-empty, show a floating "Comment" button near the selection
- **Occurrence computation**: Walk TextLayer `<span>` elements in DOM order within the current page. For each span whose text contains the selected text as a substring, increment a counter. The occurrence index is which match contains the user's actual selection range
- **Comment submission**: Call `frameService.addAnnotation(workspacePath, filePath, { page: pageNumber, selectedText, occurrence, text: commentText, type: 'review', author: 'user' })`
- **Comment loading**: On mount and when `pageNumber` changes, call `frameService.readFrame()` and filter to `annotation.page === pageNumber`. Use `useMemo` for filtering
- **Comment positioning**: For each comment on the current page, find the matching TextLayer text by walking spans (same occurrence logic), get `getBoundingClientRect()` relative to the page container element, use the `top` coordinate for sidebar card positioning. Recompute when `scale` changes (add `scale` as a dependency)
- **Highlight overlays**: For each comment, render an absolutely-positioned semi-transparent `<div>` over the matched TextLayer span area using the same `getBoundingClientRect()` data. These overlays are children of the page container (not mutations of TextLayer DOM), so they survive re-renders
- **Comment sidebar**: Inline JSX in PdfViewer (modeled after Editor's sidebar at ~lines 1075-1148). Position to the right of the rendered PDF page. The `left` value should be computed from the `<Page>` element's actual `offsetWidth`, not hardcoded
- **Overlap prevention**: Same algorithm as Editor (~lines 589-618): sort by top position, push cards down if they would overlap (16px gap)
- **Scroll container awareness**: The comment sidebar cards must be children of the scrolling container (not absolutely positioned relative to the viewport), so they scroll with the PDF page

**Patterns to follow:**
- `useCallback` for all handlers
- `useMemo` for derived state (filtered comments per page)
- Fire-and-forget pattern for FRAME syncs: `.catch((err) => console.warn(...))`
- `onMouseDown={preventDefault}` on comment UI elements to prevent selection loss
- Comment input keyboard shortcuts: Ctrl+Enter / Shift+Enter to submit, Escape to cancel

**Test scenarios:**
- Happy path: Open PDF → select text on page 1 → click Comment → type text → Ctrl+Enter → comment card appears in sidebar, text area highlighted
- Happy path: Close and reopen the PDF → comments load from FRAME → correct comments show on the right pages
- Happy path: Navigate to page 2 → page 1 comments disappear, page 2 comments (if any) appear
- Happy path: Navigate back to page 1 → page 1 comments reappear with correct positioning
- Happy path: Resolve a comment → removed from sidebar, highlight removed, FRAME updated
- Happy path: Call `frameService.addAnnotation` with `{ line: 5, text: "bar" }` (existing markdown format) → existing behavior unchanged, new fields are simply absent
- Edge case: Select text that appears multiple times on the same page → `occurrence` field correctly identifies the nth instance via DOM-order span walk
- Edge case: Zoom in/out → comment sidebar and highlights reposition (effect has `scale` dependency)
- Edge case: Select text, then navigate to another page before submitting → comment input should dismiss (clear selection state on page change)
- Edge case: No text selected, mouseup fires → no comment button appears
- Error path: FRAME write fails → `console.warn`, comment still appears in local state for current session
- Integration: Multiple comments on the same page → overlap prevention pushes cards down with 16px gap

**Verification:**
- Comments persist across PDF close/reopen cycles
- Comments are page-specific — only current page's comments visible
- PDF file itself is never modified (verify no write calls to the PDF path)
- Comment UX (sidebar, input, keyboard shortcuts) matches the markdown commenting experience
- Existing markdown/quipu comment save/load works identically (FRAME change is backward-compatible)

---

- [ ] **Unit 2: Fix CodeViewer cursor alignment**

**Goal:** The cursor in the CodeViewer aligns exactly with the highlighted text beneath it, regardless of line count.

**Requirements:** R6

**Dependencies:** None (independent of PDF commenting work)

**Files:**
- Modify: `src/components/CodeViewer.jsx`

**Approach:**
- Add a `ref` to the line-number gutter div (line 129)
- Add a `gutterWidth` state variable
- Use `useLayoutEffect` triggered by `lineCount` to measure the gutter's `offsetWidth` and update `gutterWidth`
- Replace the hardcoded `paddingLeft: '3.5rem'` on the textarea (line 163) with dynamic value: `paddingLeft: gutterWidth ? `${gutterWidth + 8}px` : '3.5rem'` — the `+ 8` accounts for the `<pre>`'s `pl-2` (0.5rem = 8px) padding
- Keep `3.5rem` as initial fallback before measurement; `useLayoutEffect` fires synchronously before paint so there should be no flash

**Patterns to follow:**
- Existing ref pattern in CodeViewer: `highlightRef`, `textareaRef`
- `useLayoutEffect` for DOM measurements that affect layout

**Test scenarios:**
- Happy path: Open a file with < 10 lines → cursor aligns with text (1-digit gutter)
- Happy path: Open a file with 100+ lines → cursor aligns with text (3-digit gutter)
- Happy path: Open a file with 1000+ lines → cursor aligns with text (4-digit gutter)
- Edge case: Click at end of a long line (80+ chars) → cursor still aligned horizontally
- Edge case: Type characters → inserted text appears at cursor position without drift
- Happy path: Resize window past responsive breakpoints → alignment maintained

**Verification:**
- Cursor visually overlaps the corresponding character position in the highlighted layer at all line counts
- No visible horizontal offset between cursor and text

---

- [ ] **Unit 3: Auto-reopen last workspace on launch (both runtimes)**

**Goal:** The app reopens the last workspace on launch in both Electron and browser modes, eliminating the folder picker on every browser-mode startup.

**Requirements:** R8

**Dependencies:** None (independent of other units)

**Files:**
- Modify: `src/context/WorkspaceContext.jsx` (line 105 — remove `isElectronRuntime()` guard)

**Approach:**
- In the mount effect at line 100-120, change `if (isElectronRuntime() && recent.length > 0)` to `if (recent.length > 0)`
- The storage layer already works in browser mode (localStorage via `storageService.js`) and `recentWorkspaces` is already persisted on folder selection via `updateRecentWorkspaces()`
- The `validateAndPruneWorkspaces()` call at line 118 already handles stale paths gracefully
- Browser mode's Go server auto-detects workspace on first `/files` request (line 168-172 of `server/main.go`), so reading the directory will also set the server's `workspaceRoot`

**Patterns to follow:**
- Existing error handling pattern: show warning toast if last workspace path no longer exists (line 113)

**Test scenarios:**
- Happy path: Open browser mode → select a folder → close app → reopen → last folder auto-opens without folder picker
- Happy path: Open Electron mode → select a folder → close → reopen → still auto-opens (existing behavior preserved)
- Edge case: Last workspace was deleted between sessions → warning toast shown, folder picker appears
- Edge case: No recent workspaces (first launch) → folder picker shown as before
- Edge case: localStorage cleared → folder picker shown as before

**Verification:**
- Browser mode launches directly into the last workspace without showing folder picker
- Electron behavior unchanged
- Stale workspace paths handled gracefully with warning toast

## System-Wide Impact

- **Interaction graph:** `PdfViewer` gains FRAME integration (read/write sidecar files). `frameService.addAnnotation()` gains new optional parameters (`page`, `selectedText`, `occurrence`).
- **Error propagation:** FRAME write failures are fire-and-forget with `console.warn` — same pattern as Editor. No new error surfaces.
- **State lifecycle risks:** PDF page navigation must filter comment state per page. Zoom changes must trigger comment/highlight repositioning (add `scale` as effect dependency). Comment sidebar cards must scroll with the PDF page content, not float relative to the viewport.
- **API surface parity:** The FRAME schema extension is additive and backward-compatible. Existing `addAnnotation` callers pass `{ line, text }` — new fields are optional and default to `undefined`.
- **Unchanged invariants:** The TipTap-based comment system in `Editor.jsx` is untouched. CodeViewer changes are isolated to cursor positioning — no behavior changes to editing or syntax highlighting.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| react-pdf TextLayer text selection may be unreliable across zoom levels | Capture selection text before zoom; re-anchor using text matching after re-render. Add `scale` as dependency in positioning effect |
| Duplicate text on same PDF page makes `occurrence` counting fragile | Walk TextLayer spans in DOM order to determine occurrence index; acceptable for v1 |
| TextLayer DOM mutations by react-pdf on re-render invalidate highlight overlays | Use overlay `<div>`s positioned via getBoundingClientRect, not direct span mutation. Recalculate overlays on page/zoom change |
| `addAnnotation` destructuring silently drops unknown fields | Explicitly add `page`, `selectedText`, `occurrence` to both destructure and pushed object — this is a known gotcha in the current code |
| `useLayoutEffect` gutter measurement may flash on first render | Keep `3.5rem` as fallback; `useLayoutEffect` fires synchronously before paint |

## Sources & References

- Related code: `src/components/Editor.jsx` (comment system), `src/components/PdfViewer.jsx`, `src/components/CodeViewer.jsx`, `src/services/frameService.js`
- Institutional learnings: `docs/solutions/feature-implementations/media-viewer-image-video-support.md`, `docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md`, `docs/solutions/feature-implementations/syntax-highlighted-code-viewer-component.md`
