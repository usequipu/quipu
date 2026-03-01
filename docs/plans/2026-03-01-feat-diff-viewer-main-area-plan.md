# Plan: Diff Viewer in Main Editor Area

## Context
Clicking a changed file in the Source Control panel currently shows an inline diff within the sidebar. It should instead open a diff view in the main editor area (like VSCode), with red/green colored lines showing additions and deletions.

## Files to Create
- `src/components/DiffViewer.jsx`

## Files to Modify
- `src/context/WorkspaceContext.jsx` - Add `openDiffTab` function, extend tab model
- `src/components/SourceControlPanel.jsx` - Remove inline diff, call openDiffTab
- `src/App.jsx` - Conditional rendering for diff tabs

## Implementation

### src/context/WorkspaceContext.jsx - Add openDiffTab

Add new function:
```javascript
const openDiffTab = useCallback((filePath, fileName, diffText, isStaged) => {
  // Check if diff tab already open for this path
  const existing = openTabs.find(t => t.isDiff && t.path === filePath && t.isDiffStaged === isStaged);
  if (existing) {
    setActiveTabId(existing.id);
    return;
  }

  const newTab = {
    id: crypto.randomUUID(),
    path: filePath,
    name: `${fileName} (${isStaged ? 'staged' : 'changes'})`,
    content: diffText,
    tiptapJSON: null,
    isDirty: false,
    isQuipu: false,
    isMarkdown: false,
    isDiff: true,
    isDiffStaged: isStaged,
    scrollPosition: 0,
    frontmatter: null,
    frontmatterRaw: null,
    frontmatterCollapsed: false,
  };

  setOpenTabs(prev => [...prev, newTab]);
  setActiveTabId(newTab.id);
}, [openTabs]);
```

Export `openDiffTab` in context value.

### src/components/DiffViewer.jsx

```jsx
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

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
    } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
      oldLine++;
      newLine++;
      result.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldLine, newLine });
    }
  }
  return result;
}

const DiffViewer = ({ content, fileName }) => {
  const lines = useMemo(() => parseDiff(content), [content]);

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-surface">
        <div className="text-text-secondary text-sm italic">No diff available</div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex-1 flex justify-center items-start overflow-y-auto relative",
      "py-8 px-16",
      "max-[1400px]:justify-start max-[1400px]:pl-12",
      "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
      "max-[1150px]:py-6 max-[1150px]:px-4",
    )}>
      <div className={cn(
        "w-[816px] min-h-[400px] bg-page-bg rounded border border-page-border",
        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]",
        "relative shrink-0 overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
      )}>
        <div className="font-mono text-sm leading-6">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex px-4",
                line.type === 'add' && "bg-git-added/10 text-git-added",
                line.type === 'remove' && "bg-git-deleted/10 text-git-deleted",
                line.type === 'header' && "bg-white/[0.03] text-accent font-semibold py-1",
                line.type === 'context' && "text-text-secondary",
              )}
            >
              <span className="w-12 text-right pr-3 shrink-0 text-text-tertiary opacity-50 select-none">
                {line.oldLine || ''}
              </span>
              <span className="w-12 text-right pr-3 shrink-0 text-text-tertiary opacity-50 select-none">
                {line.newLine || ''}
              </span>
              <span className="flex-1 min-w-0 whitespace-pre">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
```

### src/components/SourceControlPanel.jsx

1. Import `useWorkspace` for `openDiffTab`:
   ```javascript
   const { workspacePath, openDiffTab } = useWorkspace();
   ```

2. Remove `expandedDiff` state and all inline `<DiffView>` renders.

3. Modify `handleFileClick` to open diff in main area:
   ```javascript
   const handleFileClick = useCallback(async (filePath, isStaged = false) => {
     if (!workspacePath) return;
     try {
       const diffText = await gitService.diff(workspacePath, filePath, isStaged);
       const fileName = filePath.split('/').pop();
       openDiffTab(filePath, fileName, diffText, isStaged);
     } catch (err) {
       showToast('Failed to load diff: ' + err.message, 'error');
     }
   }, [workspacePath, openDiffTab, showToast]);
   ```

4. Remove the `DiffView` component and `parseDiff` function from this file.

### src/App.jsx - Conditional Rendering

```jsx
import DiffViewer from './components/DiffViewer';

// In render:
{activeFile ? (
  activeTab?.isDiff ? (
    <DiffViewer content={activeTab.content} fileName={activeFile.name} />
  ) : activeTab?.isMedia ? (
    <MediaViewer ... />
  ) : isCodeFile(...) ? (
    <CodeViewer ... />
  ) : (
    <Editor ... />
  )
) : (...)}
```

## Verification
- Open Source Control panel, click a modified file
- Diff should open in the main editor area as a new tab
- Tab name should show "filename.ext (changes)" or "filename.ext (staged)"
- Red lines for deletions, green lines for additions
- Line numbers shown in gutter
- Closing the diff tab works normally
