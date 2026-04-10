---
date: 2026-04-09
topic: frame-anchor-stability
---

# FRAME Anchor Stability & Format Awareness

## Problem Frame

FRAME annotations use absolute line numbers as their primary anchor. This causes two issues:

1. **Frontmatter offset bug** — For markdown files, the annotation tool counts lines from the start of the file including YAML frontmatter. If a file has a 5-line frontmatter block, all displayed line references are off by 5.

2. **Fragile anchors** — Line numbers are invalidated by any insertion or deletion above the annotation. Under sync collaboration — where the source file and the FRAME file can both be changing concurrently — references are routinely lost.

Additionally, the `.frame.json` envelope does not record the source file format, even though anchor resolution is format-dependent (frontmatter skipping, text extraction strategy).

The fix is to make `selectedText` the primary anchor, delegate re-resolution to the Go server (triggered by the client after each save), and add a `format` field to the envelope.

## Requirements

**Anchor redesign**

- R1. `selectedText` becomes the primary semantic anchor for all text-based annotations. `line` is demoted to a server-maintained display hint. The client **never writes** `line` or `detached`; both fields are exclusively written by the server during re-resolution.
- R2. Add `contextBefore` and `contextAfter` string fields to `FrameAnnotation`. These store a window of plain text surrounding the selection (up to ~80 chars each side, or less at document boundaries) and are used to score and disambiguate candidates when `selectedText` appears more than once. At document start/end where one side has less than 80 chars of context, store whatever is available — the scoring function handles asymmetric windows.
- R3. Add a `detached` boolean field to `FrameAnnotation`, defaulting to `false`. The server sets this to `true` when it cannot re-resolve the anchor after a file change. Detached annotations are listed in a dedicated section of the comments/annotations panel with a visual warning indicator; they are not rendered as inline marks in the editor body; and they are never auto-deleted. The indicator clears automatically when the server re-resolves the anchor and writes `detached: false`.
- R4. `occurrence` is kept as a final tiebreaker: when `selectedText` + context scoring yields multiple equally-scored candidates, the nth candidate (1-indexed) matching `occurrence` is selected. `occurrence` does not override context-score ranking.
- R4a. **Annotation creation** — When a user creates an annotation on selected text, the client immediately captures and stores: (1) `selectedText` as the plain-text content of the selection (inline markdown formatting stripped, matching the plain-text corpus the server will search), (2) `contextBefore` and `contextAfter` from the surrounding plain text, (3) `occurrence` as the 1-based ordinal of the selection among identical `selectedText` strings in the current document (omit or set `null` if the text is unique). The client does not set `line` or `detached` at creation time.

**Format field**

- R5. Add a `format` field to the `Frame` envelope with values `"markdown" | "quipu" | "text"`. The field is required in all new FRAME files and is added to any existing FRAME file the first time it is written after deployment.
- R6. `format` governs how the server processes the source file's search corpus: `"markdown"` strips the YAML frontmatter block and inline markdown formatting before searching; `"quipu"` uses the plain-text corpus provided by the client; `"text"` searches as-is.
- R7. Existing FRAME files without a `format` field use the format inferred from the source file extension at read time: `.md` / `.markdown` → `"markdown"`, `.quipu` → `"quipu"`, everything else (including missing or unknown extensions) → `"text"`. The inferred format is written back as the `format` field the next time the file is written by the server.

**Server-side anchor resolution**

- R8. Re-resolution is triggered by a client-side notification: after each successful file save, the client POSTs a `/frame/resolve` request to the Go server (browser mode) or sends an IPC message (Electron mode). The server processes the request asynchronously — the save response returns immediately; the updated FRAME arrives via the existing FRAME change event. This fits the existing 4-layer service pattern without requiring a new server-internal file watcher.
- R9. Resolution algorithm for `"markdown"`:
  1. Strip the YAML frontmatter block (lines between opening and closing `---` delimiters).
  2. Strip inline markdown formatting (bold, italic, backtick, wikilink markers) from the body to produce a plain-text search corpus.
  3. Search the corpus for `selectedText` (exact match against the plain-text corpus).
  4. Score each candidate using `contextBefore` / `contextAfter` string similarity.
  5. If `occurrence` is set and multiple candidates are equally scored, select the nth match.
  6. Write the resolved `line` back as the **content-relative line number** counted in the plain-text corpus (1 = first line after frontmatter, using the same newline-based counting the client will use for rendering).
  7. If no candidate is found, set `detached: true`.
- R10. Resolution algorithm for `"quipu"`: the client provides a plain-text rendering of the document alongside the `/frame/resolve` request; the server uses this as the search corpus, then applies R9 steps 3–7 (no frontmatter to strip).
- R11. Resolution for `"text"`: apply R9 steps 3–7 with no frontmatter stripping.
- R12. The resolution pass is non-blocking and eventually consistent. In browser mode, the existing FRAME watcher polls mtime every 5 seconds, so annotation position updates may lag up to 5 seconds after a save. Transient placement errors during this window are acceptable.

**Client rendering**

- R14. The client's `lineNumberToPos` function must be updated to interpret `line` as a content-relative newline-based line number (matching the corpus the server produces in R9 step 6), not as a ProseMirror block index. This ensures client rendering and server resolution use the same coordinate system. The `FrameAnnotation` interface in `src/types/editor.ts` must be kept in sync with the canonical definition in `src/services/frameService.ts`; both must include `contextBefore`, `contextAfter`, `detached`, and `format`.

**README / landing page docs**

- R13. Add a "File Formats" section to `README.md` with technical descriptions of both `.frame.json` and `.quipudb.jsonl`, covering purpose, storage location, and top-level structure.

## User Flow

```
User saves file (browser mode)
         │
         ├─ (markdown) client strips frontmatter,
         │  extracts plain-text representation
         │
         ├─ (.quipu) client includes plain-text
         │  rendering in request body
         │
         ▼
  Client POSTs /frame/resolve to Go server
  (save response already returned to user)
         │
         ▼
  Server re-resolves each annotation:
    ┌─── selectedText found in corpus? ───┐
    │ Yes                                 │ No
    ▼                                     ▼
  Score candidates via              detached = true
  contextBefore/contextAfter
         │
         ▼
  Update line (content-relative newline count)
  detached = false
         │
         ▼
  Write updated .frame.json
         │
         ▼
  Client receives FRAME change event
  (up to 5s later in browser mode)
         │
         ▼
  Re-render: attached annotations as inline marks,
  detached annotations in warning panel
```

## Success Criteria

- Adding lines above an annotation does not change its resolved line reference after the server re-resolves, and the resolved position correctly identifies the annotated content in the updated document.
- Annotations on markdown files with frontmatter display the correct content-body line number (1 = first non-frontmatter line).
- All new FRAME files include a `format` field; existing files without one are handled gracefully via extension inference.
- Detached annotations are surfaced in the annotations panel, never silently dropped.

## Scope Boundaries

- PDF / media anchors (`page` + `topRatio`) are out of scope — they are already format-specific and unaffected by line counting.
- Code file anchors are out of scope for this iteration.
- Full OT / CRDT implementation is out of scope. The design is CRDT-friendly (stable UUIDs, server-authoritative re-resolution, eventually consistent writes) but does not implement vector clocks or merge functions.
- Fuzzy text matching (edit-distance / spell-check level) is out of scope. Exact plain-text match with context scoring is sufficient.
- Server-internal autonomous file watching is out of scope — re-resolution is client-triggered via `/frame/resolve`, not watch-triggered.
- Concurrent write merging: when a server re-resolution write and a client annotation write occur simultaneously, last-write-wins on the `.frame.json` file. This is an acceptable trade-off at this stage; full merge is out of scope.

## Key Decisions

- **`selectedText`-first anchor**: Semantically meaningful, survives line shifts and minor restructuring without position-tracking machinery.
- **Plain-text corpus for matching**: Both `selectedText` and the search corpus use the same plain-text representation (inline markdown stripped). This ensures the client-captured selection matches what the server finds in the file regardless of formatting marks.
- **Client-triggered re-resolution**: The client POSTs `/frame/resolve` after each save. This fits the existing 4-layer service pattern, avoids a new server-internal goroutine, and works identically in browser and Electron modes.
- **Context stored as two flat strings**: Simpler than a structured object; sufficient for scoring multiple `selectedText` matches. Asymmetric windows at document boundaries are handled gracefully.
- **`line` uses newline-based content-relative counting**: A single canonical coordinate system shared by the server (R9) and client rendering (R14). Replaces the current ProseMirror block-index system.
- **`line` stays in the schema**: Preserved as a display hint for backwards compatibility. Read-only on the client after creation.

## Dependencies / Assumptions

- The client must pass a plain-text rendering of `.quipu` documents alongside the `/frame/resolve` request body (R10). This requires a change in all four dual-runtime layers (Go endpoint, Electron IPC handler, preload bridge, service adapter).
- `src/types/editor.ts` and `src/services/frameService.ts` both define `FrameAnnotation`; they must be consolidated or kept in sync as part of this work (R14).

## Outstanding Questions

### Resolve Before Planning

_(none — all product behavior is resolved)_

### Deferred to Planning

- [Affects R8][Technical] How should the Electron IPC handler for `/frame/resolve` be structured — inline in the save handler or as a separate IPC channel?
- [Affects R10][Technical] How should the client pass its plain-text rendering alongside the `.quipu` save — as an extra field in the existing write request body, or as a separate field in the `/frame/resolve` payload?
- [Affects R2][Needs research] What context window size gives reliable disambiguation without bloating FRAME files? 80 chars per side is the starting point; validate against real documents during planning.
- [Affects R9][Technical] What string similarity metric should the server use to score `contextBefore`/`contextAfter` candidates — character-level overlap ratio, common-prefix/suffix length, or token intersection?

## Next Steps

→ `/ce:plan` for structured implementation planning
