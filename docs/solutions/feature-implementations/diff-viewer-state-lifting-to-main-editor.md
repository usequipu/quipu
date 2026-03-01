---
title: Move Git Diff Display from Sidebar to Main Editor Area
problem_type: refactor
component: DiffViewer
symptoms:
  - Inline diff viewer in SourceControlPanel was constrained to 300px max-height, forcing awkward scrolling within sidebar
  - Diff display competed with file list in cramped sidebar space
  - Limited horizontal space prevented proper diff line number and content display
  - User experience inconsistent with main editor paradigm—diff content deserves a dedicated full-height viewport
tags:
  - git
  - diff-viewer
  - ui-refactor
  - editor-area
  - state-lifting
  - workspace-layout
date: 2026-03-01
status: solved
---

# Move Git Diff Display from Sidebar to Main Editor Area

## Root Cause

The original inline sidebar approach kept the diff viewer embedded as a collapsible section within `SourceControlPanel`. This created three problems:

1. **Visual conflict** — Diff content competed for vertical space with the git status list and commit UI, forcing a 300px cap and aggressive truncation of long diffs.
2. **State coupling** — `SourceControlPanel` had to manage both its own git status state and diff display state, creating tight coupling.
3. **Poor UX** — The tiny sidebar viewport couldn't show meaningful diffs. Users had to scroll both the sidebar *and* the diff content area simultaneously.

## Solution

Move diff rendering out of the sidebar into the **main editor area** — the same panel where `Editor` renders. The diff viewer is a peer to `Editor`, not a child of `SourceControlPanel`.

### Step-by-Step

1. **Create `DiffViewer.jsx`** — A standalone, pure display component that owns no external state. Takes `filePath`, `diffText`, `isStaged`, and `onClose` as props. Includes a header with filename/staged badge/close button and a full-height scrollable diff body with line numbers.

2. **Add `activeDiff` state to `App.jsx`** — Store `{ filePath, diffText, isStaged } | null`. This is UI chrome state that belongs in `App.jsx`, not in `WorkspaceContext`.

3. **Clear diff on tab switch** — A `useEffect` watching `activeTabId` calls `setActiveDiff(null)`. When the user clicks any tab, the diff closes and the editor appears.

4. **Wire `onOpenDiff` callback to `SourceControlPanel`** — `App.jsx` defines `handleOpenDiff(filePath, diffText, isStaged)` and passes it down as a prop. `SourceControlPanel` calls it after fetching the diff.

5. **Remove inline `DiffView` from `SourceControlPanel`** — Delete `parseDiff`, `DiffView`, `expandedDiff` state, and their JSX. Replace `React.Fragment` wrappers (used for adjacent diff rows) with plain `div` rows. Add `bg-white/[0.08]` highlight to the selected row via `selectedDiff` local state.

6. **Conditional render in `App.jsx` main area**:
   ```jsx
   {activeDiff ? (
     <DiffViewer ... />
   ) : activeFile ? (
     <Editor ... />
   ) : (
     <EmptyState />
   )}
   ```

## Key Code

**`DiffViewer.jsx` — component structure:**
```jsx
const DiffViewer = ({ filePath, diffText, isStaged, onClose }) => {
  const lines = useMemo(() => parseDiff(diffText), [diffText]);
  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface">
      {/* Header: filename, staged badge, close button */}
      <div className="flex items-center gap-2 px-3 h-[35px] border-b border-border shrink-0">
        <GitDiffIcon size={14} className="text-text-tertiary shrink-0" />
        <span className="text-[13px] text-text-primary flex-1 ...">
          {fileName}
          <span className="ml-3 text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-text-secondary">
            {isStaged ? 'staged' : 'working tree'}
          </span>
        </span>
        <button onClick={onClose}><XIcon size={14} /></button>
      </div>
      {/* Diff body: old line#, new line#, +/- prefix, content */}
      <div className="flex-1 overflow-auto font-mono text-[12px] leading-[20px] bg-bg-base">
        {lines.map((line, idx) => (
          <div key={idx} className={cn("flex items-stretch whitespace-pre",
            line.type === 'add' && "bg-git-added/10",
            line.type === 'remove' && "bg-git-deleted/10",
          )}>
            <span className="w-10 text-right pr-3 shrink-0 opacity-40 select-none border-r border-border/40">
              {line.type !== 'add' && line.type !== 'header' ? (line.oldLine || '') : ''}
            </span>
            <span className="w-10 text-right pr-3 shrink-0 opacity-40 select-none border-r border-border/40">
              {line.type !== 'remove' && line.type !== 'header' ? (line.newLine || '') : ''}
            </span>
            <span className="w-5 text-center shrink-0 select-none">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="flex-1 pl-2 pr-4 min-w-0">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

**`App.jsx` — state, callback, auto-clear:**
```js
const [activeDiff, setActiveDiff] = useState(null); // { filePath, diffText, isStaged }

// Clear when user switches tabs
useEffect(() => {
  setActiveDiff(null);
}, [activeTabId]);

const handleOpenDiff = useCallback((filePath, diffText, isStaged) => {
  if (filePath === null) { setActiveDiff(null); return; }
  setActiveDiff({ filePath, diffText, isStaged });
}, []);

// Pass callback to panel
{activePanel === 'git' && <SourceControlPanel onOpenDiff={handleOpenDiff} />}
```

**`SourceControlPanel.jsx` — prop + selected state:**
```js
function SourceControlPanel({ onOpenDiff }) {
  const [selectedDiff, setSelectedDiff] = useState(null); // { path, staged }

  const handleFileClick = useCallback(async (filePath, isStaged = false) => {
    if (selectedDiff?.path === filePath && selectedDiff?.staged === isStaged) {
      setSelectedDiff(null);
      onOpenDiff?.(null);
      return;
    }
    const diffText = await gitService.diff(workspacePath, filePath, isStaged);
    setSelectedDiff({ path: filePath, staged: isStaged });
    onOpenDiff?.(filePath, diffText, isStaged);
  }, [workspacePath, selectedDiff, onOpenDiff, showToast]);
}
```

## Behavior After Fix

- Clicking a changed file in Source Control opens a full-height diff in the main editor area.
- The sidebar shows only git status (staged/unstaged/untracked files), commit form, and push/pull — no embedded diffs.
- The clicked file row is highlighted with a subtle background in the sidebar.
- Clicking the same file again toggles the diff off.
- Clicking any editor tab clears the diff automatically.
- The close `×` button in the DiffViewer header also dismisses it.

## Prevention Strategies

**State cardinality**: Keep `activeDiff` minimal — only `{ filePath, diffText, isStaged }`. View-specific options (e.g., a side-by-side toggle) belong in `DiffViewer`'s own `useState`. Persisted preferences belong in `WorkspaceContext`.

**The context boundary rule**:
- `App.jsx` state → ephemeral UI chrome (active panel, active diff, quick open visibility)
- `WorkspaceContext` state → persistent workspace data (tabs, file tree, workspace path)

**The prop callback convention**: `SourceControlPanel` must never mutate `activeDiff` directly or call context dispatch for diff operations. It only calls the `onOpenDiff` prop. If you later need to pass loading/error state back down, add more props — don't reach for context.

**Auto-clear pattern**: The `useEffect(() => setActiveDiff(null), [activeTabId])` is essential. Any feature that renders a content overlay in the main area should follow the same cleanup pattern to avoid stale data when the user navigates.

**DiffViewer pure display contract**: DiffViewer fetches nothing and mutates nothing. If you add actions inside DiffViewer (e.g., "Open in editor", "Stage hunk"), pass them as prop callbacks from `App.jsx`.

## Future Considerations

- **Side-by-side view**: Add a `viewMode` state inside `DiffViewer`; don't create separate components for each mode.
- **Large diff truncation**: Truncate in the Go server (`/git/diff?maxLines=N`), include `{ isTruncated, truncatedAt }` metadata in the response, and show a warning banner in `DiffViewer`.
- **Syntax highlighting**: Detect language from `filePath` extension in `DiffViewer`, apply `highlight.js` or `prism` to each line — no App.jsx or context changes needed.
- **Open file from diff**: Add an `onOpenFile(filePath, lineNumber)` prop callback to `DiffViewer`. Handle in `App.jsx` by calling `openFile()` from context, then store a pending scroll target for `Editor` to consume.
- **Search within diff**: Add `filterText` state inside `DiffViewer` and memoize `filteredLines`. Fully local — no parent involvement needed.

## Related

- Plan: [`docs/plans/2026-03-01-feat-git-diff-comparison-viewer-plan.md`](../../plans/2026-03-01-feat-git-diff-comparison-viewer-plan.md) — original proposal for the inline sidebar approach
- Prior solution: [`docs/solutions/feature-implementations/inline-git-diff-viewer-source-control.md`](./inline-git-diff-viewer-source-control.md) — the inline sidebar implementation this refactor supersedes
- Brainstorm: [`docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md`](../../brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — original success criterion: "Side-by-side diff accurately shows changes for any modified file"
- Theme tokens: [`docs/plans/2026-02-28-feat-design-system-shadcn-phosphor-plan.md`](../../plans/2026-02-28-feat-design-system-shadcn-phosphor-plan.md) — defines `text-git-added`, `text-git-deleted`, etc.
