---
title: "Inline Git Diff Comparison Viewer in SourceControlPanel"
date: 2026-03-01
category: feature-implementation
component: SourceControlPanel
tags:
  - git-diff
  - ui-enhancement
  - inline-comparison
  - source-control
  - unified-diff-parsing
severity: medium
time_to_solve: ~1 hour
related_files:
  - src/components/SourceControlPanel.jsx
  - src/services/gitService.js
  - docs/plans/2026-03-01-feat-git-diff-comparison-viewer-plan.md
---

# Inline Git Diff Comparison Viewer in SourceControlPanel

## Problem

The Source Control panel displayed changed files with status badges (Modified, Added, Deleted, etc.) but users couldn't view the actual diff content without leaving the editor and running `git diff` in the terminal. This violated a key success criterion from the original brainstorm: "Side-by-side diff accurately shows changes for any modified file."

## Root Cause

Not a bug — a missing feature. The backend infrastructure already existed:
- **Electron**: `window.electronAPI.gitDiff(dirPath, file, staged)`
- **Browser**: `GET /git/diff?file=...&staged=true|false`

Both endpoints returned raw unified diff text, but the frontend wasn't consuming it. Only frontend changes were needed.

## Solution

Three additions to `src/components/SourceControlPanel.jsx`:

### 1. Diff Parser (`parseDiff` function)

Pure function that parses unified diff text into structured objects:

```jsx
function parseDiff(diffText) {
  if (!diffText) return [];
  const lines = diffText.split('\n');
  const result = [];
  let oldLine = 0, newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1]) - 1;
        newLine = parseInt(match[2]) - 1;
      }
      result.push({ type: 'header', text: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      newLine++;
      result.push({ type: 'add', text: line.slice(1), newLine });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      oldLine++;
      result.push({ type: 'remove', text: line.slice(1), oldLine });
    } else if (!line.startsWith('diff') && !line.startsWith('index') &&
               !line.startsWith('---') && !line.startsWith('+++')) {
      oldLine++;
      newLine++;
      result.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldLine, newLine });
    }
  }
  return result;
}
```

Key behaviors:
- Classifies lines by type: `header`, `add`, `remove`, `context`
- Tracks dual line numbers (old/new) through hunk headers
- Strips leading diff markers (`+`, `-`, ` `) from content
- Ignores file metadata lines (`diff`, `index`, `---`, `+++`)

### 2. DiffView Component

Renders parsed diff lines with color-coded styling:

```jsx
const DiffView = ({ diffText }) => {
  const lines = parseDiff(diffText);
  if (lines.length === 0) {
    return <div className="...">No diff available</div>;
  }
  return (
    <div className="bg-bg-base border-t border-border max-h-[300px] overflow-auto font-mono text-[11px] leading-[18px]">
      {lines.map((line, idx) => (
        <div key={idx} className={cn(
          "flex px-2 whitespace-pre",
          line.type === 'add' && "bg-git-added/10 text-git-added",
          line.type === 'remove' && "bg-git-deleted/10 text-git-deleted",
          line.type === 'header' && "bg-white/[0.03] text-accent font-semibold py-0.5",
          line.type === 'context' && "text-text-secondary",
        )}>
          <span className="w-8 text-right pr-2 shrink-0 opacity-50 select-none">
            {line.oldLine || ''}
          </span>
          <span className="w-8 text-right pr-2 shrink-0 opacity-50 select-none">
            {line.newLine || ''}
          </span>
          <span className="flex-1 min-w-0">{line.text}</span>
        </div>
      ))}
    </div>
  );
};
```

Features: dual line number columns, 300px max-height with independent scroll, uses existing theme tokens (`text-git-added`, `text-git-deleted`), graceful empty-state fallback.

### 3. Modified File Click Handler

Changed from sync (opening file in editor) to async (fetching and toggling inline diff):

```jsx
const handleFileClick = useCallback(async (filePath, isStaged = false) => {
  if (!workspacePath) return;

  // Toggle collapse if same file clicked again
  if (expandedDiff?.path === filePath && expandedDiff?.staged === isStaged) {
    setExpandedDiff(null);
    return;
  }

  try {
    const diffText = await gitService.diff(workspacePath, filePath, isStaged);
    setExpandedDiff({ path: filePath, diff: diffText, staged: isStaged });
  } catch (err) {
    showToast('Failed to load diff: ' + err.message, 'error');
  }
}, [workspacePath, expandedDiff, showToast]);
```

### Integration Pattern

Each file entry wrapped in `React.Fragment` with conditional `DiffView` below:

```jsx
{staged.map((file, idx) => (
  <React.Fragment key={`staged-${file.path}-${idx}`}>
    <div onClick={() => handleFileClick(file.path, true)}>
      {/* file item UI */}
    </div>
    {expandedDiff?.path === file.path && expandedDiff?.staged === true && (
      <DiffView diffText={expandedDiff.diff} />
    )}
  </React.Fragment>
))}
```

Applied to all three sections: staged (`isStaged=true`), unstaged (`isStaged=false`), untracked (`isStaged=false`).

## Key Implementation Details

| Detail | Description |
|--------|-------------|
| **Staged parameter** | `isStaged` boolean distinguishes staged vs working directory diffs |
| **Toggle behavior** | Clicking same file collapses; clicking different file switches |
| **Single expanded diff** | Only one diff visible at a time (avoids DOM bloat) |
| **React.Fragment** | Allows adjacent file item + DiffView without extra DOM wrapper |
| **No backend changes** | Leverages existing `gitService.diff()` in both runtimes |
| **Removed openFile** | `openFile` no longer destructured from workspace context |

## Best Practices Applied

- **Pure function** for `parseDiff()` — testable, no side effects, deterministic
- **Single expanded state** — memory-efficient for large change sets
- **Existing theme tokens** — `git-added`, `git-deleted` colors for consistency
- **Separate component** for `DiffView` — reusable, encapsulated rendering

## Potential Issues to Watch

1. **Large diffs**: No truncation yet. Files with 5,000+ changed lines will create that many DOM nodes. Future: add `MAX_DIFF_LINES` with "show more" button.
2. **Stale diff state**: Polling refreshes status every 5s but not the expanded diff. If a file changes while its diff is shown, the displayed diff is stale.
3. **`expandedDiff` in useCallback deps**: Including `expandedDiff` in the dependency array causes `handleFileClick` to recreate on every diff toggle. Consider using a ref or functional state updater to avoid stale closures on rapid clicks.
4. **Race conditions**: Rapidly clicking different files could cause out-of-order diff responses. Future: use AbortController to cancel superseded requests.

## Future Improvements

- Truncation with "show more" for large diffs
- Re-fetch diff when status polling detects changes to expanded file
- Word-level diff highlighting within changed lines
- Diff caching to avoid re-fetching on toggle
- Binary file detection with graceful fallback message

## Related Documentation

- **Plan**: `docs/plans/2026-03-01-feat-git-diff-comparison-viewer-plan.md`
- **Parent plan**: `docs/plans/2026-02-28-feat-editor-overhaul-tabs-git-search-plan.md` (Phase 4b)
- **Brainstorm**: `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md` (lines 68-85)
- **Design system tokens**: `docs/plans/2026-02-28-feat-design-system-shadcn-phosphor-plan.md` (git status colors)
- **Panel integration**: `docs/solutions/integration-issues/resizable-panels-library-integration.md`
- **Editor overhaul solution**: `docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md`
