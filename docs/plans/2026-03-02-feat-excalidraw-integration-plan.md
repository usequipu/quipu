---
title: "Excalidraw Integration: Open .excalidraw Files"
type: feat
status: active
date: 2026-03-02
note: PLAN ONLY — do not implement yet
---

# Excalidraw Integration: Open .excalidraw Files

> **Note:** This is a plan-only document. Implementation is deferred.

## Overview

Add the ability to open and edit `.excalidraw` files directly in Quipu, similar to how Obsidian supports Excalidraw via the [obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin). This would allow users to create and edit diagrams, sketches, and visual notes without leaving the editor.

## Problem Statement / Motivation

Visual thinking and diagramming are essential for documentation, architecture planning, and brainstorming. Currently, users must use external tools for diagrams. Excalidraw is the de facto standard for hand-drawn-style diagrams in the dev community, and `.excalidraw` files are common in repos (especially those using Obsidian).

## Proposed Solution

### File Detection & Routing

- Detect `.excalidraw` file extension in the file open pipeline (similar to how `.md`, `.quipu`, and media files are routed)
- Route to a dedicated `ExcalidrawViewer` component instead of the TipTap editor or MediaViewer
- File format: `.excalidraw` files are JSON containing Excalidraw scene data

### Excalidraw React Component

- Use the official `@excalidraw/excalidraw` React package
- Embed the Excalidraw canvas in the editor area (replacing the TipTap editor for `.excalidraw` files)
- Load scene data from file JSON → pass to Excalidraw component
- Save: serialize Excalidraw scene state back to JSON and save via fileSystem service
- Support dirty state tracking (mark tab dirty when canvas changes)

### Integration Points

- **File tree**: Show a distinctive icon for `.excalidraw` files (Phosphor `PencilLine` or `Scribble`)
- **Tabs**: `.excalidraw` files open in tabs alongside regular files
- **Save**: Ctrl+S saves the current Excalidraw state as JSON
- **New file**: Allow creating new `.excalidraw` files from File > New or explorer context menu

### Obsidian Compatibility

The Obsidian Excalidraw plugin stores additional metadata in the `.excalidraw` files:
- Embedded images as base64 in the `files` field
- Text elements linked to Obsidian notes via `[[wikilinks]]`
- Custom metadata in the scene `appState`

For compatibility:
- Preserve all unknown fields when loading/saving (don't strip Obsidian-specific data)
- Render embedded images from the `files` field
- Optionally: resolve `[[wikilinks]]` as clickable links to workspace files

## Technical Considerations

- **Bundle size**: `@excalidraw/excalidraw` is ~1.5MB gzipped — significant impact on initial load
  - Mitigation: Dynamic import with `React.lazy()` and `Suspense`
  - Only loaded when user opens an `.excalidraw` file
- **Dual runtime**: Excalidraw is purely frontend — no backend changes needed for basic support
- **Collaboration**: Excalidraw supports real-time collaboration via WebSocket — future enhancement, not MVP
- **Export**: Consider adding PNG/SVG export options via Excalidraw's built-in export API

## Architecture

```
.excalidraw file opened
        ↓
WorkspaceContext detects extension
        ↓
Routes to ExcalidrawViewer (lazy loaded)
        ↓
ExcalidrawViewer renders @excalidraw/excalidraw
        ↓
Canvas edits → dirty state → Ctrl+S saves JSON
```

## Acceptance Criteria (Future)

- [ ] `.excalidraw` files open in a full-canvas Excalidraw editor
- [ ] Changes are saved as JSON on Ctrl+S
- [ ] Tab shows dirty indicator when canvas is modified
- [ ] Obsidian-created `.excalidraw` files open correctly (images, metadata preserved)
- [ ] Excalidraw component is lazy-loaded (no impact on initial bundle)
- [ ] New `.excalidraw` files can be created from the file explorer

## Dependencies

- `@excalidraw/excalidraw` — official React component (~1.5MB gzipped)
- No backend changes for MVP

## Open Questions

1. **Excalidraw version pinning**: Should we pin to a specific version for stability, or track latest?
2. **Dark mode**: Excalidraw has its own theme system — should it follow Quipu's theme or be independent?
3. **Library support**: Excalidraw has a shape library feature — should we support loading custom libraries?
4. **Collaboration**: Is real-time collaboration (via Excalidraw's WebSocket) in scope for a future phase?

## Sources & References

- Obsidian Excalidraw Plugin: https://github.com/zsviczian/obsidian-excalidraw-plugin
- Excalidraw React: https://www.npmjs.com/package/@excalidraw/excalidraw
- Excalidraw GitHub: https://github.com/excalidraw/excalidraw
