---
title: "fix: Title & Frontmatter UI Fixes"
type: fix
status: active
date: 2026-03-01
---

# Title & Frontmatter UI Fixes

## Overview

Three UI issues in the editor header area need fixing: the display title wrapping causes frontmatter to overlap, frontmatter should default to collapsed, and tag arrays in frontmatter need add/delete support plus an "edit raw" button.

## Problem 1: Title Wrapping Causes Frontmatter Overlap

When the filename is long enough to wrap to two lines, the frontmatter properties panel renders on top of/behind the title text instead of below it.

**Root cause:** The display title at [Editor.jsx:639-643](src/components/Editor.jsx) likely uses fixed height or absolute positioning that doesn't account for multi-line titles.

**Fix:** Ensure the title container uses natural flow layout (`min-h-fit` or remove any fixed height). The frontmatter section must render below the title in normal document flow, never overlapping.

### Editor.jsx (title area fix)

```jsx
{/* Display title — remove any fixed height, let it wrap naturally */}
<h1 className="text-3xl font-bold font-editor text-page-text select-none break-words">
  {displayTitle}
</h1>
```

## Problem 2: Frontmatter Collapsed by Default

Currently `frontmatterCollapsed` defaults to `false` in the tab state, so frontmatter is always expanded when opening a file.

**Fix:** Change the default to `true` in `WorkspaceContext.jsx` where tabs are created.

### WorkspaceContext.jsx (default collapsed)

```javascript
// In openFile(), when creating the tab object:
frontmatterCollapsed: true, // was: false
```

## Problem 3: Tag Array Management + Edit Raw

The frontmatter properties editor renders arrays as Badges but provides no way to add or remove individual tags. Additionally, there's no way to edit the raw YAML directly.

**Fix — Tag management:**
- For array-type values, render each tag as a Badge with an X button to remove
- Add a small "+" button or input at the end to add new tags
- Clicking the tag text makes it editable inline

**Fix — Edit Raw button:**
- Add a small "Edit Raw" toggle button in the frontmatter header
- When active, replace the structured property editor with a `<textarea>` showing the raw YAML
- On blur/save, re-parse the YAML. If invalid, show the error state (already implemented for malformed YAML)

### FrontmatterProperties.jsx (tag management)

```jsx
{/* For array values — render editable tags */}
{Array.isArray(value) && (
  <div className="flex flex-wrap gap-1 items-center">
    {value.map((tag, i) => (
      <Badge key={i} className="group/tag gap-1 pr-1">
        <span
          className="cursor-text"
          onClick={() => handleEditTag(key, i)}
        >
          {String(tag)}
        </span>
        <button
          className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
          onClick={() => handleRemoveTag(key, i)}
        >
          <XIcon size={12} />
        </button>
      </Badge>
    ))}
    <button
      className="text-xs text-text-secondary hover:text-accent"
      onClick={() => handleAddTag(key)}
    >
      <PlusIcon size={14} />
    </button>
  </div>
)}
```

### FrontmatterProperties.jsx (edit raw toggle)

```jsx
{/* In the collapsible header */}
<div className="flex items-center gap-2">
  <span className="text-xs font-medium text-page-text/60">Properties</span>
  <button
    className="text-xs text-text-secondary hover:text-accent"
    onClick={(e) => { e.stopPropagation(); setIsEditingRaw(!isEditingRaw); }}
  >
    {isEditingRaw ? 'Structured' : 'Edit Raw'}
  </button>
</div>

{/* Raw YAML editor */}
{isEditingRaw ? (
  <textarea
    className="w-full font-mono text-xs bg-page-bg text-page-text border border-page-border rounded p-2 min-h-[80px] resize-y"
    defaultValue={yaml.dump(frontmatter)}
    onBlur={(e) => handleRawYamlSave(e.target.value)}
  />
) : (
  /* existing structured property editor */
)}
```

## Technical Considerations

- **Tag operations** need new WorkspaceContext methods: `addFrontmatterTag(tabId, key, value)`, `removeFrontmatterTag(tabId, key, index)`, `updateFrontmatterTag(tabId, key, index, newValue)`
- **Edit raw** re-parses YAML on blur. Use `js-yaml.load()` with try/catch. On parse error, show toast and keep textarea open.
- **Title wrapping**: Test with filenames like `this-is-a-very-long-filename-that-should-definitely-wrap-to-multiple-lines.md`

## Acceptance Criteria

- [ ] Long filenames wrap naturally without overlapping frontmatter
- [ ] Frontmatter is collapsed by default when opening any file
- [ ] Array values show individual tags with X buttons to remove
- [ ] "+" button adds a new empty tag to an array
- [ ] "Edit Raw" button toggles between structured and raw YAML editing
- [ ] Invalid raw YAML shows error toast and stays in edit mode
- [ ] All changes mark the tab as dirty

## Sources

- [src/components/Editor.jsx](src/components/Editor.jsx) — display title rendering
- [src/components/FrontmatterProperties.jsx](src/components/FrontmatterProperties.jsx) — frontmatter UI
- [src/context/WorkspaceContext.jsx](src/context/WorkspaceContext.jsx) — frontmatter state management
- Frontmatter plan: [docs/plans/2026-02-28-feat-markdown-frontmatter-reveal-syntax-plan.md](docs/plans/2026-02-28-feat-markdown-frontmatter-reveal-syntax-plan.md)
