---
title: "feat: File & VCS Status Indicators"
type: feat
status: active
date: 2026-03-01
---

# File & VCS Status Indicators

## Overview

Two visual indicators are missing from the UI: a dirty-file dot on tabs (like VS Code shows a filled circle when a file has unsaved changes) and a modification count badge on the Source Control icon in the Activity Bar.

## Problem Statement

- **Tabs**: The `isDirty` state exists per tab but there is no visual dot indicator. Users cannot quickly scan which tabs have unsaved changes.
- **Activity Bar**: The Source Control icon in `ActivityBar.jsx` shows no count of changed files. Users must click into the Source Control panel to see if there are pending changes.

## Proposed Solution

### 1. Dirty File Dot on Tabs

Add a small filled circle indicator on tabs that have `isDirty: true`, positioned after the filename (before the close button), matching VS Code's convention.

### TabBar.jsx (dirty indicator)

```jsx
{/* Inside each tab */}
<span className="flex items-center gap-1.5">
  <span className="truncate">{tab.name}</span>
  {tab.isDirty && (
    <span className="w-2 h-2 rounded-full bg-text-secondary flex-shrink-0" />
  )}
</span>
```

When the tab is dirty, the close X icon could be replaced by the dot (VS Code behavior): hover reveals the X, non-hover shows the dot. This uses the existing `group-hover` pattern from the codebase.

```jsx
{/* Close button area — dot when dirty + not hovering, X when hovering */}
<div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
  {tab.isDirty ? (
    <>
      <span className="w-2 h-2 rounded-full bg-text-secondary group-hover/tab:hidden" />
      <button className="hidden group-hover/tab:flex" onClick={onClose}>
        <XIcon size={14} />
      </button>
    </>
  ) : (
    <button className="opacity-0 group-hover/tab:opacity-100" onClick={onClose}>
      <XIcon size={14} />
    </button>
  )}
</div>
```

### 2. VCS Modification Count Badge

Show the total number of changed files (staged + unstaged + untracked) as a small badge on the Source Control icon in the Activity Bar.

**Data source:** `SourceControlPanel.jsx` already polls `gitService.status()` every 5 seconds and has `staged`, `unstaged`, and `untracked` arrays. This data needs to be lifted to a shared location (WorkspaceContext or a new state) so ActivityBar can access it.

### WorkspaceContext.jsx (git status count)

```javascript
const [gitChangeCount, setGitChangeCount] = useState(0);

// Called by SourceControlPanel when it fetches git status
const updateGitChangeCount = useCallback((count) => {
  setGitChangeCount(count);
}, []);
```

### ActivityBar.jsx (badge)

```jsx
{/* Source Control icon with badge */}
<div className="relative">
  <GitBranchIcon size={20} />
  {gitChangeCount > 0 && (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent text-white text-[10px] font-medium flex items-center justify-center px-1">
      {gitChangeCount > 99 ? '99+' : gitChangeCount}
    </span>
  )}
</div>
```

## Technical Considerations

- **Git status polling**: Already happens in SourceControlPanel every 5s. Just need to propagate the count up to WorkspaceContext via a callback prop or by moving the poll to the context.
- **Badge overflow**: Cap display at "99+" for repos with many changes.
- **No workspace**: When no workspace is open, badge is hidden (gitChangeCount stays 0).
- **Theme support**: Badge uses `bg-accent` which works across light/dark/tinted themes.

## Acceptance Criteria

- [ ] Dirty tabs show a filled dot indicator
- [ ] Dot replaces X button when not hovering; X appears on hover
- [ ] Saving a file removes the dot
- [ ] Source Control icon shows badge with total changed file count
- [ ] Badge updates automatically as files change (every 5s poll)
- [ ] Badge shows "99+" for large counts
- [ ] Badge hidden when count is 0 or no workspace open
- [ ] Works across all three themes (light, dark, tinted)

## Sources

- [src/components/TabBar.jsx](src/components/TabBar.jsx) — tab rendering
- [src/components/ActivityBar.jsx](src/components/ActivityBar.jsx) — activity bar icons
- [src/components/SourceControlPanel.jsx](src/components/SourceControlPanel.jsx) — git status polling
- [src/context/WorkspaceContext.jsx](src/context/WorkspaceContext.jsx) — state management
- Git status theme tokens: [src/styles/theme.css](src/styles/theme.css) — `git-modified`, `git-added`, etc.
