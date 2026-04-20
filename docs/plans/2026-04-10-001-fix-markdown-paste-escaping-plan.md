---
title: "fix: Prevent backslash escaping of markdown special characters on paste"
type: fix
status: completed
date: 2026-04-10
---

# fix: Prevent backslash escaping of markdown special characters on paste

## Overview

When pasting text that contains markdown special characters (`*`, `_`, `[`, `]`, `` ` ``, `~`, `#`, `-`, `>`) via Ctrl+V or Ctrl+Shift+V, the characters are backslash-escaped in the saved file (e.g., `\*bold\*` instead of `*bold*`). The fix routes all text paste through the `tiptap-markdown` parser so that markdown syntax produces semantic nodes rather than raw text nodes — semantic nodes serialize cleanly without escaping.

## Problem Frame

`prosemirror-markdown`'s `esc()` function is called by the markdown serializer on every text node and escapes characters that would otherwise trigger markdown interpretation. This is correct for text that is genuinely literal. The problem is that two paste code paths bypass the markdown parser and insert raw text nodes instead of semantic nodes:

**Path A — Ctrl+Shift+V (plain-text paste):**
`tiptap-markdown`'s `MarkdownClipboard` extension registers a `clipboardTextParser` that returns `null` when `plainText === true` (clipboard.js:20). ProseMirror then falls back to inserting the clipboard text verbatim as text nodes. The serializer later escapes every `*`, `[`, etc. in those nodes.

**Path B — Ctrl+V when clipboard contains `text/html`:**
ProseMirror's default paste handling prefers `text/html` over `text/plain`. When the clipboard contains HTML (common when copying from any browser or rich-text app), `clipboardTextParser` is never called at all. The HTML parser produces text nodes that carry unescaped markdown syntax, which the serializer then escapes on save.

Path B explains why Ctrl+V also exhibits the bug despite `transformPastedText: true` being set — that option only governs the `clipboardTextParser` path, which is skipped when HTML is present.

## Requirements Trace

- R1. Pasting via Ctrl+V must not introduce backslash escapes on markdown special characters.
- R2. Pasting via Ctrl+Shift+V must not introduce backslash escapes on markdown special characters.
- R3. Image paste (Ctrl+V with image in clipboard) must continue to work unchanged.
- R4. The fix must not corrupt content for existing open files.

## Scope Boundaries

- Non-goal: changing serialization behavior for non-paste operations.
- Non-goal: upgrading `tiptap-markdown` from v0.9.0.
- Non-goal: altering copy behavior (`transformCopiedText` is unrelated to this bug).
- Non-goal: supporting HTML-rich paste that preserves colours, fonts, etc. — this editor's content model is markdown, so all paste converts to the markdown node set.

## Context & Research

### Relevant Code and Patterns

- `src/components/editor/Editor.tsx:459-465` — `Markdown.configure({ transformPastedText: true, ... })` — the existing markdown extension config.
- `src/components/editor/Editor.tsx:583-599` — existing `editorProps.handlePaste` — image paste handler, returns `false` for non-image, which triggers ProseMirror's default paste flow.
- `node_modules/tiptap-markdown/src/extensions/tiptap/clipboard.js:19-28` — `MarkdownClipboard`'s `clipboardTextParser`: the `if (plainText || !this.options.transformPastedText) return null` early exit is the precise bypass for Path A. The block below it shows the full parse-and-slice pattern to replicate: `this.editor.storage.markdown.parser.parse(text, { inline: true })` → `DOMParser.fromSchema(schema).parseSlice(elementFromString(html), ...)`.
- `node_modules/tiptap-markdown/src/extensions/tiptap/clipboard.js:33-37` — `clipboardTextSerializer`: shows how `editor.storage.markdown.serializer` is accessed, confirming the storage API is stable.

### Institutional Learnings

- The `[` escaping in `tiptap-markdown` was previously identified for the WikiLink extension (plan 2026-04-03-001). The documented fix pattern — convert content to a proper node type so the custom serializer writes it directly, bypassing `esc()` — applies here too. Our fix achieves the same outcome by ensuring paste creates semantic nodes (bold, link, heading, etc.) rather than text nodes.
- If the paste fix uses `setContent()` programmatically, pass `{ emitUpdate: false }` to avoid false dirty-state marking (docs/solutions/ui-bugs/false-dirty-state-on-file-open.md). **However**, paste is a user action, so `emitUpdate: true` (the default) is correct here — dirty state should fire.

## Key Technical Decisions

- **Intercept at `handlePaste` rather than overriding `clipboardTextParser`**: `handlePaste` runs before ProseMirror's default paste flow, giving full control over both HTML-clipboard and plain-text-clipboard cases. A `clipboardTextParser` override alone cannot fix Path B (HTML clipboard), so `handlePaste` is the right intercept point.
- **Always prefer `text/plain` for text paste**: This editor's content model is markdown. Discarding `text/html` in favour of `text/plain` and re-parsing as markdown is the correct semantic choice. Accepting raw HTML would still produce text nodes with unescaped chars in many cases.
- **Reuse `editor.storage.markdown.parser` rather than instantiating a new markdown-it**: The storage parser is already configured with the same plugins and rules as the rest of the editor. Creating a second instance would risk divergence.
- **Whether to apply the fix conditionally by file type** (e.g., only for `.md` files): Deferred to implementation. For `.quipu` files the editor saves as TipTap JSON, so `esc()` never runs, meaning the bug doesn't manifest for `.quipu`. It is safe to apply the fix unconditionally — it produces better nodes regardless of file type.

## Open Questions

### Resolved During Planning

- **Is `clipboardTextParser` called for Ctrl+V when clipboard has HTML?** — No. ProseMirror only calls `clipboardTextParser` when the clipboard contains no `text/html`. With HTML present, it goes through the DOM parser directly, bypassing all `clipboardTextParser` plugins.
- **Does `transformPastedText: true` fix Ctrl+V?** — Only when the clipboard contains plain text. For HTML clipboard content, it has no effect.

### Deferred to Implementation

- **Exact insertion API**: The implementer should evaluate `editor.commands.insertContent(html)` vs. building a ProseMirror slice manually (`DOMParser.fromSchema(schema).parseSlice(el, { preserveWhitespace: true, context })`) followed by `view.dispatch(tr.replaceSelection(slice))`. The `clipboard.js:23-28` code shows the manual slice approach; the editor command is simpler but may behave differently at selection boundaries. Choose whichever produces clean behaviour on a collapsed cursor and an active selection.
- **Whether to strip `text/html` entirely from the synthetic paste vs. passing an empty HTML string**: ProseMirror's `handlePaste` intercept returns `true` to signal the event is handled, so this is moot — the default flow never runs.

## Implementation Units

- [ ] **Unit 1: Expand `handlePaste` to always route text through the markdown parser**

**Goal:** Eliminate both paste escape paths by taking ownership of all non-image text paste in `handlePaste`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `src/components/editor/Editor.tsx`

**Approach:**
- In the existing `handlePaste` (lines 583-599), after the image loop exits without finding an image, check for `text/plain` in `event.clipboardData`.
- If found: call `editor.storage.markdown.parser.parse(text, { inline: true })` to obtain an HTML string, then insert the parsed content into the editor. Return `true` to consume the event.
- If no `text/plain` is present (rare — binary-only clipboard), return `false` and let ProseMirror handle it as before.
- The `inline: true` parse option (matching what `clipboard.js:23` does) prevents wrapping the result in an extra block when pasting inline.
- Preserve the existing image branch exactly as-is.

**Patterns to follow:**
- Existing image paste handler: `src/components/editor/Editor.tsx:584-599`
- `MarkdownClipboard.clipboardTextParser` parse-and-insert pattern: `node_modules/tiptap-markdown/src/extensions/tiptap/clipboard.js:19-28`

**Test scenarios:**
- Happy path: paste `**bold**` → editor contains a bold node; saved markdown contains `**bold**`, not `\*\*bold\*\*`
- Happy path: paste `[link text](https://example.com)` → link node; saved as `[link text](https://example.com)`, not `\[link text\](https://example.com)`
- Happy path: paste `# Heading` → heading node; saved as `# Heading`, not `\# Heading`
- Happy path: paste `- item one\n- item two` → bulletList with two items; saved as `- item one\n- item two`, not `\- item one\n\- item two`
- Happy path: paste plain prose with no markdown syntax (`Hello world`) → text node unchanged; no backslashes introduced
- Happy path: paste via Ctrl+Shift+V with `**bold**` → same outcome as Ctrl+V; no escaping
- Edge case: paste image → image upload flow proceeds unchanged; no regression on R3
- Edge case: paste with active selection → selected text is replaced by pasted content (not appended)
- Edge case: paste empty string → no crash, no content inserted
- Error path: `editor.storage.markdown.parser` unavailable (e.g., extension not initialized) → fall through gracefully by returning `false` rather than throwing

**Verification:**
- Paste `**bold text**` into a `.md` file, save, and inspect the file on disk — no backslashes present around the asterisks.
- Paste `[link](url)` — saved file shows `[link](url)`, not `\[link\]\(url\)`.
- Image paste still triggers the upload flow.
- TypeScript compiles with no errors (`npx tsc --noEmit`).

---

- [ ] **Unit 2: Add paste regression tests**

**Goal:** Ensure the markdown parser produces correct, unescaped markdown output for common paste patterns, preventing silent regressions.

**Requirements:** R1, R2

**Dependencies:** Unit 1 complete

**Files:**
- Create: `src/__tests__/markdownPaste.test.ts`

**Approach:**
- These tests cannot use the real clipboard API in jsdom. Test the parsing logic directly: instantiate the markdown parser from `tiptap-markdown` (or replicate the parse call with `editor.storage.markdown.parser.parse(text)`) and assert that the serialized output of the resulting document matches the input.
- The test entry points should match what `handlePaste` calls: `parse(text, { inline: true })` → HTML → check the HTML or, if the full editor can be instantiated in tests, serialize back and compare.
- Follow the existing pattern in `src/__tests__/editorComments.test.ts` — keep tests focused on logic, not on DOM interaction.

**Patterns to follow:**
- `src/__tests__/editorComments.test.ts` — lightweight logic tests with vitest

**Test scenarios:**
- Happy path: `parse("**bold**")` output does not contain `\*`
- Happy path: `parse("[text](url)")` output does not contain `\[` or `\]`
- Happy path: `parse("# Heading")` output does not contain `\#`
- Happy path: `parse("- list item")` output does not contain `\-`
- Happy path: `parse("plain text with no syntax")` output equals input (no escaping, no injection)
- Edge case: `parse("")` does not throw
- Edge case: `parse("already\\escaped")` — verify the parser handles pre-escaped content predictably (document what the expected output is rather than asserting it must round-trip perfectly, since `\\` in input is legitimately a backslash)

**Verification:**
- `npm run test:run` passes with no failures.

## System-Wide Impact

- **Interaction graph:** `handlePaste` runs for every paste event in the editor. No other components observe paste events; the change is localized to the TipTap `editorProps`. The `MarkdownClipboard` plugin's `clipboardTextParser` will no longer be invoked for text paste (since `handlePaste` returns `true` first), but its `clipboardTextSerializer` for copy is unaffected.
- **Error propagation:** If `editor.storage.markdown.parser` is unexpectedly absent, the handler must return `false` (not throw) so the user still gets some paste behavior from ProseMirror's fallback.
- **State lifecycle risks:** Returning `true` from `handlePaste` suppresses ProseMirror's `undoDepth` grouping for the paste. Confirm that the paste is properly recorded in the undo history via the dispatch call or editor command used for insertion.
- **API surface parity:** No other components or services interact with paste. The Go server and Electron IPC are not involved.
- **Unchanged invariants:** Save/load logic, the markdown serializer for non-paste operations, copy behavior, and the image upload flow are all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `editor.storage.markdown.parser` API may differ in `tiptap-markdown` v0.9.0 vs. the clipboard.js source code | Read `clipboard.js:23` as the ground-truth reference for the exact call signature before implementing |
| Returning `true` from `handlePaste` for all text paste may suppress ProseMirror undo grouping | Verify undo behaviour manually; use `editor.commands.insertContent` (which wraps in a transaction) to ensure undo is recorded |
| Pasting content that `markdown-it` cannot parse (e.g., ambiguous inline syntax) may produce unexpected nodes | The result is still better than escaped text; document any known edge cases discovered during manual testing |
| Image paste regression if the `text/plain` branch runs before the image branch | Image detection must remain the first check in `handlePaste` (it already is) |

## Sources & References

- Related code: `src/components/editor/Editor.tsx:459-465, 583-599`
- Related code: `node_modules/tiptap-markdown/src/extensions/tiptap/clipboard.js`
- Related plan (WikiLink `[` escaping): `docs/plans/2026-04-03-001-fix-bugfix-polish-sprint-april-2-plan.md`
