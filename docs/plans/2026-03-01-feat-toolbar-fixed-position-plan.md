# Plan: Rich Text Toolbar Fixed Under Tabs

## Context
The rich text toolbar (bold, italic, headings, etc.) is currently rendered inside the document page div and scrolls with content. It should be fixed under the tabs bar, above the scrollable document area.

## Files to Modify
- `src/components/Editor.jsx`

## Implementation

### Editor.jsx Restructure

1. Change outer wrapper from `flex` to `flex flex-col`:
```jsx
// Line 504: Change from
<div className="flex h-full w-full bg-bg-surface overflow-hidden">
// To
<div className="flex flex-col h-full w-full bg-bg-surface overflow-hidden">
```

2. Move toolbar JSX (currently lines 581-692, both richtext and obsidian bars) OUT of the page div. Place them as the FIRST children of the outer wrapper, BEFORE the scrollable area div.

3. The toolbar should use `shrink-0` to prevent collapsing:
```jsx
{editorMode === 'richtext' && editor && (
  <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-surface">
    ...toolbar buttons (same as before)...
    <div className="flex-1" />
    <button onClick={toggleEditorMode} ...>Rich Text</button>
  </div>
)}
{editorMode === 'obsidian' && (
  <div className="shrink-0 flex items-center justify-end px-4 py-1.5 border-b border-border bg-bg-surface">
    <button onClick={toggleEditorMode} ...>Obsidian</button>
  </div>
)}
```

4. Remove from toolbar divs: `-mx-16 mb-4 border-page-border bg-page-bg/50`
5. Add to toolbar divs: `border-border bg-bg-surface shrink-0`

6. The scrollable content area becomes the second child:
```jsx
<div className={cn(
  "flex-1 flex justify-center items-start overflow-y-auto relative",
  "py-12 px-16",
  ...responsive classes...
)}>
  <div className="w-[816px] ...page div...">
    {/* frontmatter, title, editor content - NO toolbar here */}
  </div>
  {/* comments track */}
</div>
```

## Verification
- Open a markdown file, confirm toolbar stays fixed while scrolling
- Toggle between richtext/obsidian modes, confirm toolbar changes
- Resize window, confirm responsive behavior still works
