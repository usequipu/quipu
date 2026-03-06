---
title: "File Creation Not Updating Explorer Tree and Incorrect Spacing"
date: 2026-03-05
category: ui-bugs
tags: [state-sync, tree-rendering, ui-layout, file-explorer]
severity: high
component: FileExplorer.jsx, WorkspaceContext.jsx
root_cause: "useEffect deps didn't include a version counter; handleCreateSubmit wasn't async; files lacked caret spacer"
related_prs: ["#34"]
---

# File Creation Not Updating Explorer Tree and Incorrect Spacing

## Symptom 1: File Creation Doesn't Update Tree

Creating a new file/folder via the explorer inline input either didn't show the new entry or required a manual refresh.

### Root Cause

Two issues combined:

1. **Stale useEffect deps**: `FileTreeItem`'s subdirectory-loading `useEffect` depended on `[entry.path, isExpanded, loadSubDirectory]`. After creation, `refreshDirectory()` updated the root `fileTree`, but expanded subdirectories didn't re-fetch because none of their deps changed.

2. **Non-async submit**: `handleCreateSubmit` called `createNewFile()` without `await`, then immediately reset `isCreating` and `createValue` — potentially before the async operation completed.

### Solution

**Added `directoryVersion` counter** (`WorkspaceContext.jsx`):

```javascript
const [directoryVersion, setDirectoryVersion] = useState(0);
```

Incremented in `createNewFile`, `createNewFolder`, `deleteEntry`, `renameEntry`:

```javascript
setDirectoryVersion(v => v + 1);
```

**Added to useEffect deps** (`FileExplorer.jsx`):

```javascript
useEffect(() => {
  if (entry.isDirectory && isExpanded) {
    loadSubDirectory(entry.path).then(setChildren);
  }
}, [entry.path, entry.isDirectory, isExpanded, loadSubDirectory, directoryVersion]);
```

**Made handleCreateSubmit async**:

```javascript
const handleCreateSubmit = useCallback(async () => {
  if (createValue) {
    if (isCreating === 'file') {
      await createNewFile(entry.path, createValue);
    } else {
      await createNewFolder(entry.path, createValue);
    }
  }
  setIsCreating(null);
  setCreateValue('');
}, [createValue, isCreating, entry.path, createNewFile, createNewFolder]);
```

## Symptom 2: Misaligned Files and Folders

Files and folders at the same depth appeared visually misaligned — file names were closer to the left edge than folder names.

### Root Cause

Folders render a 14px `CaretDownIcon`/`CaretRightIcon` before the file icon. Files had no equivalent spacer, so file names started ~14px earlier.

### Solution

Added invisible spacer for non-directory entries:

```jsx
{entry.isDirectory ? (
  isExpanded
    ? <CaretDownIcon size={14} className="shrink-0 text-text-tertiary" />
    : <CaretRightIcon size={14} className="shrink-0 text-text-tertiary" />
) : (
  <span className="shrink-0 w-[14px]" />
)}
```

## Prevention

- When adding state that should trigger tree refresh, always include a version counter pattern
- When adding icons/spacers to one item type in a list, check alignment with sibling item types

## Related

- [File Explorer Editor Integration](../integration-issues/file-explorer-editor-integration-fixes.md)
- [Hidden Dotfiles Filtered from Explorer](../ui-bugs/hidden-dotfiles-filtered-from-explorer.md)
