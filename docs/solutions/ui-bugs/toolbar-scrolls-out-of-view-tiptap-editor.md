---
title: "Fix TipTap toolbar scrolling out of view on long documents"
date: "2026-03-01"
category: "ui-bugs"
tags: ["tiptap", "toolbar", "react", "layout", "scroll", "sticky", "flexbox"]
symptoms:
  - "Rich text formatting toolbar scrolls out of view when users scroll down on long documents"
  - "Toolbar disappears mid-document, blocking access to bold/italic/heading controls"
root_cause: "Toolbar was positioned inside the scrollable page content div, causing it to scroll with the document"
solution_type: "layout_fix"
components: ["Editor.jsx"]
related_files: ["src/components/Editor.jsx"]
severity: "medium"
---

# Fix: TipTap Toolbar Scrolls Out of View on Long Documents

## Symptoms

- Rich text formatting toolbar (bold, italic, headings, lists, etc.) scrolls out of view when
  scrolling down on long documents
- Toolbar is inaccessible without scrolling back to the top of the document
- Obsidian/Rich Text mode toggle button also disappears

## Root Cause

The toolbar was nested inside the scrollable page content div. The page div used `overflow-y-auto`
for scrolling, so any child — including the toolbar — scrolled with the content.

To make the toolbar span the full page width, it used negative margins (`-mx-16 -mt-16`) to escape
the page's `p-16` padding. This was a layout smell: the toolbar was fighting its container rather
than being positioned correctly in the hierarchy.

## Solution

Restructure the component layout from a single scrollable flex row to a **flex column** with the
toolbar as a fixed sibling above the scrollable content area.

### Before

```jsx
<div className="flex h-full w-full bg-bg-surface overflow-hidden">
  <div className="flex-1 flex justify-center items-start overflow-y-auto ...">
    <div ref={pageRef} className="w-[816px] ... p-16">

      {/* Toolbar was INSIDE the scrollable page div */}
      {editorMode === 'richtext' && editor && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-page-border -mx-16 -mt-16 mb-4 bg-page-bg/50">
          {/* ... toolbar buttons ... */}
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  </div>
</div>
```

### After

```jsx
<div className="flex flex-col h-full w-full bg-bg-surface overflow-hidden">

  {/* Toolbar is now OUTSIDE the scroll container — always visible */}
  {editorMode === 'richtext' && editor && (
    <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-surface">
      {/* ... toolbar buttons ... */}
    </div>
  )}

  {editorMode === 'obsidian' && editor && (
    <div className="shrink-0 flex items-center justify-end px-4 py-1.5 border-b border-border bg-bg-surface">
      {/* mode toggle button */}
    </div>
  )}

  {/* Scrollable content area is now a sibling, not a parent */}
  <div className="flex-1 flex justify-center items-start overflow-y-auto relative py-12 px-16 ...">
    <div ref={pageRef} className="w-[816px] min-h-[1056px] bg-page-bg ...">
      <EditorContent editor={editor} />
    </div>
  </div>

</div>
```

## Key Changes

- Changed outer container from `flex` (row) to `flex flex-col` (column)
- Moved both toolbar variants (richtext and obsidian) to be direct children of the outer container,
  **before** the scrollable area
- Toolbar uses `shrink-0` to prevent height collapse and `border-b border-border` for visual separation
- Removed negative margins (`-mx-16 -mt-16 mb-4`) — no longer needed since toolbar isn't inside the page div
- Scrollable content area uses `flex-1 overflow-y-auto` to fill remaining vertical space

## Prevention Strategies

### The Correct Pattern for Fixed-Header + Scrollable-Body

```jsx
// Always structure two-zone layouts like this:
<div className="flex flex-col h-screen">
  {/* Fixed zone — never inside scroll container */}
  <div className="shrink-0 border-b border-border">
    <Toolbar />
  </div>

  {/* Scrollable zone */}
  <div className="flex-1 overflow-auto">
    <Content />
  </div>
</div>
```

**Key principles:**
- Parent is `flex flex-col` with a defined height
- Fixed controls get `shrink-0` and sit outside the scroll container
- Scrollable area gets `flex-1` + `overflow-auto`
- Toolbar and scrollable div are **siblings**, not parent/child

### Warning Signs

| Code Pattern | Problem |
|---|---|
| `<Toolbar />` nested inside `overflow-auto` div | Toolbar will scroll away |
| Toolbar uses negative margins to escape padding | Toolbar is fighting its container — wrong hierarchy |
| `position: sticky` on toolbar inside scroll container | Fragile; breaks if any ancestor has `overflow` set |
| No explicit height on the flex column parent | Scroll boundary undefined — unpredictable behavior |

### Code Review Checklist

- [ ] Is the toolbar a **sibling** of the scroll container, not a child?
- [ ] Does the toolbar have `shrink-0`?
- [ ] Does the outer container have `flex flex-col` with a defined height?
- [ ] Are there any negative margin hacks on the toolbar to escape its parent?

## Related Documentation

- [`docs/solutions/ui-bugs/editor-page-background-height.md`](editor-page-background-height.md) —
  Similar flexbox layout issue: editor background didn't extend with content. Root cause was
  `align-items: stretch` — fix was `align-items: flex-start`. Good companion read.
- [`docs/solutions/ui-bugs/resizable-panels-separator-gaps.md`](resizable-panels-separator-gaps.md) —
  Separator/visual artifact issues in the same editor layout.
- [`docs/solutions/ui-bugs/tailwind-v4-tiptap-typography-reset.md`](tailwind-v4-tiptap-typography-reset.md) —
  TipTap + Tailwind v4 preflight reset stripping prose styles.
- [`docs/solutions/ui-bugs/tiptap-rich-text-toolbar-mode-toggle.md`](tiptap-rich-text-toolbar-mode-toggle.md) —
  Original toolbar implementation: button layout, CSS classes, mode toggle, localStorage persistence.

## Related Plans

- [`docs/plans/2026-03-01-feat-editor-rich-text-mode-comment-ux-plan.md`](../../plans/2026-03-01-feat-editor-rich-text-mode-comment-ux-plan.md) —
  The feature plan that introduced the rich text toolbar.
