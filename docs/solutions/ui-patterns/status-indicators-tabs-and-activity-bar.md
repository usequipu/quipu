---
title: "Visual Status Indicators for Dirty Files and VCS Changes"
date: 2026-03-01
type: feat
status: solved
symptom: "Users had no visual feedback for unsaved file changes (dirty state) or the number of VCS-tracked modifications. The editor lacked standard IDE indicators: a dirty dot on modified tabs, and a badge on the Source Control Activity Bar icon."
root_cause: "TabBar showed both the dirty dot and X close button simultaneously instead of toggling between them (VS Code convention). ActivityBar had no access to git change counts because SourceControlPanel kept them local — gitChangeCount was not lifted to WorkspaceContext."
components:
  - TabBar
  - ActivityBar
  - SourceControlPanel
  - WorkspaceContext
tags:
  - status-indicators
  - dirty-state
  - vcs-badge
  - tailwind-group-hover
  - state-lifting
  - activity-bar
related_files:
  - src/components/TabBar.jsx
  - src/components/ActivityBar.jsx
  - src/components/SourceControlPanel.jsx
  - src/context/WorkspaceContext.jsx
---

# Visual Status Indicators: Dirty-File Dot on Tabs + VCS Badge on Activity Bar

## Problem

Two visual indicators were missing from the editor UI:

1. **Tabs**: The `isDirty` state existed per tab but showed a dot AND an X button simultaneously. The VS Code convention is: dot when dirty (not hovering), X button on hover.
2. **Activity Bar**: The Source Control icon showed no badge. Users had to open the panel to see if pending changes existed.

## Root Cause

**TabBar**: Used a plain `group` hover scope and rendered the `CircleIcon` dot and the `<button>` close element as siblings — both always visible when dirty. No mechanism toggled between them.

**ActivityBar + SourceControlPanel**: `staged`, `unstaged`, and `untracked` arrays lived only inside `SourceControlPanel` local state. `ActivityBar` never had access to this data. The fix required lifting a `gitChangeCount` value up to `WorkspaceContext` so any component could read it.

## Solution

### Step 1: Lift `gitChangeCount` into WorkspaceContext

```javascript
// src/context/WorkspaceContext.jsx
const [gitChangeCount, setGitChangeCount] = useState(0);

const updateGitChangeCount = useCallback((count) => {
  setGitChangeCount(count);
}, []);

// In context value object:
const value = {
  // ...
  gitChangeCount,
  updateGitChangeCount,
};
```

### Step 2: Propagate count from SourceControlPanel

After every `fetchStatus` call, compute the total and push it to context:

```javascript
// src/components/SourceControlPanel.jsx
const { workspacePath, updateGitChangeCount } = useWorkspace();

const fetchStatus = useCallback(async () => {
  if (!workspacePath) return;
  try {
    const status = await gitService.status(workspacePath);
    const newStaged = status.staged || [];
    const newUnstaged = status.unstaged || [];
    const newUntracked = status.untracked || [];
    setStaged(newStaged);
    setUnstaged(newUnstaged);
    setUntracked(newUntracked);
    setIsGitRepo(true);
    updateGitChangeCount(newStaged.length + newUnstaged.length + newUntracked.length);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('not a git repository')) {
      setIsGitRepo(false);
      setStaged([]);
      setUnstaged([]);
      setUntracked([]);
      updateGitChangeCount(0);
    }
  }
}, [workspacePath, updateGitChangeCount]);
```

### Step 3: VS Code-style dirty dot on TabBar

Switch from `group` to the scoped `group/tab` named group, then toggle between dot and X using `group-hover/tab:`:

```jsx
// src/components/TabBar.jsx — tab container
<div className={cn("group/tab flex items-center gap-1.5 px-3", ...)}>
  <span className="overflow-hidden text-ellipsis max-w-[150px] font-sans">
    {tab.name}
  </span>

  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
    {tab.isDirty ? (
      <>
        {/* Dot: visible when not hovering; hidden on hover */}
        <CircleIcon
          weight="fill"
          size={8}
          className="text-accent group-hover/tab:hidden"
          aria-label="unsaved changes"
        />
        {/* X: hidden by default; appears on hover */}
        <button
          className={cn(
            "hidden group-hover/tab:flex items-center justify-center",
            "bg-transparent border-none text-text-primary",
            "cursor-pointer px-0.5 rounded-sm leading-none",
            "opacity-60 hover:!opacity-100 hover:bg-white/10",
          )}
          onClick={(e) => handleClose(e, tab.id)}
          aria-label={`Close ${tab.name}`}
        >
          <XIcon size={14} />
        </button>
      </>
    ) : (
      // Clean file: X hidden until hover
      <button
        className={cn(
          "bg-transparent border-none text-text-primary",
          "cursor-pointer px-0.5 rounded-sm leading-none",
          "opacity-0 group-hover/tab:opacity-60",
          "hover:!opacity-100 hover:bg-white/10",
          "transition-opacity",
          isActive && "opacity-60",
        )}
        onClick={(e) => handleClose(e, tab.id)}
        aria-label={`Close ${tab.name}`}
      >
        <XIcon size={14} />
      </button>
    )}
  </div>
</div>
```

### Step 4: Badge on the git icon in ActivityBar

`ActivityBar` reads `gitChangeCount` directly from `useWorkspace()`:

```jsx
// src/components/ActivityBar.jsx
import { useWorkspace } from '../context/WorkspaceContext';

export default function ActivityBar({ activePanel, onPanelToggle }) {
  const { gitChangeCount } = useWorkspace();

  return (
    // ...
    <div className="relative">
      <panel.Icon weight={isActive ? 'regular' : 'light'} size={24} />
      {panel.id === 'git' && gitChangeCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent text-white text-[10px] font-medium flex items-center justify-center px-1">
          {gitChangeCount > 99 ? '99+' : gitChangeCount}
        </span>
      )}
    </div>
  );
}
```

## Key Patterns

### Named Tailwind groups for scoped hover

Plain `group` is global to all ancestors. When a tab itself needs scoped hover state, use a named group:

```jsx
// Parent
<div className="group/tab ...">
  // Children use the /tab suffix to scope to this exact parent
  <span className="group-hover/tab:hidden" />
  <button className="hidden group-hover/tab:flex" />
</div>
```

Both the group declaration and the `group-hover/` modifier **must** share the same suffix (here: `tab`).

### Absolute-positioned badge

To avoid layout shift on the parent icon button:

```jsx
<div className="relative">
  <Icon />
  {count > 0 && (
    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full ...">
      {count > 99 ? '99+' : count}
    </span>
  )}
</div>
```

`min-w-[16px]` keeps the badge circular for single digits; `px-1` provides breathing room for multi-digit counts.

### Visual behavior reference

| State | Tab indicator |
|---|---|
| Dirty, not hovering | Filled accent dot (8px) |
| Dirty, hovering | X close button (60% opacity) |
| Clean, not active | X hidden (`opacity-0`) |
| Clean, active | X at 60% opacity |
| Any + hovering directly on X | X at 100% opacity |

| Git change count | Badge |
|---|---|
| 0 or no workspace | Hidden |
| 1–99 | Shows count |
| 100+ | Shows "99+" |

## Known Limitation: Badge Only Updates When Panel Is Open

`SourceControlPanel` owns the polling interval. If the panel is closed, `fetchStatus` never runs and `gitChangeCount` freezes at its last value. To fully fix this, move the polling interval into `WorkspaceContext` so it runs independently of panel visibility.

## Prevention / Testing Checklist

- [ ] Open file, edit → filled dot appears, X hidden
- [ ] Hover dirty tab → dot hides, X appears at 60% opacity
- [ ] Ctrl+S to save → dot disappears
- [ ] Multiple dirty tabs → only modified tabs show dots
- [ ] Stage file → badge shows count within 5s (panel must be open)
- [ ] Commit all → badge disappears
- [ ] 100+ changes → badge shows "99+"
- [ ] Non-git folder → badge stays hidden, no errors
- [ ] Cycle themes (light → tinted → dark) → badge and dot styled correctly via `bg-accent`

## Related Documentation

- [`docs/solutions/ui-bugs/false-dirty-state-on-file-open.md`](../ui-bugs/false-dirty-state-on-file-open.md) — TipTap `setContent` emitting spurious dirty events; fix with `{ emitUpdate: false }`
- [`docs/solutions/feature-implementations/diff-viewer-state-lifting-to-main-editor.md`](../feature-implementations/diff-viewer-state-lifting-to-main-editor.md) — State lifting pattern, context boundary rule (`App.jsx` ephemeral vs `WorkspaceContext` persistent)
- [`docs/solutions/ui-bugs/editor-overhaul-tabs-search-git.md`](../ui-bugs/editor-overhaul-tabs-search-git.md) — Multi-tab system, Activity Bar panel pattern, single WorkspaceContext design
