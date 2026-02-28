---
name: tab-system
description: Pattern for working with the multi-tab file system including opening, closing, switching, and dirty state management
triggers:
  - tab management
  - open file in tab
  - close tab
  - switch tab
  - dirty state
  - tab snapshot
  - multi-tab
  - openTabs
  - activeTabId
---

# Tab System Pattern

Use this skill when working with the multi-tab file system in Quipu. All tab state lives in `WorkspaceContext`.

## Tab State Shape

```javascript
{
    id: crypto.randomUUID(),        // Unique tab identifier
    path: '/path/to/file.md',       // Absolute file path
    name: 'file.md',                // Display name
    content: '...',                 // Original disk content
    tiptapJSON: { ... },            // Editor state snapshot (null until first switch-away)
    isDirty: false,                 // Unsaved changes flag
    isQuipu: false,                 // .quipu format flag
    isMarkdown: true,               // .md/.markdown format flag
    scrollPosition: 0,              // Scroll restoration
}
```

## Context API

All tab operations are in `WorkspaceContext`:

| Function | Signature | Purpose |
|---|---|---|
| `openFile` | `(filePath, fileName) => void` | Open file in new tab or switch to existing |
| `closeTab` | `(tabId) => void` | Close tab (prompts if dirty) |
| `switchTab` | `(tabId) => void` | Switch to tab by ID |
| `closeOtherTabs` | `(tabId) => void` | Close all tabs except specified |
| `snapshotTab` | `(tabId, tiptapJSON, scrollPos) => void` | Save editor state before switching |
| `setTabDirty` | `(tabId, dirty) => void` | Mark tab dirty/clean |
| `setIsDirty` | `(dirty) => void` | Mark active tab dirty/clean |

## Derived Values (Backward Compat)

```javascript
const activeTab = openTabs.find(t => t.id === activeTabId) || null;
const activeFile = activeTab ? { path, name, content, isQuipu } : null;
const isDirty = activeTab?.isDirty ?? false;
```

Components using `activeFile` and `isDirty` work unchanged.

## Tab Switching with Snapshots

The Editor component MUST snapshot the current tab's TipTap JSON before switching:

```jsx
useEffect(() => {
    // Snapshot previous tab before switching
    if (loadedTabRef.current && loadedTabRef.current !== activeTabId && snapshotTab) {
        snapshotTab(loadedTabRef.current, editor.getJSON(), 0);
    }
    loadedTabRef.current = activeTabId;

    // Restore from snapshot or load fresh
    if (activeTab?.tiptapJSON) {
        editor.commands.setContent(activeTab.tiptapJSON);
    } else if (activeFile) {
        // First time loading - see tiptap-file-handling skill
    }
}, [activeTabId, activeTab]);
```

## Opening a File

```javascript
const { openFile } = useWorkspace();
openFile(filePath, fileName);
```

Behavior:
- Already open: switches to existing tab
- Tab cap (12) reached: shows toast warning, refuses to open
- Otherwise: reads file, creates new tab, sets as active

## Closing a Tab

```javascript
const { closeTab, activeTabId } = useWorkspace();
closeTab(activeTabId);
```

Behavior:
- Dirty tab: shows `window.confirm()` dialog
- Active tab closed: switches to adjacent (right first, then left)
- Last tab closed: `activeTabId` becomes `null`, editor shows empty state

## Keyboard Shortcuts (App.jsx)

| Shortcut | Action |
|---|---|
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Next tab (positional) |
| `Ctrl+Shift+Tab` | Previous tab (positional) |

## Constraints

- **MAX_TABS = 12**: Enforced in `openFile`
- **Single TipTap instance**: Undo/redo history resets on tab switch (known limitation)
- **Immutable updates**: Always use `.map()` to update tab arrays, never mutate directly
- **Tab IDs are UUIDs**: Never use file paths as tab identifiers (a file could theoretically be opened with different names)
