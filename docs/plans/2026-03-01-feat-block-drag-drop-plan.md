---
title: "feat: Block Drag & Drop — Notion-Style Block Reordering"
type: feat
status: active
date: 2026-03-01
---

# Block Drag & Drop — Notion-Style Block Reordering

## Overview

Enable Notion-style block dragging in the TipTap editor. When hovering near the left edge of any block, a drag handle appears. Dragging an H1 heading moves the entire section (all content until the next H1). Dragging any other block moves just that block. Visual feedback includes a drop indicator line and ghost preview.

## Problem Statement

Users cannot reorder content blocks by dragging. The only way to reorganize content is cut/paste, which is slow and error-prone for large sections. Notion and other modern editors have set the expectation that blocks should be draggable.

## Proposed Solution

Create a custom TipTap extension (`BlockDragHandle`) that adds ProseMirror decorations for drag handles and handles the drag-and-drop transaction as a single atomic operation.

### Architecture

**New extension:** `src/extensions/BlockDragHandle.js`

Using ProseMirror plugins (following the pattern of `RevealMarkdown.js`):
1. **Decoration plugin**: Renders drag handle widgets at the left edge of each top-level block
2. **Event handler plugin**: Manages `dragstart`, `dragover`, `dragend`, `drop` DOM events
3. **Single transaction**: Block move uses `tr.delete().insert()` in one ProseMirror transaction for undo atomicity

### Drag Handle Behavior

- **Trigger zone**: Handle appears when mouse is within 48px of the left content edge (inside the page padding area)
- **Appearance**: 6-dot braille icon (`⠿`), 20px, rendered as a `Decoration.widget`
- **Positioning**: Absolute, 24px left of the content edge, vertically centered on the first line of the block
- **Visibility**: Fade in on hover (opacity 0 -> 0.6 over 150ms), hide during text selection
- **Theme-aware**: Uses `text-text-tertiary` token for the icon color

### Section Semantics (H1 Drag)

When dragging an H1 heading, the "section" includes:
- The H1 node itself
- All subsequent nodes until (but not including) the next H1 or end of document

**Section boundary computation:**
```javascript
function getSectionRange(doc, headingPos) {
  const resolvedPos = doc.resolve(headingPos);
  const startIndex = resolvedPos.index(0); // index of the H1 in the doc
  let endIndex = startIndex + 1;

  // Walk forward through top-level nodes
  for (let i = startIndex + 1; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === 'heading' && node.attrs.level === 1) break;
    endIndex = i + 1;
  }

  const from = resolvedPos.start(0) + doc.child(startIndex).nodeSize * 0; // recalc
  // ... compute exact positions
  return { from, to };
}
```

**Non-H1 blocks**: Drag only the single top-level node. This includes:
- Paragraphs
- H2, H3, H4 headings (drag individually, NOT as sections)
- Bullet lists (entire `bulletList` node, not individual items)
- Ordered lists (entire `orderedList` node)
- Blockquotes (entire node with children)
- Code blocks
- Tables (entire table node)
- Horizontal rules

### Visual Feedback

**Drop indicator line:**
- 2px solid line using `--color-accent`
- Full content width (matches editor page width)
- Rendered as a ProseMirror decoration at the nearest valid drop position
- Snaps to positions between top-level blocks only

**Ghost preview:**
- Browser's default drag image (content is HTML, so the browser renders it)
- 0.5 opacity applied via `e.dataTransfer.setDragImage()`
- For large H1 sections, the ghost may be tall — this is acceptable

**Source block dimming:**
- While dragging, the source block(s) get `opacity: 0.3` via a CSS class

### The Move Transaction

```javascript
function moveBlock(tr, from, to, targetPos) {
  // Single transaction: slice content, delete source, insert at target
  const slice = tr.doc.slice(from, to);
  // Adjust target position based on whether we're moving up or down
  const mappedTarget = from < targetPos ? targetPos - (to - from) : targetPos;
  tr.delete(from, to);
  tr.insert(mappedTarget, slice.content);
  return tr;
}
```

This produces a single undo step — Ctrl+Z fully reverses the drag.

## Technical Considerations

### FRAME Annotation Reconciliation

FRAME annotations store line numbers via `posToLineNumber`. After a drag, all line numbers below the moved block shift. The existing `extractComments()` in the `onUpdate` handler will naturally re-extract comments from the new document state, updating positions. However, FRAME sidecar files need to be updated:

- After drag, re-run `extractComments()` (already happens via `onUpdate`)
- Fire-and-forget FRAME update: recalculate annotation line numbers and write back to `.frame.json`
- Since FRAME writes are already fire-and-forget with `.catch()`, this adds minimal overhead

### What NOT to Drag

- **Display title** (React element, outside ProseMirror DOM) — no handle shown
- **Empty paragraphs** with placeholder text — no handle shown
- **Frontmatter** (rendered by FrontmatterProperties component, above editor) — not draggable
- **Individual list items** — only the entire list is draggable (ProseMirror constraint)

### Interaction with Existing Features

- **Bubble menu**: Hide drag handle when there is an active text selection (bubble menu takes priority)
- **Comment marks**: Preserved during move (slice preserves marks)
- **RevealMarkdown decorations**: Recalculated naturally after the transaction
- **Content change callback**: Fires once after the move transaction, setting isDirty

### Keyboard Alternative (Future)

Alt+Shift+Up/Down for block movement without mouse. Out of scope for v1, but the move transaction function can be reused.

### Known Limitations (v1)

- H2/H3 do NOT drag as sections (only H1). Hierarchical section drag is a future enhancement.
- Individual list items cannot be dragged out of their list — the entire list moves as one unit.
- No touch/mobile support (hover-based handle trigger). Desktop-only for v1.
- No drag-and-drop between different editor instances (single editor).

## Acceptance Criteria

- [ ] Drag handle appears when hovering within 48px of left content edge
- [ ] Handle is a 6-dot icon, fades in/out smoothly
- [ ] Handle is themed correctly across light, dark, and tinted themes
- [ ] Dragging any block shows a drop indicator line between blocks
- [ ] Dragging an H1 selects and moves all content until the next H1
- [ ] Dragging a non-H1 block moves only that block
- [ ] Entire lists (bullet/ordered) move as one unit
- [ ] Tables move as one unit
- [ ] Drop indicator snaps to valid positions (between top-level blocks)
- [ ] Source block dims to 0.3 opacity while dragging
- [ ] Ctrl+Z fully undoes the drag in a single step
- [ ] Ctrl+Shift+Z redoes the drag
- [ ] Comment marks are preserved after drag
- [ ] Document is marked dirty after drag
- [ ] Handle does NOT appear on display title or empty placeholder paragraphs
- [ ] No handle appears during text selection
- [ ] FRAME annotations reconcile to correct line numbers after drag
- [ ] Markdown files save correctly after block reordering

## Dependencies & Risks

- **ProseMirror drag-and-drop API** — Complex, requires careful handling of position mapping during delete+insert
- **Risk**: Position calculation errors during drag could corrupt document structure. Extensive testing needed.
- **Risk**: Large section drags (50+ blocks) could cause visible lag during ghost preview generation
- **tiptap-markdown**: Must handle reordered content correctly. Tables at new positions must still serialize.

## Sources

- RevealMarkdown extension pattern: [src/extensions/RevealMarkdown.js](src/extensions/RevealMarkdown.js)
- Editor component: [src/components/Editor.jsx](src/components/Editor.jsx)
- ProseMirror styles: [src/styles/prosemirror.css](src/styles/prosemirror.css)
- Theme tokens: [src/styles/theme.css](src/styles/theme.css) — `text-text-tertiary`, `--color-accent`
- FRAME annotation handling: [Editor.jsx lines 253-316](src/components/Editor.jsx)
- Solution doc: [docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md](docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md) — toolbar patterns, ProseMirror extension conventions
