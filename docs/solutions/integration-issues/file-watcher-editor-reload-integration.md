---
title: "File watching for external editor changes in TipTap + React"
slug: file-watcher-editor-reload-integration
date: 2026-03-01
problem_type: integration-issue
components:
  - WorkspaceContext
  - Editor
  - fileSystem
symptoms:
  - "Stale file content after external edits"
  - "Editor does not auto-reload on Claude changes"
solution_summary: "Added external file change detection with dual runtime support (Electron fs.watchDirectory + Browser polling) and automatic content reloading via diskContent comparison and reloadKey counter"
tags:
  - file-watching
  - electron
  - react
  - tiptap
  - claude-integration
  - dual-runtime
severity: medium
status: solved
---

# File Watching for External Editor Changes in TipTap + React

## Problem

When a file was open in the TipTap editor and modified externally — by Claude Code, a shell script, or any other process — the editor continued displaying stale content. The user had no indication the file had changed, and the only fix was to close and reopen the tab.

**Symptoms observed:**
- Claude Code edits a file; the editor shows the pre-edit version
- Running a code formatter externally doesn't reflect in the open tab
- The dirty flag isn't triggered, so auto-save doesn't help

## Root Cause

The `openFile()` function read file content once and stored it in the tab's `content` field. The Editor component's `useEffect` only re-ran when `activeFile` or `activeTabId` changed — not when the underlying disk content changed. There was no mechanism to signal the editor that a reload was needed.

Three gaps:
1. No file watcher — nothing monitored disk changes at all
2. No change detection — no way to distinguish "own save" vs "external change"
3. No reload signal — even if content changed in state, the editor didn't know to re-parse

## Solution

### Key Insight

A two-layer architecture solves this cleanly:

1. **Watcher layer** detects disk changes using `diskContent` as a sentinel (the raw file content as read from disk). Comparing `fresh !== tab.diskContent` reliably identifies external changes without false positives from the editor's own saves.
2. **Signal layer** uses a `reloadKey` counter on each tab. Incrementing it forces the Editor's `useEffect` to re-execute, reloading the file content without losing the editor instance.

The compound key `tabKey = "${tabId}:${reloadKey ?? 0}"` in the Editor's load effect means the effect re-runs when either the tab switches *or* the reload counter changes.

### Change 1 — Track disk content per tab (`WorkspaceContext.jsx`)

When opening a file, store the raw disk content for change detection:

```javascript
// src/context/WorkspaceContext.jsx
const newTab = {
  id: crypto.randomUUID(),
  path: filePath,
  name: fileName,
  content: isQuipu && parsedContent ? parsedContent : bodyContent,
  tiptapJSON: null,
  isDirty: false,
  // ...
  diskContent: content, // Raw content as read from disk, for change detection
};
```

When saving, update `diskContent` in the same state batch so the watcher ignores the save:

```javascript
await fs.writeFile(activeTab.path, content);
// Update diskContent so file watcher doesn't trigger on our own save
setOpenTabs(prev => prev.map(t =>
  t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content } : t
));
```

### Change 2 — Helper to apply fresh content (`WorkspaceContext.jsx`)

Centralises the reset logic, re-parses frontmatter for markdown files:

```javascript
const applyFreshContent = useCallback((tab, fresh) => {
  const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');
  let frontmatter = null, frontmatterRaw = null, bodyContent = fresh;
  if (isMarkdown && typeof fresh === 'string') {
    const fm = extractFrontmatter(fresh);
    frontmatter = fm.frontmatter;
    frontmatterRaw = fm.frontmatterRaw;
    bodyContent = fm.body;
  }
  return { content: bodyContent, tiptapJSON: null, isDirty: false, diskContent: fresh, frontmatter, frontmatterRaw };
}, [extractFrontmatter]);
```

Setting `tiptapJSON: null` forces the Editor to re-parse from `content` rather than restoring the snapshot, which would be stale.

### Change 3 — Electron native watcher (`WorkspaceContext.jsx`)

Uses the pre-existing Electron IPC plumbing (`watchDirectory` / `onDirectoryChanged`) which was already wired but unused:

```javascript
useEffect(() => {
  if (!window.electronAPI || !workspacePath) return;

  fs.watchDirectory(workspacePath);

  const cleanup = fs.onDirectoryChanged(async ({ filename }) => {
    if (!filename) return;
    const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');
    const tab = openTabsRef.current.find(t => t.path === fullPath);
    if (!tab || tab.isMedia) return;

    try {
      const fresh = await fs.readFile(fullPath);
      if (fresh === tab.diskContent) return; // No real change

      if (tab.isDirty) {
        // Preserve unsaved work — just warn
        showToast(`"${tab.name}" changed on disk (unsaved changes preserved)`, 'warning');
        setOpenTabs(prev => prev.map(t => t.id === tab.id ? { ...t, diskContent: fresh } : t));
      } else {
        // Auto-reload clean tab
        const updates = applyFreshContent(tab, fresh);
        setOpenTabs(prev => prev.map(t =>
          t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
        ));
      }
    } catch { /* file may be temporarily inaccessible during write */ }
  });

  return cleanup;
}, [workspacePath, showToast, applyFreshContent]);
```

**Critical**: Use `openTabsRef.current` (a `useRef` that shadows state) — not `openTabs` — to avoid stale closures inside the listener callback.

### Change 4 — Browser polling fallback (`WorkspaceContext.jsx`)

For browser/Go-server mode, poll every 5 seconds. Batches all tab reads in one interval tick:

```javascript
useEffect(() => {
  if (window.electronAPI || !workspacePath) return;

  const id = setInterval(async () => {
    const tabs = openTabsRef.current;
    const reloads = [];
    const warnings = [];

    for (const tab of tabs) {
      if (tab.isMedia || !tab.diskContent) continue;
      try {
        const fresh = await fs.readFile(tab.path);
        if (fresh === tab.diskContent) continue;

        if (tab.isDirty) {
          warnings.push({ id: tab.id, name: tab.name, diskContent: fresh });
        } else {
          reloads.push({ tab, fresh });
        }
      } catch { /* ignore transient read errors */ }
    }

    if (reloads.length > 0 || warnings.length > 0) {
      setOpenTabs(prev => prev.map(t => {
        const reload = reloads.find(r => r.tab.id === t.id);
        if (reload) return { ...t, ...applyFreshContent(reload.tab, reload.fresh), reloadKey: (t.reloadKey || 0) + 1 };
        const warn = warnings.find(w => w.id === t.id);
        if (warn) return { ...t, diskContent: warn.diskContent };
        return t;
      }));
      warnings.forEach(w => showToast(`"${w.name}" changed on disk (unsaved changes preserved)`, 'warning'));
    }
  }, 5000);

  return () => clearInterval(id);
}, [workspacePath, showToast, applyFreshContent]);
```

### Change 5 — Editor reload trigger (`Editor.jsx`)

The load effect now uses a compound key that includes `reloadKey`:

```javascript
// Load content when active tab changes or is externally reloaded
useEffect(() => {
  if (!editor) return;
  if (!activeFile || !activeTabId) {
    loadedTabRef.current = null;
    editor.commands.setContent('', { emitUpdate: false });
    return;
  }

  // Compound key: tabId + reloadKey ensures external reloads re-run this effect
  const tabKey = `${activeTabId}:${activeTab?.reloadKey ?? 0}`;
  if (loadedTabRef.current === tabKey) return;

  // Snapshot previous tab before switching (not on reload of same tab)
  const prevTabId = loadedTabRef.current ? loadedTabRef.current.split(':')[0] : null;
  if (prevTabId && prevTabId !== activeTabId && snapshotTab) {
    snapshotTab(prevTabId, editor.getJSON(), 0);
  }

  loadedTabRef.current = tabKey;

  // Skip snapshot on external reload (tiptapJSON is null after applyFreshContent)
  if (activeTab && activeTab.tiptapJSON) {
    editor.commands.setContent(activeTab.tiptapJSON, { emitUpdate: false });
    extractComments(editor);
    return;
  }

  // Load from file content (first open, or after external reload)
  // ...parse and setContent
}, [editor, activeFile, activeTabId, activeTab, snapshotTab]);
```

The snapshot logic correctly distinguishes between a tab *switch* (snapshot the old tab) and a *reload of the same tab* (no snapshot needed) by comparing the tab ID portion of `loadedTabRef.current`.

### Change 6 — fileSystem.js adapter (`fileSystem.js`)

Expose `watchDirectory` in both runtime adapters:

```javascript
// Electron
const electronFS = {
  // ...
  watchDirectory: (dirPath) => window.electronAPI.watchDirectory(dirPath),
  onDirectoryChanged: (callback) => {
    window.electronAPI.onDirectoryChanged(callback);
    return () => window.electronAPI.removeDirectoryListener();
  },
};

// Browser (no-op — uses polling instead)
const browserFS = {
  // ...
  watchDirectory: async () => null,
  onDirectoryChanged: () => () => {},
};
```

## Prevention & Best Practices

### Pitfalls to avoid

**False-positive reload on own save** — Solved by updating `diskContent` synchronously inside the same `setOpenTabs` call as `isDirty: false`. Always do these together.

**Stale closures in watchers** — Never capture `openTabs` directly inside an interval or listener. Use `openTabsRef.current`. The ref is kept fresh via:
```javascript
const openTabsRef = useRef(openTabs);
useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);
```

**Infinite reload loops** — Prevented because `reloadKey` only signals the editor; it doesn't re-trigger the watcher. The watcher checks `fresh === tab.diskContent` and exits immediately if unchanged.

**Dirty tab data loss** — Never auto-reload a dirty tab. Check `tab.isDirty` first. For dirty tabs: update `diskContent` (so future saves don't generate false positives), and show a warning toast.

### Testing checklist

- [ ] Edit externally → editor reloads within 1s (Electron) or ~5s (browser)
- [ ] Save from editor → no reload flash, scroll position unchanged
- [ ] Edit a dirty tab externally → warning toast appears, user content preserved
- [ ] Change a media file externally → no reload attempted (media has `diskContent: null`)
- [ ] Open multiple files, change two externally → only those two reload
- [ ] Switch workspace → watchers stop, re-attach for new path

### Extending for new file types

When adding a new file format:
1. If it's binary/non-text: set `diskContent: null` in `openFile` — the watchers skip null
2. If it's text-based: `diskContent` handling is automatic; add serialization to `saveFile` and parsing to `applyFreshContent` if it has structured metadata (like frontmatter)

### Known limitations

| Limitation | Impact | Acceptable because |
|---|---|---|
| Browser polling has 5s latency | Slow refresh in browser mode | Native Electron watcher is instant; browser is secondary runtime |
| Electron watcher may fire multiple times per write | Extra reads on rapid changes | The `fresh === diskContent` guard makes extra events cheap no-ops |
| No conflict resolution UI for dirty tabs | User must manually reconcile | Warning toast + git diff viewer (existing feature) covers most cases |
| `isClaudeRunning` detection is unreliable | Can't tell if Claude specifically made the edit | Don't need to — reload any clean file regardless of who changed it |
| Scroll position resets on reload | Minor UX friction | Content integrity is higher priority; scroll is secondary |

## Related Documentation

- [`docs/solutions/integration-issues/frame-system-multi-component-sync.md`](frame-system-multi-component-sync.md) — FRAME annotation sync, Claude skills auto-install, useEffect dependency patterns
- [`docs/solutions/integration-issues/claude-terminal-workspace-sync.md`](claude-terminal-workspace-sync.md) — Terminal cwd sync, `isClaudeRunning` lifecycle, dual-runtime parity
- [`docs/solutions/ui-bugs/false-dirty-state-on-file-open.md`](../ui-bugs/false-dirty-state-on-file-open.md) — Why `{ emitUpdate: false }` must be passed to all programmatic `setContent` calls
- [`docs/plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md`](../../plans/2026-03-01-feat-claude-integration-terminal-frame-plan.md) — Original plan covering this feature alongside FRAME envelope and terminal Claude launch
