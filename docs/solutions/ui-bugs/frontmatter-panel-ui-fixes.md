---
title: Frontmatter Panel UI Fixes - Title Wrapping, Auto-Collapse, and Tag Management
problem_type: ui-bug
component: FrontmatterProperties, Editor
symptoms:
  - Long filenames wrapped to multiple lines, causing frontmatter properties panel to overlap title text
  - Frontmatter panel always expanded on file open despite user preference
  - Array/tag fields in frontmatter were read-only with no way to add/remove individual values
  - No ability to edit raw YAML directly
root_cause: Title had no wrapping protection (text-5xl overflow), frontmatterCollapsed defaulted to false, and TagEditor component was missing from array field rendering
solution_summary: Adjusted title styling for word-wrap and reduced font size, set frontmatterCollapsed default to true, added TagEditor component with inline add/remove/edit and raw YAML edit toggle
date: 2026-03-01
status: solved
tags:
  - frontmatter
  - yaml-editor
  - ui-layout
  - component-state
  - tag-management
  - tiptap-editor
---

# Frontmatter Panel UI Fixes

Three UI bugs in the editor's frontmatter panel were fixed together: title overflow causing layout overlap, incorrect default panel state, and missing tag management for array-type YAML fields.

## Symptoms

1. **Title/frontmatter overlap**: Opening a file with a long name caused the `h1` display title to wrap and visually overlap the frontmatter properties panel beneath it.
2. **Frontmatter always expanded**: Every file open expanded the frontmatter panel, even though the intended default is collapsed.
3. **Read-only array fields**: Frontmatter `tags:` or other array fields showed plain Badge chips with no way to add new tags, remove existing ones, or edit inline. The only escape hatch was to not use frontmatter arrays.

## Root Cause

### Fix 1: Title overflow

`Editor.jsx` rendered the display title with `text-5xl` and no overflow constraint:

```jsx
<h1 className="text-5xl font-bold text-page-text mb-6 font-editor leading-tight tracking-tight select-none">
  {displayTitle}
</h1>
```

No `break-words`, `overflow-hidden`, or max-width was applied. Long filenames would spill out of the title's normal block flow and render on top of the frontmatter panel immediately below.

### Fix 2: Wrong default state

`WorkspaceContext.jsx` set `frontmatterCollapsed: false` in both tab-creation paths (regular files and media files), causing the panel to always open expanded.

### Fix 3: Missing TagEditor

`FrontmatterProperties.jsx` detected array types and rendered Badges, but provided no interaction — no callbacks wired, no add/remove UI. The context (`WorkspaceContext.jsx`) also had no methods for per-index tag operations.

## Solution

### Files Changed

| File | Change |
|------|--------|
| `src/components/Editor.jsx` | Title className: smaller size + `break-words`; forwarded tag callbacks to FrontmatterProperties |
| `src/context/WorkspaceContext.jsx` | Default `frontmatterCollapsed: true`; added `addFrontmatterTag`, `removeFrontmatterTag`, `updateFrontmatterTag` |
| `src/components/FrontmatterProperties.jsx` | Added `TagEditor` sub-component; added "Edit Raw" YAML toggle |
| `src/App.jsx` | Destructured and forwarded three new tag callbacks to `<Editor>` |

### Fix 1: Title wrapping

**`src/components/Editor.jsx`**

```jsx
// Before
<h1 className="text-5xl font-bold text-page-text mb-6 font-editor leading-tight tracking-tight select-none">
  {displayTitle}
</h1>

// After
<h1 className="text-3xl font-bold font-editor text-page-text select-none break-words mb-4">
  {displayTitle}
</h1>
```

Key changes: `text-5xl` → `text-3xl`, added `break-words`, removed `leading-tight tracking-tight`.

### Fix 2: Frontmatter collapsed by default

**`src/context/WorkspaceContext.jsx`** — two locations in `openFile()`:

```javascript
// Before (both the media tab path and the regular file path)
frontmatterCollapsed: false,

// After
frontmatterCollapsed: true,
```

### Fix 3: Tag management and Edit Raw

#### New context methods (`src/context/WorkspaceContext.jsx`)

```javascript
const addFrontmatterTag = useCallback((tabId, key, tagValue) => {
  setOpenTabs(prev => prev.map(t => {
    if (t.id !== tabId) return t;
    const existing = Array.isArray(t.frontmatter?.[key]) ? t.frontmatter[key] : [];
    return { ...t, frontmatter: { ...t.frontmatter, [key]: [...existing, tagValue] }, isDirty: true };
  }));
}, []);

const removeFrontmatterTag = useCallback((tabId, key, index) => {
  setOpenTabs(prev => prev.map(t => {
    if (t.id !== tabId) return t;
    const existing = Array.isArray(t.frontmatter?.[key]) ? [...t.frontmatter[key]] : [];
    existing.splice(index, 1);
    return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
  }));
}, []);

const updateFrontmatterTag = useCallback((tabId, key, index, newValue) => {
  setOpenTabs(prev => prev.map(t => {
    if (t.id !== tabId) return t;
    const existing = Array.isArray(t.frontmatter?.[key]) ? [...t.frontmatter[key]] : [];
    existing[index] = newValue;
    return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
  }));
}, []);
```

All three set `isDirty: true` automatically.

#### TagEditor sub-component (`src/components/FrontmatterProperties.jsx`)

```jsx
const TagEditor = ({ tags, fieldKey, tabId, onAddTag, onRemoveTag, onUpdateTag }) => {
  const [newTag, setNewTag] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState('');

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    onAddTag(tabId, fieldKey, trimmed);
    setNewTag('');
  };

  return (
    <div className="flex flex-wrap gap-1 items-center pt-0.5">
      {tags.map((tag, i) => (
        <Badge key={i} variant="secondary" className="group/tag gap-1 pr-1 text-xs font-mono">
          {editingIndex === i ? (
            <input
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={() => commitEdit(i)}
              onKeyDown={(e) => handleEditKeyDown(e, i)}
              style={{ width: `${Math.max(3, editingValue.length + 1)}ch` }}
            />
          ) : (
            <span onDoubleClick={() => startEditing(i, tag)} title="Double-click to edit">
              {String(tag)}
            </span>
          )}
          <button
            className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
            onClick={() => onRemoveTag(tabId, fieldKey, i)}
          >
            <X size={10} />
          </button>
        </Badge>
      ))}
      <input
        value={newTag}
        onChange={(e) => setNewTag(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
        placeholder="add tag…"
        className="text-xs font-mono bg-transparent outline-none w-[8ch] focus:w-[14ch] transition-all border-b border-transparent focus:border-page-border"
      />
    </div>
  );
};
```

Keyboard: `Enter` to add, `Escape` to cancel, double-click to edit inline.

#### Edit Raw toggle

The `CollapsibleTrigger` header now includes a button on the right that toggles between structured and raw YAML editing:

```jsx
const headerBtn = (
  <button
    className="ml-auto text-[10px] font-mono text-page-text/40 hover:text-accent transition-colors"
    onClick={(e) => { e.stopPropagation(); isEditingRaw ? handleExitRaw() : handleEnterRaw(); }}
  >
    {isEditingRaw ? 'Structured' : 'Edit Raw'}
  </button>
);
```

Raw YAML is saved on blur — if `js-yaml.load()` succeeds, the parsed object is diffed against the current frontmatter and applied key-by-key. If parsing fails, the textarea stays open (error is surfaced by keeping the invalid content visible):

```javascript
const handleRawBlur = () => {
  try {
    const parsed = jsYaml.load(rawYaml);
    if (typeof parsed === 'object' && parsed !== null) {
      const existingKeys = Object.keys(frontmatter || {});
      const newKeys = Object.keys(parsed);
      for (const k of existingKeys) {
        if (!newKeys.includes(k)) onRemove(tabId, k);
      }
      for (const [k, v] of Object.entries(parsed)) {
        onUpdate(tabId, k, v);
      }
    }
    setIsEditingRaw(false);
  } catch {
    // Keep textarea open so user can fix the YAML
  }
};
```

## Prevention & Best Practices

### Overflow prevention for large text

Always apply `break-words` (or `truncate`) to large text elements rendered in constrained flow:

```jsx
// Good
<h1 className="text-3xl font-bold break-words">{title}</h1>

// Risky — needs explicit overflow handling
<h1 className="text-5xl font-bold">{title}</h1>
```

Test long filenames at `text-4xl`+ before merging.

### State defaults as a single source of truth

Scattered boolean literals across multiple `openFile` code paths will drift. Define tab shape as a constant:

```javascript
const DEFAULT_TAB = {
  frontmatterCollapsed: true,
  isDirty: false,
  // ... other fields
};
const newTab = { ...DEFAULT_TAB, id: generateId(), name, path };
```

### Feature matrix for structured editors

Before building a property editor, map all supported types to their edit UI. Missing entries become read-only gaps:

| YAML type | Editor component | Editable | Add/Remove |
|-----------|-----------------|----------|------------|
| `string`  | `<Input>`       | Yes      | N/A        |
| `number`  | `<Input>`       | Yes      | N/A        |
| `boolean` | Toggle button   | Yes      | N/A        |
| `array`   | `<TagEditor>`   | Yes      | Yes        |
| `object`  | `<pre>` raw     | No       | No         |

### Checklist for frontmatter UI changes

- [ ] Large title text has `break-words` or `max-w-*` + `truncate`
- [ ] All tab-creation paths use the same `frontmatterCollapsed` default
- [ ] All YAML value types have a defined render path (no silent fallthrough)
- [ ] Array fields have add/remove/edit (not just display)
- [ ] `isDirty: true` is set on every mutation callback
- [ ] `e.stopPropagation()` on buttons inside `CollapsibleTrigger`
- [ ] Keyboard: `Enter` confirms, `Escape` cancels for all inline inputs

## Related Documentation

- [`docs/plans/2026-02-28-feat-markdown-frontmatter-reveal-syntax-plan.md`](../../../plans/2026-02-28-feat-markdown-frontmatter-reveal-syntax-plan.md) — Original frontmatter feature plan; full component design and YAML round-trip strategy
- [`docs/plans/2026-03-01-feat-file-title-display-plan.md`](../../../plans/2026-03-01-feat-file-title-display-plan.md) — Title display plan that introduced the `displayTitle` h1
- [`docs/solutions/ui-bugs/false-dirty-state-on-file-open.md`](./false-dirty-state-on-file-open.md) — `{ emitUpdate: false }` pattern for programmatic `setContent()` calls (same dirty-state discipline applies to frontmatter mutations)
- [`docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md`](./editor-overhaul-tabs-search-git.md) — Tab state architecture; shows the full tab object shape and `snapshotTab` pattern
