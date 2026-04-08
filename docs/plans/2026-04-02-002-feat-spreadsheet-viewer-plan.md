---
title: "feat: Embedded spreadsheet viewer/editor with SheetJS + Univer"
type: feat
status: active
date: 2026-04-02
deepened: 2026-04-02
---

# Embedded Spreadsheet Viewer/Editor with SheetJS + Univer

## Overview

Add a new viewer type that renders `.xlsx` and `.csv` files as an interactive spreadsheet using Univer for rendering/editing and SheetJS for file I/O. Binary write already exists via `uploadImage`; only a `readFileBinary` method is needed for reading xlsx files.

## Problem Frame

The editor supports markdown, code, PDF, Excalidraw, and Mermaid files — but spreadsheets open as raw text or fail to load. Users want to view and edit `.xlsx` files in a real spreadsheet UI (cells, formulas, formatting) without leaving the app, and save changes back to the original file.

## Requirements Trace

- R1. `.xlsx` files open in a spreadsheet editor with cells, formulas, and basic formatting
- R2. `.csv` files open in the same spreadsheet editor (parsed as tabular data)
- R3. Changes can be saved back to the original file format (Ctrl+S)
- R4. Binary `.xlsx` files are read and written without corruption in both Electron and browser runtimes
- R5. The spreadsheet viewer follows the established viewer pattern (file type detection, tab flag, routing, dirty state)
- R6. Univer is lazy-loaded to avoid impacting startup time
- R7. Works in both Electron desktop and browser (Go server) modes

## Scope Boundaries

- No chart/graph rendering (neither SheetJS nor Univer support embedded chart objects)
- No `.xls` (legacy binary format) or `.ods` in v1 — only `.xlsx` and `.csv`
- No real-time collaboration or multi-user editing
- No formula bar or advanced Excel features beyond what Univer's open-source core provides
- No FRAME/comment integration for spreadsheets in v1
- No printing or PDF export from the spreadsheet view

## Context & Research

### Relevant Code and Patterns

- **Viewer routing chain**: `src/App.jsx` (~line 681-715) — cascading ternary, add new branch before Excalidraw
- **File type detection**: `src/utils/fileTypes.js` — add `isSpreadsheetFile()`, update `getViewerType()`
- **Tab creation**: `src/context/WorkspaceContext.jsx` `openFile()` (~line 423) — add `isSpreadsheet` flag, guard before `readFile()` for xlsx
- **Save path**: `src/context/WorkspaceContext.jsx` `saveFile()` (~line 539) — non-TipTap branch writes `tab.content`
- **Excalidraw viewer**: `src/components/ExcalidrawViewer.jsx` — best template for wrapping an opinionated library
- **File system service**: `src/services/fileSystem.js` — dual-runtime adapter

### Existing Binary I/O Infrastructure

**Binary write already exists** via `uploadImage`:
- Electron: `upload-image` IPC handler at `electron/main.cjs:211` — accepts base64, decodes to Buffer, writes binary
- Go server: `/upload` endpoint — accepts base64 in JSON, decodes and writes
- Service adapter: `uploadImage(filePath, base64Data)` at `src/services/fileSystem.js:119`

**Binary read partially exists**:
- Electron: `fs.promises.readFile(path)` without encoding returns a Buffer — just need a new IPC handler (3 lines)
- Go server: `GET /file?path=...` already serves raw bytes — browser adapter just needs to call `res.arrayBuffer()` instead of `res.text()`

**Only `readFileBinary` is truly new.** Binary write can reuse or wrap the existing `uploadImage` infrastructure.

### Institutional Learnings

- **Excalidraw viewer routing** (`docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md`): Canonical 5-step pattern for adding a viewer type.
- **Media viewer binary handling** (`docs/solutions/feature-implementations/media-viewer-image-video-support.md`): Binary files must never be read via `readFile()`. Guard in `openFile()` must come before `readFile()`.
- **Code viewer bundle optimization** (`docs/solutions/feature-implementations/syntax-highlighted-code-viewer-component.md`): Import only core library. Consider `React.lazy()` for heavy viewers.

## Key Technical Decisions

- **SheetJS for file I/O, Univer for rendering**: SheetJS parses xlsx/csv to a workbook object, which is converted to Univer's data format. On save, Univer's data is converted back and written via SheetJS.
- **Reuse `uploadImage` for binary write**: The existing `uploadImage(path, base64)` already handles base64→binary write in both runtimes. For xlsx save, call this directly (or add a thin alias `writeFileBinary`).
- **Add `readFileBinary` for binary read**: Electron: new IPC handler that reads without encoding and returns base64. Browser: modify to use `res.arrayBuffer()` on the existing `/file` endpoint. Minimal new code.
- **CSV uses existing text I/O**: `.csv` files are plain text — SheetJS parses from a string directly.
- **Lazy-load Univer**: `React.lazy()` + `Suspense` to keep Univer's ~3-5MB out of initial bundle.
- **Tab stores serialized workbook data**: On open, xlsx is parsed by SheetJS and stored as Univer JSON on the tab. On save, converted back to xlsx binary. Follows the Excalidraw pattern.

## Open Questions

### Resolved During Planning

- **Which formats?** `.xlsx` + `.csv` for v1.
- **Binary write infrastructure?** Already exists via `uploadImage`. Only `readFileBinary` is new.
- **Bundle size?** Lazy loading via `React.lazy()`. Precedent: Excalidraw (~2-3MB) already bundled.

### Deferred to Implementation

- **Univer package versions and React 19 compatibility**: Verify during `npm install`.
- **Vite configuration for Univer**: May need polyfills or `optimizeDeps` config.
- **SheetJS → Univer data format conversion**: The exact mapping will be determined during implementation. This is the primary technical risk.
- **Univer teardown/cleanup**: Whether mounting/unmounting creates memory leaks needs runtime verification.

## Implementation Units

- [ ] **Unit 1: Binary read + dependencies + file type routing**

**Goal:** Add `readFileBinary` to the service layer, install SheetJS + Univer, add file type detection and viewer routing with a stub SpreadsheetViewer.

**Requirements:** R4, R5, R6, R7

**Dependencies:** None

**Files:**
- Modify: `electron/main.cjs` (add `read-file-binary` IPC handler — read without encoding, return base64)
- Modify: `electron/preload.cjs` (expose `readFileBinary` via contextBridge)
- Modify: `src/services/fileSystem.js` (add `readFileBinary()` to both adapters. Browser: use `res.arrayBuffer()` on existing `/file` endpoint. Add `writeFileBinary` as thin wrapper around `uploadImage`)
- Modify: `src/utils/fileTypes.js` (add `isSpreadsheetFile()`, update `getViewerType()`)
- Modify: `src/context/WorkspaceContext.jsx` (add `isSpreadsheet` detection in `openFile()`, guard before `readFile()` for xlsx, add to `isNonTipTapFile` check in `saveFile()`)
- Modify: `src/App.jsx` (add routing branch, lazy-load SpreadsheetViewer import)
- Modify: `package.json` (add `@univerjs/presets` or individual Univer packages, `xlsx`)
- Modify: `vite.config.js` (if Univer needs specific config)
- Create: `src/components/SpreadsheetViewer.jsx` (stub — loading placeholder)

**Approach:**
- **`readFileBinary` (Electron)**: New IPC handler: `fs.promises.readFile(path)` (no encoding = Buffer), return `buffer.toString('base64')`
- **`readFileBinary` (Browser)**: Call existing `GET /file?path=...` with `res.arrayBuffer()`, convert to base64 via `btoa(String.fromCharCode(...new Uint8Array(buffer)))`
- **`writeFileBinary`**: Thin wrapper around existing `uploadImage(path, base64)` — same mechanism, clearer name for non-image use
- **No new Go endpoint needed** — existing `GET /file` serves raw bytes, existing `/upload` writes binary
- **File detection**: `isSpreadsheetFile(name)` checks `/\.(xlsx|csv)$/i`
- **Tab creation**: xlsx → `content: null`, `isSpreadsheet: true` (guard before `readFile`). csv → read as text, `isSpreadsheet: true`
- **Routing**: `activeTab?.isSpreadsheet` before Excalidraw in ternary chain
- **Lazy load**: `React.lazy(() => import('./components/SpreadsheetViewer'))` with `<Suspense>`
- **Dependencies**: `npm install @univerjs/presets xlsx`. Verify `npm run dev` and `npm run build` work.

**Patterns to follow:**
- `uploadImage` implementation in `fileSystem.js:119` for binary write pattern
- PDF/media detection in `openFile()` at `WorkspaceContext.jsx:423`
- Excalidraw routing pattern in `App.jsx`

**Test scenarios:**
- Happy path: `readFileBinary()` on an xlsx file → returns valid base64 → decode matches original bytes
- Happy path: `writeFileBinary()` with base64 data → file is byte-identical to original
- Happy path: Open `.xlsx` → tab has `isSpreadsheet: true`, `content: null`, no UTF-8 corruption
- Happy path: Open `.csv` → tab has `isSpreadsheet: true`, content is raw text
- Happy path: SpreadsheetViewer stub renders when tab is active
- Happy path: `npm run dev` and `npm run build` succeed with new dependencies
- Edge case: Open `.XLSX` (uppercase) → still detected
- Edge case: Non-spreadsheet files → Univer bundle not loaded
- Integration: Read xlsx binary → base64 → write back → file byte-identical (round-trip)

**Verification:**
- Binary xlsx round-trip works in both runtimes
- Spreadsheet files route to stub viewer
- Existing viewers unaffected
- Univer chunk is separate in production build

---

- [ ] **Unit 2: SpreadsheetViewer with Univer rendering and editing**

**Goal:** Full spreadsheet viewer that loads xlsx/csv files into Univer, renders an interactive spreadsheet, detects edits, and reports content changes for dirty state.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1 (binary I/O, dependencies, routing)

**Files:**
- Modify: `src/components/SpreadsheetViewer.jsx` (replace stub with full implementation)

**Approach:**

*Loading flow:*
- **xlsx**: Call `readFileBinary(filePath)` → decode base64 to ArrayBuffer → `XLSX.read(arrayBuffer)` → convert SheetJS workbook to Univer data format → init Univer with data
- **csv**: Receive `content` prop (text from tab) → `XLSX.read(content, { type: 'string' })` → same conversion → Univer init

*Univer initialization:*
- Create Univer instance in `useEffect` on mount, mount into a container div via ref
- Apply sheets plugin and UI plugin
- Load converted workbook data
- Register change listener → call `onContentChange` with serialized data → triggers dirty state

*Cleanup:*
- On unmount, **flush any pending debounced changes synchronously** (cancel debounce timer, fire `onContentChange` with current state) before disposing — prevents data loss on rapid tab switch
- Dispose Univer instance to prevent memory leaks
- Clear change listener

*Styling:*
- Import Univer CSS at top of component
- Container div fills available space (`flex-1 overflow-hidden`)
- If CSS conflicts with Tailwind, scope with a wrapper class

**Patterns to follow:**
- ExcalidrawViewer: opinionated library init in `useEffect`, cleanup on unmount, `onContentChange` for dirty state
- `useWorkspace()` for `workspacePath`, `useCallback` for all handlers

**Test scenarios:**
- Happy path: Open `.xlsx` with multiple sheets → renders cells, formulas show computed values
- Happy path: Open `.csv` → renders as single-sheet spreadsheet
- Happy path: Edit a cell → dirty indicator appears on tab
- Happy path: Switch between spreadsheet and markdown tabs → both render correctly
- Edge case: Open empty xlsx → renders empty grid, no crash
- Edge case: Open large xlsx (1000+ rows) → renders with virtual scrolling
- Edge case: Tab switch away and back → state preserved from tab content
- Edge case: Merged cells, bold text, colored cells → basic formatting visible
- Error path: Corrupt xlsx → SheetJS parse error → error message, no crash

**Verification:**
- xlsx and csv files render with correct cell data
- Edits trigger dirty state
- No memory leaks on tab close (Univer disposed)
- Works in both Electron and browser modes

---

- [ ] **Unit 3: Save integration (xlsx binary + csv text)**

**Goal:** Ctrl+S correctly saves spreadsheet files — xlsx via binary write, csv via text write. Full round-trip works.

**Requirements:** R3, R4

**Dependencies:** Unit 2 (viewer stores content on tab via `onContentChange`)

**Files:**
- Modify: `src/context/WorkspaceContext.jsx` (`saveFile()` — add spreadsheet binary save branch)
- Modify: `src/components/SpreadsheetViewer.jsx` (serialize Univer state for save: xlsx → base64 via SheetJS, csv → text)

**Approach:**
- **SpreadsheetViewer `onContentChange`**: When user edits, serialize Univer's current state back to SheetJS workbook. For xlsx: `XLSX.write(workbook, { type: 'base64' })` → pass to `onContentChange`. For csv: `XLSX.utils.sheet_to_csv(sheet)` → pass to `onContentChange`.
- **`saveFile()` in WorkspaceContext**: In the non-TipTap branch, check `activeTab.isSpreadsheet`. If xlsx extension: call `writeFileBinary(path, tab.content)`. If csv: use existing `writeFile(path, tab.content)`.
- After save, clear dirty state (existing pattern)

**Patterns to follow:**
- Excalidraw save path in `saveFile()` (~line 543)
- `isNonTipTapFile` check pattern

**Test scenarios:**
- Happy path: Edit xlsx cell → Ctrl+S → reopen → edit persisted, file valid xlsx
- Happy path: Edit csv → Ctrl+S → reopen → edit persisted, valid csv text
- Happy path: Save xlsx in browser mode → Go server write → file valid
- Edge case: Save with no changes → no write, no error
- Error path: Binary write fails → toast error, dirty state preserved
- Integration: Full round-trip — open xlsx → edit → save → close → reopen → edit is there

**Verification:**
- Saved xlsx opens correctly in Excel / other spreadsheet apps
- Saved csv is valid plain text
- Dirty state clears after save

## System-Wide Impact

- **New service method**: `readFileBinary()` added to file system adapter. `writeFileBinary()` is a thin alias for existing `uploadImage()`.
- **New Electron IPC handler**: `read-file-binary` (3 lines). No new Go endpoints — reuses existing `/file` (GET) and `/upload` (POST).
- **Bundle size**: Univer adds ~3-5MB. Mitigated by lazy loading — chunk only loads on spreadsheet file open.
- **Tab object**: New `isSpreadsheet` boolean flag. No changes to existing fields.
- **Unchanged invariants**: TipTap editor, PDF viewer, code viewer, Excalidraw viewer — all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Univer may not support React 19.2 | Check during install. Fallback: use Univer's vanilla JS API with a React wrapper |
| SheetJS → Univer data conversion may be lossy | Accept that complex features (charts, macros, conditional formatting) won't survive. Document as known limitation. This is the primary technical risk — spike the conversion early in Unit 2 |
| Univer CSS conflicts with Tailwind | Scope container with wrapper class. Test dark/light mode |
| Vite build fails with Univer | May need `optimizeDeps.include` or polyfills. Resolve in Unit 1 |
| Memory leaks from Univer instances | Dispose on unmount. Verify with DevTools memory profiling |
| Large xlsx files (10MB+) freeze UI during parsing | SheetJS parsing is synchronous. Defer Web Worker approach to v2 if needed |

## Sources & References

- Related code: `src/components/ExcalidrawViewer.jsx`, `src/components/PdfViewer.jsx`, `src/services/fileSystem.js`
- Institutional learnings: `docs/solutions/feature-implementations/excalidraw-viewer-file-type-routing.md`, `docs/solutions/feature-implementations/media-viewer-image-video-support.md`
- Libraries: [Univer](https://univer.ai/) (Apache-2.0), [SheetJS Community Edition](https://sheetjs.com/) (Apache-2.0)
