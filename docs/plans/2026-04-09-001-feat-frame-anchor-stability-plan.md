---
title: "feat: FRAME anchor stability & format awareness"
type: feat
status: active
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-frame-anchor-stability-requirements.md
---

# feat: FRAME anchor stability & format awareness

## Overview

FRAME annotations anchor to documents via line numbers that break whenever lines are inserted or deleted above the annotation, and incorrectly offset on markdown files with frontmatter. This plan makes `selectedText` the primary anchor, re-resolves positions server-side after each save, and adds a `format` field to the FRAME envelope so resolution is format-aware.

## Problem Frame

Two bugs in the current annotation system:

1. **Frontmatter offset** — `posToLineNumber` counts ProseMirror block nodes from the top of the document, but the rendered editor already strips frontmatter. The Go server, when reading the raw `.md` file, must also strip frontmatter and use the same coordinate system to avoid a systematic offset.

2. **Fragile anchors** — The `line` field is an integer that becomes stale the moment any line is added or removed above the annotation. Under collaborative editing this is nearly always wrong after any edit.

The fix is three-pronged: (a) store `selectedText` + context strings at annotation creation time, (b) trigger server-side anchor re-resolution after every save, and (c) align the `line` coordinate system between client and server on a shared newline-based count of the plain-text content.

*(see origin: docs/brainstorms/2026-04-09-frame-anchor-stability-requirements.md)*

## Requirements Trace

- R1. `selectedText` is the primary semantic anchor; `line` is a display hint. The client writes a provisional `line` at annotation creation; the server maintains it thereafter.
- R2. `contextBefore` and `contextAfter` disambiguate duplicate `selectedText` occurrences.
- R3. `detached: true` when the server cannot re-resolve; shown in a warning panel, never auto-deleted.
- R4/R4a. `occurrence` tiebreaker; client populates `selectedText`, context, and `occurrence` at creation time.
- R5/R6/R7. `format` field on the `Frame` envelope; inferred from extension for legacy files; written on next server write.
- R8. Re-resolution triggered by client POST `/frame/resolve` after each successful save.
- R9/R10/R11. Resolution algorithm per format; `.quipu` uses client-provided plain-text corpus.
- R12. Eventually consistent; browser mode has up to 5s propagation lag.
- R13. README "File Formats" section for `.frame.json` and `.quipudb.jsonl`.
- R14. `lineNumberToPos` updated to consume newline-based content-relative line numbers.

## Scope Boundaries

- PDF / media anchors (`page` + `topRatio`) are not touched.
- Code file anchors are not in scope.
- Full OT/CRDT merge is out of scope; last-write-wins is accepted.
- Fuzzy (edit-distance) matching is out of scope; exact plain-text match + context scoring is sufficient.
- A server-internal autonomous file watcher is out of scope; re-resolution is always client-triggered.

## Context & Research

### Relevant Code and Patterns

- `src/services/frameService.ts:11–22` — canonical `FrameAnnotation` interface (authoritative); `src/types/editor.ts:9–18` — stale duplicate, not imported anywhere, delete it.
- `src/components/editor/Editor.tsx:1069–1108` — `addComment`: the annotation creation call site. Currently passes `{id, line, text, type, author}` only; needs `selectedText`, `contextBefore`, `contextAfter`, `occurrence`.
- `src/components/editor/Editor.tsx:103–126` — `posToLineNumber` / `lineNumberToPos`: currently ProseMirror block-node index; must switch to newline-based count over `editor.storage.markdown.getMarkdown()`.
- `src/components/editor/Editor.tsx:840` — `.isQuipu` guard that skips FRAME loading; must be removed per R1/R4a.
- `src/components/editor/Editor.tsx:893–913` — annotation render loop; skips `annotation.line == null`; must also route `annotation.detached == true` to the warning panel.
- `src/context/TabContext.tsx:496–560` — `saveFile`: successful write must trigger `frameService.resolveAnnotations(...)` fire-and-forget.
- `src/context/TabContext.tsx:738` — FRAME path registration excludes `.isQuipu`; remove exclusion.
- `server/main.go:249–278` — `handleWriteFile`: template for the new `handleFrameResolve` handler.
- `server/main.go:1762–1832` — route registration in `main()`; add `http.HandleFunc("/frame/resolve", corsMiddleware(handleFrameResolve))`.
- `electron/main.cjs:767–789` — existing `watch-frame-directory` IPC handler; pattern for `frame-resolve`.
- `electron/preload.cjs:34–37` — preload bridge for FRAME; add `resolveFrameAnnotations`.
- `src/services/fileSystem.ts:6` — `isElectron()` guard and dual-implementation pattern.

### Institutional Learnings

- **UUID stable identity**: `id` is the stable annotation identifier; `line` is a derived hint. Do not use `line` as a key in lookups.
- **Fire-and-forget sidecar writes**: All FRAME writes (including resolve writes) must be `.catch(err => console.warn(...))` — never `await` in the UI render path. (source: `docs/solutions/integration-issues/frame-system-multi-component-sync.md`)
- **Hook ordering TDZ**: In `TabContext.tsx`, any new `resolveAnnotations` callback must be declared after all of its leaf dependencies in the function body. ESLint `exhaustive-deps` will not catch violations. (source: `docs/solutions/runtime-errors/usecallback-temporal-dead-zone-in-dependency-array.md`)
- **`corsMiddleware` required**: Every new Go endpoint must be wrapped with `corsMiddleware`. (source: `docs/solutions/runtime-errors/windows-cors-403-go-server-websocket.md`)
- **`{ emitUpdate: false }`**: All programmatic TipTap mark applications must pass `{ emitUpdate: false }` to avoid spurious dirty state. Already used in the annotation restore path; continue the pattern. (source: `docs/solutions/ui-bugs/false-dirty-state-on-file-open.md`)
- **`isWithinWorkspace` sandbox**: All Go file reads/writes must pass through the workspace sandbox check. `.quipu/meta/` paths are within the workspace. (source: `docs/solutions/runtime-errors/windows-cors-403-go-server-websocket.md`)

## Key Technical Decisions

- **Client sets provisional `line` at creation** using updated (newline-based) `posToLineNumber`. This makes new annotations visible immediately; the server will overwrite with a confirmed value on first resolve. Without this, annotations with `line: null` are invisible until the first save (up to 5s in browser mode).
- **Newline-based `line` coordinate system**: Both `posToLineNumber` (client) and the Go resolver (server) count `\n` characters in the plain-text / frontmatter-stripped corpus. This eliminates the ProseMirror-block vs. raw-text mismatch surfaced in review.
- **Client-triggered resolve via `POST /frame/resolve`**: Avoids a new server-internal file watcher goroutine; fits the existing 4-layer pattern; works identically in browser and Electron modes.
- **200ms debounce on resolve call**: Prevents two resolve requests in-flight simultaneously when the user saves rapidly. Cheapest possible mitigation for the last-write-wins race.
- **Legacy annotations (no `selectedText`)**: Server preserves existing `line` and leaves `detached: false`. They are never detached solely for being legacy — they simply won't benefit from re-resolution until they are re-annotated.
- **`recentFrameSaveRef` not cleared on resolve**: The `recentFrameSaveRef` guard is scoped to client annotation writes. The resolve response arrives ~300ms+ after save (200ms debounce + server processing), by which point the `isWritingFrame` 600ms guard from any concurrent annotation write has typically expired. If a resolve response is suppressed within a 3s annotation-write window, it is picked up on the next save. Accepted as part of the eventually-consistent design; no special clearing is needed.
- **Context scoring algorithm**: Character-level overlap ratio: `2 * |common_chars| / (|contextBefore_stored| + |contextBefore_file|)`. Zero-dependency, implementable in Go and TypeScript without libraries. Sufficient for distinguishing adjacent paragraphs.
- **`.quipu` files included**: Exclusion guards in `Editor.tsx:840` and `TabContext.tsx:738` are removed. The resolve request includes a `plainText` corpus field populated by `editor.getText()` before the save call returns.
- **`saveFile` signature extended**: `saveFile(editorInstance: Editor | null, plainTextCorpus?: string)`. `saveFile` internally calls `editorInstance?.getText()` to extract the corpus for `.quipu` files. App.tsx (the actual call site) passes the editor instance; `plainTextCorpus` is derived inside `saveFile`, not computed at the call site.

## Open Questions

### Resolved During Planning

- **`line` coordinate system**: Newline-based count in plain-text corpus — same for client `posToLineNumber` and server resolver. Resolves the P0 coherence finding.
- **Resolve trigger mechanism**: Client-POSTs `/frame/resolve` after save — no server-internal watcher needed.
- **`.quipu` participation**: Yes, included. Exclusion guards are removed.
- **Legacy annotation behaviour**: Preserve `line`; leave `detached: false`.
- **Annotation visibility at creation**: Client sets provisional `line` (newline-based) immediately; server confirms on first resolve.
- **`format` field for legacy files**: Inferred at read time from extension; written back on next server write.

### Deferred to Implementation

- **Exact context window size**: Starting point is 80 chars; validate against real documents. The value is a constant in the resolver — easy to tune after implementation.
- **Electron IPC resolve handler reuse**: The Go resolver and the Electron Node.js handler share the same algorithm. Implement it in a shared `src/lib/anchorResolver.ts` module (exported as a pure function) and import from `electron/main.cjs`. If CJS module resolution prevents clean import, document that explicitly and duplicate with a comment referencing the canonical Go implementation.
- **How `plainTextCorpus` is passed in the Electron IPC call**: It flows as an argument in `ipcRenderer.invoke('frame-resolve', workspacePath, filePath, plainTextCorpus)` — verify alignment with the handler signature.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Resolve flow (per save)

```
Editor/App.tsx: user saves
  │
  ▼
TabContext.saveFile(editorInstance)
  │  (.quipu) internally: plainTextCorpus = editorInstance.getText()
  │  write file (existing path, unchanged)
  │
  └─ (debounced 200ms) frameService.resolveAnnotations(workspacePath, filePath, plainTextCorpus?)
       │
       ├─ Browser: POST /frame/resolve  { workspacePath, filePath, plainText? }
       └─ Electron: ipcRenderer.invoke('frame-resolve', workspacePath, filePath, plainText?)
                                │
                       Go handler / IPC handler:
                         1. Read .frame.json (or no-op if missing)
                         2. Read source file → strip frontmatter if markdown
                            OR use plainText corpus if quipu
                         3. For each annotation:
                              if no selectedText → skip (preserve line)
                              else → find matches → score context → pick candidate
                                   → write line (newline count) + detached
                         4. Write updated .frame.json
                                │
                       Client FRAME watcher fires onFrameChanged
                       (up to 5s browser, <1s Electron)
                                │
                       Editor re-renders:
                         attached → inline marks via lineNumberToPos (newline-based)
                         detached → warning panel list
```

### `posToLineNumber` / `lineNumberToPos` (updated semantics)

Both functions accept `(editor: TiptapEditor, pos: number)` — the editor instance is required to access document state. `doc` alone is insufficient.

```
function posToLineNumber(editor, pos):
  // textBetween with '\n' block separator: each ProseMirror block = one line.
  // TipTap's frontmatter extension stores frontmatter as a non-text node;
  // textBetween skips it, giving a frontmatter-free plain-text view automatically.
  textUpToPos = editor.state.doc.textBetween(0, pos, '\n')
  return count('\n', textUpToPos) + 1   // 1-based content-relative newline count

function lineNumberToPos(editor, line):
  // Walk plain text to find the character offset of the start of line N,
  // then map back to a ProseMirror position via charOffsetToDocPos.
  doc = editor.state.doc
  fullText = doc.textBetween(0, doc.content.size, '\n')
  charOffset = 0
  for i in 1..(line - 1):
    nextNewline = fullText.indexOf('\n', charOffset)
    if nextNewline == -1: return null   // line out of range
    charOffset = nextNewline + 1
  // charOffset is now the plain-text offset of the first char of line N
  return charOffsetToDocPos(doc, charOffset, '\n')
  // charOffsetToDocPos walks doc.descendants counting chars with the same
  // '\n' block-separator logic to find the matching ProseMirror position.
```

**Why `doc.textBetween` throughout**: `editor.storage.markdown.getMarkdown()` produces markdown text with inline formatting characters (`**`, `_`, `` ` ``, etc.) whose character lengths differ from the plain-text `textBetween` output. Mixing them causes character-offset mismatches. `doc.textBetween(from, to, '\n')` gives consistent plain text at both ends of the mapping, and matches what the Go server sees after stripping inline formatting marks.

## Implementation Units

- [ ] **Unit 1: Consolidate and extend FrameAnnotation types**

**Goal:** Single canonical `FrameAnnotation` and `Frame` interface with all new fields. Delete the stale duplicate.

**Requirements:** R1, R2, R3, R5, R14

**Dependencies:** None

**Files:**
- Modify: `src/services/frameService.ts`
- Modify: `src/services/frameService.ts` (AddAnnotationParams)
- Delete: `src/types/editor.ts` — remove the `FrameAnnotation` interface (verify no imports before deleting; research confirmed it is unused)
- Modify: `src/types/editor.ts` — remove `FrameAnnotation`; keep `TerminalTab` and any other types in the file

**Approach:**
- Add to `FrameAnnotation`: `contextBefore?: string`, `contextAfter?: string`, `detached?: boolean`
- Add to `Frame`: `format?: 'markdown' | 'quipu' | 'text'`
- Add to `AddAnnotationParams`: `contextBefore?: string`, `contextAfter?: string`, `occurrence?: number | null`
- Add to `FrameService` interface: `resolveAnnotations(workspacePath: string, filePath: string, plainTextCorpus?: string): Promise<void>`
- Keep `selectedText` optional everywhere — legacy callers that do not pass it are supported

**Patterns to follow:**
- `src/services/frameService.ts:11–22` — existing interface structure
- All fields optional to maintain backward compatibility with existing `.frame.json` files on disk

**Test scenarios:**
- Happy path: a `Frame` object with a `format` field serialises and deserialises without data loss
- Happy path: a `FrameAnnotation` with all new fields (contextBefore, contextAfter, detached) round-trips through `JSON.stringify` / `JSON.parse`
- Edge case: existing FRAME file without `format` field is read via `readFrame` — no parse error, `frame.format` is `undefined`
- Edge case: existing annotation without `contextBefore` field is read — no error, `annotation.contextBefore` is `undefined`

**Verification:**
- `npx tsc --noEmit` passes with no errors after the interface changes
- No remaining import of `FrameAnnotation` from `src/types/editor.ts`

---

- [ ] **Unit 2: Client annotation creation — capture anchor data + update line semantics**

**Goal:** `addComment` in `Editor.tsx` captures `selectedText`, `contextBefore`, `contextAfter`, `occurrence`, and a provisional `line` using newline-based counting.

**Requirements:** R1, R2, R4a, R14

**Dependencies:** Unit 1

**Files:**
- Modify: `src/components/editor/Editor.tsx`
- Test: `src/components/editor/Editor.test.tsx` (create or add to existing)

**Approach:**
- Change both function signatures from `(doc: ProseMirrorNode, pos: number)` to `(editor: TiptapEditor, pos: number)`. Update the single call site at `Editor.tsx:1076` accordingly.
- Update `posToLineNumber(editor, pos)`: call `editor.state.doc.textBetween(0, pos, '\n')` with `'\n'` as the block separator, then count `\n` characters in the result and return 1-based. Do not use `editor.storage.markdown.getMarkdown()` — markdown strings include formatting chars (`**`, `_`, `` ` ``) that produce different character lengths than `textBetween`, breaking any offset-based mapping.
- Update `lineNumberToPos(editor, line)`: call `editor.state.doc.textBetween(0, doc.content.size, '\n')` to get the full plain text. Walk the string counting `\n` characters to find the character offset of the start of line N. Then call a helper `charOffsetToDocPos(doc, charOffset, '\n')` that walks `doc.descendants` with the same block-separator logic to map the character offset back to a ProseMirror position.
- In `addComment` (~line 1069): extract from the saved selection range (`savedSelectionRef.current`):
  - `selectedText = editor.state.doc.textBetween(from, to)`  — plain text only
  - `contextBefore` = up to 80 chars of plain text immediately before `from`
  - `contextAfter` = up to 80 chars of plain text immediately after `to`
  - `occurrence`: 1-based count of how many times `selectedText` appears in `editor.state.doc.textContent` up to and including position `from`; type is `number | null` — set to `null` (not omitted) if the text is unique
  - `line` = `posToLineNumber(editor, from)` using the updated function
- Pass all five fields to `frameService.addAnnotation(...)`.
- Remove the `.isQuipu` guard at `Editor.tsx:840` that skips FRAME annotation loading for `.quipu` files.

**Execution note:** The `posToLineNumber`/`lineNumberToPos` functions are pure transformations — write their tests before changing the implementations to document the expected input/output contract under the new semantics.

**Patterns to follow:**
- `Editor.tsx:1020` — `handleCommentClick` saves selection before focus shift; `from`/`to` are already available at the `addComment` call site
- `editor.state.doc.textBetween(from, to)` — standard TipTap/ProseMirror plain-text extraction

**Test scenarios:**
- Happy path: `posToLineNumber` on a doc with 3 paragraphs returns 1, 2, 3 for positions at the start of each paragraph
- Happy path: `posToLineNumber` on a markdown doc with a 3-line frontmatter block returns 1 for a position on the first content paragraph (not 4)
- Happy path: `lineNumberToPos(doc, 2)` for a 3-paragraph doc returns the start of the second paragraph's content
- Edge case: `posToLineNumber` at position 0 returns 1
- Edge case: `posToLineNumber` when the doc has no frontmatter returns the same result as before for single-line-per-block documents
- Edge case: `contextBefore` at position 0 returns an empty string (not an error)
- Edge case: `contextAfter` at the end of the document returns an empty string
- Happy path: `occurrence` is `null` for a unique selectedText
- Happy path: `occurrence` is `2` for a selectedText that appears twice and `from` is at the second occurrence

**Verification:**
- Existing annotation unit tests (if any) still pass
- A fresh annotation on a file with YAML frontmatter shows the correct line number in the UI (line 1 = first content line, not first file line)
- Annotations on `.quipu` files are no longer silently skipped — they load and render

---

- [ ] **Unit 3: Go server `/frame/resolve` endpoint**

**Goal:** A Go HTTP handler that reads a FRAME file, re-resolves each annotation's position in the document corpus, and writes back updated `line` and `detached` values.

**Requirements:** R8, R9, R10, R11, R5, R6, R7

**Dependencies:** None (parallel with Units 1–2)

**Files:**
- Modify: `server/main.go`

**Approach:**
- At the top of the handler: check `r.Method == "POST"`, return `405 Method Not Allowed` otherwise.
- Wrap the request body with `http.MaxBytesReader(w, r.Body, 10<<20)` (10MB cap) before decoding JSON. `plainText` for large `.quipu` files can be multi-megabyte; cap prevents unbounded memory use.
- Request body: `{ workspacePath, filePath, plainText? }` where `plainText` is provided by the client for `.quipu` files.
- Sandbox check: use a **request-scoped** `filepath.Rel(workspacePath, filePath)` prefix check that is independent of the global `workspaceExplicit` flag. `isWithinWorkspace` returns `true` unconditionally when `-workspace` was not passed at startup, so it is insufficient alone for new endpoints. The check: `rel, err := filepath.Rel(workspacePath, filePath); if err != nil || strings.HasPrefix(rel, "..") { return 400 }`. Apply this to `filePath`; apply the same logic to the derived FRAME path `{workspacePath}/.quipu/meta/{relativePath}.frame.json`.
- `isWithinWorkspace` may still be called for defence-in-depth but the `filepath.Rel` check is the authoritative gate.
- Read the FRAME file. If not found, return `200 { resolved: 0 }` (no-op — the annotation may not have been saved yet).
- Infer `format` from `frame.format` if set; otherwise infer from `filePath` extension.
- Build the corpus:
  - `"markdown"`: read the raw source file, strip the YAML frontmatter block (lines between leading/closing `---` delimiters), strip inline markdown formatting characters (`*`, `_`, `` ` ``, `[`, `]`, `(`, `)`, `#` prefix) to produce a plain-text search string.
  - `"quipu"`: use `plainText` from the request body. If absent, return `200 { resolved: 0 }` (cannot resolve without corpus).
  - `"text"`: use the raw file content as-is.
- For each annotation in the FRAME:
  - If `selectedText` is empty/missing → skip (preserve `line`, leave `detached` unchanged). This handles legacy annotations.
  - Find all occurrences of `selectedText` in the corpus (exact substring match).
  - If no occurrences → set `detached: true`, clear `line`.
  - Score each occurrence: compute `contextScore = overlapRatio(annotation.contextBefore, corpusWindowBefore) + overlapRatio(annotation.contextAfter, corpusWindowAfter)` where `corpusWindow` is 80 chars before/after the match. `overlapRatio(a, b) = 2 * commonChars(a, b) / (len(a) + len(b))`.
  - Pick the highest-scoring occurrence. On tie: if `annotation.occurrence` is set, use it as 1-based index into tied candidates; otherwise pick first.
  - Set `line` = 1-based newline count (number of `\n` characters before the match start in the corpus + 1).
  - Set `detached: false`.
- If `frame.format` was absent, write the inferred format into the FRAME before saving.
- Write the updated FRAME back to disk (atomic: write to temp file then rename is preferred but `os.WriteFile` is acceptable for the first iteration).
- Return `200 { resolved: N }` where N is the number of annotations that were re-resolved (not skipped).
- Register: `http.HandleFunc("/frame/resolve", corsMiddleware(handleFrameResolve))` in `main()`.

**Patterns to follow:**
- `server/main.go:249–278` — `handleWriteFile`: JSON decode, sandbox check, write, return JSON
- `server/main.go:1762–1832` — route registration location
- `server/main.go:809–826` — `runGitCommand`: pattern for `isWithinWorkspace` usage

**Test scenarios:**
- Happy path: annotation with unique `selectedText` — `line` is updated to correct newline-based position, `detached` is `false`
- Happy path: annotation with `selectedText` appearing twice — higher-scoring context candidate is selected
- Happy path: `selectedText` appears twice with equal context scores — `occurrence: 2` picks the second match
- Happy path: markdown file with 4-line frontmatter — after stripping, `line: 1` is the first content line, not file line 5
- Happy path: legacy annotation (no `selectedText`) — `line` and `detached` are unchanged, no error
- Edge case: FRAME file does not exist — returns `200 { resolved: 0 }`, no error
- Error path: `filePath` is outside workspace — returns `400 Bad Request`
- Happy path: `.quipu` file with `plainText` provided — uses provided corpus, resolves normally
- Edge case: `.quipu` file with no `plainText` in request — returns `200 { resolved: 0 }`
- Happy path: annotation whose `selectedText` is no longer in the corpus — `detached: true`, `line` cleared
- Happy path: annotation that was previously `detached: true` and `selectedText` is re-found — `detached: false`, `line` updated

**Verification:**
- `curl -X POST localhost:4848/frame/resolve -d '{"workspacePath":"/ws","filePath":"/ws/test.md"}'` returns `200` for an existing workspace
- Running resolve twice on an unchanged file produces the same `line` values both times (idempotent)

---

- [ ] **Unit 4: Electron IPC handler + preload bridge for frame-resolve**

**Goal:** Mirror the Go server's resolve logic in the Electron main process; expose it via the preload bridge.

**Requirements:** R8 (Electron runtime), R10

**Dependencies:** None (parallel with Unit 3; both implement the same algorithm independently)

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

**Approach:**
- Add `ipcMain.handle('frame-resolve', async (event, workspacePath, filePath, plainText) => { ... })` in `electron/main.cjs`.
- **Path validation**: at the top of the handler, verify that `filePath` resolves within `workspacePath` using Node's `path.relative`: `const rel = path.relative(workspacePath, filePath); if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path outside workspace')`. Return `{ resolved: 0, error: 'path outside workspace' }` rather than throwing to keep the IPC layer clean.
- The handler implements the same algorithm as the Go endpoint (Unit 3) using Node.js `fs.promises`:
  - Read FRAME JSON
  - Build corpus (read source file + strip frontmatter, or use `plainText`)
  - For each annotation: exact substring search, context scoring, pick candidate, set `line` + `detached`
  - Write FRAME back via `fs.promises.writeFile`
  - Return `{ resolved: N }`
- If the FRAME file is missing (`ENOENT`), return `{ resolved: 0 }` (same no-op as the Go server).
- Add to `electron/preload.cjs` contextBridge:
  ```
  resolveFrameAnnotations: (workspacePath, filePath, plainText) =>
    ipcRenderer.invoke('frame-resolve', workspacePath, filePath, plainText)
  ```
- Add type declaration to `window.electronAPI` if TypeScript types are maintained for the preload.

**Patterns to follow:**
- `electron/main.cjs:767–789` — `watch-frame-directory` IPC handler structure
- `electron/main.cjs:334` — `write-file` handler for `fs.promises` usage
- `electron/preload.cjs:34–37` — existing FRAME bridge entries

**Test scenarios:**
- Happy path: IPC handler returns `{ resolved: N }` for a valid FRAME + source file pair (integration test or manual verification)
- Edge case: FRAME file missing — returns `{ resolved: 0 }`, no unhandled rejection
- Edge case: source file missing — handler catches the error and returns `{ resolved: 0 }` (do not throw)
- Happy path: annotation resolves to a different line after source edits — `line` is updated in the written FRAME file

**Verification:**
- Launching in Electron mode, making an annotation, saving a file, and waiting — the annotation re-renders to the correct position without a console error

---

- [ ] **Unit 5: frameService adapter — `resolveAnnotations` method + save trigger**

**Goal:** Add the dual-runtime `resolveAnnotations` method to `frameService`; call it fire-and-forget from `saveFile` in `TabContext.tsx` with a 200ms debounce.

**Requirements:** R8, R10, R12

**Dependencies:** Units 3 and 4

**Files:**
- Modify: `src/services/frameService.ts`
- Modify: `src/context/TabContext.tsx`

**Approach:**
- In `frameService.ts`:
  - Add `resolveAnnotations(workspacePath, filePath, plainTextCorpus?)` to the `FrameService` interface.
  - Browser implementation: `POST ${SERVER_URL}/frame/resolve` with JSON body `{ workspacePath, filePath, plainText: plainTextCorpus ?? undefined }`.
  - Electron implementation: `window.electronAPI.resolveFrameAnnotations(workspacePath, filePath, plainTextCorpus)`.
  - Both return `Promise<void>` (discard the `{ resolved: N }` payload from the caller's perspective).
  - The `frameService` exported object gains a `resolveAnnotations` key pointing to the appropriate implementation via the `isElectron()` guard.
- In `TabContext.tsx`:
  - Extend `saveFile` signature to `saveFile(editorInstance: Editor | null)`. `saveFile` internally derives the plain-text corpus by calling `editorInstance?.getText()` when the active file path ends with `.quipu`. This keeps the corpus extraction logic co-located with the resolve call rather than duplicated at every call site.
  - Add `workspacePath` to the `saveFile` `useCallback` dependency array: `[activeTab, showToast, workspacePath]`. Without it, the closure captures a stale `workspacePath` (empty string on initial render), causing resolve requests to no-op silently.
  - After a successful file write (inside the existing success path), add a debounced (200ms) fire-and-forget call:
    ```
    frameService.resolveAnnotations(workspacePath, activeFile.path, plainTextCorpus)
      .catch(err => console.warn('[frame] resolve failed', err));
    ```
  - Use a `resolveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)` in `TabContext` to debounce.

- In `src/components/editor/Editor.tsx`:
  - App.tsx calls `saveFile` via keyboard shortcut — update App.tsx call sites to pass the editor instance: `saveFile(editorInstance)`. The editor instance is already available in App.tsx via the `editorRef` or equivalent ref.
  - Do **not** clear `recentFrameSaveRef.current` before or after the resolve call. See Key Technical Decisions for rationale.

**Patterns to follow:**
- `src/services/fileSystem.ts` — dual-implementation object with `isElectron()` guard
- `src/context/TabContext.tsx:496–560` — `saveFile` existing structure
- `src/services/frameService.ts:201–212` — `writeFrameWithFlag` for fire-and-forget sidecar write pattern

**Test scenarios:**
- Happy path: `resolveAnnotations` calls `POST /frame/resolve` in browser mode and returns without error
- Happy path: `resolveAnnotations` calls Electron IPC in Electron mode and returns without error
- Edge case: `resolveAnnotations` called with no workspace set — returns early or no-ops without throwing
- Integration: after `saveFile` completes for a `.md` file, `resolveAnnotations` is called within 300ms
- Integration: rapid double-save triggers only one resolve call (debounce works)
- Edge case: `saveFile` for a `.quipu` file passes non-empty `plainTextCorpus` to `resolveAnnotations`

**Verification:**
- In browser mode: DevTools Network tab shows a `POST /frame/resolve` request after each Cmd+S
- In Electron mode: no console errors after save
- Saving a file twice quickly produces exactly one resolve request (check Network or add logging)

---

- [ ] **Unit 6: Annotation rendering — detached panel + lineNumberToPos update + remove guards**

**Goal:** Render detached annotations in a warning panel; ensure `lineNumberToPos` uses the newline-based coordinate system; remove the `.isQuipu` exclusion guards.

**Requirements:** R3, R14

**Dependencies:** Units 1, 2, 5

**Files:**
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/context/TabContext.tsx`

**Approach:**
- Remove the `.isQuipu` guard at `Editor.tsx:840` that exits early from FRAME loading.
- Remove the `.isQuipu` exclusion in `TabContext.tsx:738` that skips registering `.quipu` tab FRAME paths with the browser-mode watcher.
- In the annotation render loop (`Editor.tsx:893–913`):
  - Split annotations into two lists at load time: `attachedAnnotations` (where `!annotation.detached`) and `detachedAnnotations` (where `annotation.detached === true`).
  - Apply marks only for `attachedAnnotations`.
  - Pass `detachedAnnotations` to a new `detachedAnnotations` state (add `useState<FrameAnnotation[]>([])`).
- Render detached annotations in a warning panel below (or within) the existing comments sidebar. Each entry shows:
  - The annotation text
  - A visual warning indicator (e.g., `WarningIcon` from Phosphor) and "detached" label
  - A delete button (calls `frameService.removeAnnotation`)
  - No inline mark in the editor body
- When `frameReloadKey` changes and detached annotations are re-loaded, clear the `detachedAnnotations` state and repopulate from the fresh FRAME data — they may have been re-attached by the server.
- `lineNumberToPos` change: see Unit 2 — this is implemented there. Ensure Unit 6 tests verify that attached annotations at updated line numbers render at the correct editor position.

**Patterns to follow:**
- `Editor.tsx:893–913` — existing annotation render loop
- `Editor.tsx:534–580` — Comment mark extension (for `{ emitUpdate: false }`)
- Phosphor `WarningIcon` for the detached indicator (consistent with project icon conventions)
- Tailwind token `bg-warning` or `text-git-deleted` for the warning colour (from `src/styles/theme.css`)

**Test scenarios:**
- Happy path: a detached annotation (`detached: true`) does NOT produce an inline mark in the editor
- Happy path: a detached annotation appears in the warning panel with its text and a warning icon
- Happy path: after a resolve cycle sets `detached: false`, the warning panel entry disappears and the annotation renders as an inline mark
- Happy path: delete button on a detached annotation calls `removeAnnotation` and the entry disappears from the panel
- Happy path: a `.quipu` file with FRAME annotations loads the annotations (exclusion guard removed) — they render as inline marks
- Edge case: a FRAME file with a mix of attached and detached annotations renders both categories correctly in parallel
- Edge case: all annotations are detached — no inline marks, all appear in warning panel

**Verification:**
- Opening a file whose FRAME has `detached: true` annotations shows them in the warning panel, not as inline marks
- Re-saving the file (and re-resolving) moves previously-detached annotations to inline marks if `selectedText` is found
- `.quipu` files with FRAME annotations display annotations correctly (they were previously invisible)

---

- [ ] **Unit 7: README File Formats section**

**Goal:** Add a technical "File Formats" section to `README.md` documenting `.frame.json` and `.quipudb.jsonl`.

**Requirements:** R13

**Dependencies:** None (can land any time)

**Files:**
- Modify: `README.md`

**Approach:**
- Add a "## File Formats" section after the existing "## Project Structure" section.
- For `.frame.json`: describe purpose (per-file annotation sidecar), storage location (`.quipu/meta/{relativePath}.frame.json`), and top-level fields (`version`, `type`, `id`, `filePath`, `format`, `annotations`, `instructions`, `history`). Briefly describe `FrameAnnotation` fields including the new `selectedText`, `contextBefore`, `contextAfter`, `detached`.
- For `.quipudb.jsonl`: describe purpose (in-workspace structured database), storage (any `.quipudb.jsonl` file in the workspace), format (first line `_schema`, subsequent lines data rows with `_id`), and top-level schema fields (`version`, `name`, `columns`, `views`).
- Keep each subsection to ~5–8 lines: purpose, location, and key fields only.

**Test expectation:** none — documentation only.

**Verification:**
- The README renders cleanly in a Markdown viewer with no broken formatting

---

## System-Wide Impact

- **Interaction graph:** `saveFile` in `TabContext.tsx` gains a new post-write callback (`resolveAnnotations`). The FRAME watcher (`watchFrames`) will fire after every resolve write — this is intentional and drives re-render. The `recentFrameSaveRef` suppression in `Editor.tsx` guards only client annotation writes (3s window). Resolve responses arrive ~300ms+ after save, by which point the `isWritingFrame` 600ms guard has typically expired; in the rare case they overlap, the re-render is deferred to the next save cycle, which is acceptable under the eventually-consistent design.
- **Error propagation:** All resolve calls are fire-and-forget; failures log a console warning and do not surface to the user. FRAME file write failures in the Go/Electron handler are swallowed similarly — annotation positions may be stale but the user is not blocked.
- **State lifecycle risks:** The `isWritingFrame` flag in `frameService.ts` only guards client-originated writes. Server-originated resolve writes are intentionally not guarded — the client watcher must process them. The 600ms flag window from the last annotation write will not suppress a resolve arriving more than 600ms later. For resolve events arriving within 600ms of an annotation write (unlikely but possible), the re-render may be skipped once and pick up on the next save cycle.
- **API surface parity:** `resolveAnnotations` must be implemented in all 4 layers: Go server, Electron IPC handler, preload bridge, service adapter.
- **Integration coverage:** The save → resolve → FRAME change → re-render cycle spans `TabContext.tsx` → `frameService.ts` → Go/Electron backend → `frameService.watchFrames` → `TabContext.tsx frameReloadKey` → `Editor.tsx useEffect`. Unit tests cannot prove this chain; a manual or E2E test of the full cycle is the verification gate.
- **Unchanged invariants:** The `id` UUID remains the stable annotation identity throughout. `instructions` and `history` fields in the FRAME envelope are not touched. The `topRatio` and `page` fields for PDF annotations are not modified. The comment mark in TipTap still uses `id` and `comment` attributes.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `posToLineNumber` semantic change breaks existing annotations on upgrade | Provisional line set at creation uses the new semantics; server resolve also uses new semantics. On first resolve after upgrade, all annotations get a correct `line`. Existing annotations that have never been resolved will display at the provisional line (which may be off by frontmatter count) until a save triggers resolve. Acceptable transient. |
| `recentFrameSaveRef` suppression swallows the resolve response | No clearing needed. The 200ms debounce + server processing means the resolve FRAME event arrives ~300ms+ after save, typically after the 600ms `isWritingFrame` window. In the rare overlap, the re-render is deferred to the next save — acceptable under eventually-consistent design. Clearing the ref would risk processing stale FRAME events from concurrent annotation writes. |
| Electron IPC resolver diverges from Go resolver over time | Extract the algorithm to `src/lib/anchorResolver.ts` and import from `electron/main.cjs`. Single source of truth. If CJS import is problematic, duplicate with a comment referencing the canonical Go implementation and add a unit test that exercises both. |
| `.quipu` exclusion guard removal causes regressions | The `.quipu` FRAME system was previously disabled. Enable it cautiously — test with a `.quipu` file that has no existing FRAME first, then with one that has a legacy FRAME. |
| Go resolver produces wrong `line` values for markdown files with code blocks | Code block content is multi-line; stripping inline formatting marks leaves newlines intact. The server counts newlines in the stripped corpus, so `line` counts raw newlines in the visible content — same as what `posToLineNumber` would compute from `editor.storage.markdown.getMarkdown()`. Consistent. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-09-frame-anchor-stability-requirements.md](docs/brainstorms/2026-04-09-frame-anchor-stability-requirements.md)
- Related code: `src/services/frameService.ts`, `src/components/editor/Editor.tsx:103–126`, `src/context/TabContext.tsx:496–560`
- Related plans: `docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md` (prior FRAME work), `docs/plans/2026-03-01-feat-frame-watch-integration-plan.md`
- Institutional learnings: `docs/solutions/integration-issues/frame-system-multi-component-sync.md`, `docs/solutions/runtime-errors/usecallback-temporal-dead-zone-in-dependency-array.md`
