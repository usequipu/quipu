---
title: "React useCallback TDZ: Dependency Array References Const Declared Later"
date: 2026-03-01
category: runtime-errors
severity: high
component: src/context/WorkspaceContext.jsx
tags:
  - temporal-dead-zone
  - react-hooks
  - useCallback
  - dependency-array
  - javascript-scoping
  - const
symptom: "ReferenceError: Cannot access 'extractFrontmatter' before initialization on first component render"
root_cause: "useCallback dependency array is evaluated eagerly at hook call time; referencing a const-declared useCallback that appears later in the same function body triggers TDZ"
---

# React useCallback TDZ: Dependency Array References Const Declared Later

## Symptom

Component crashes on first render with:

```
ReferenceError: Cannot access 'extractFrontmatter' before initialization
```

The error originates from inside `WorkspaceProvider` during the `useCallback` call for `reloadTabFromDisk`, which listed `extractFrontmatter` in its dependency array before `extractFrontmatter` was declared.

## Root Cause

JavaScript `const` declarations are subject to the **Temporal Dead Zone (TDZ)**: the variable is hoisted to the top of its scope but cannot be accessed until the declaration statement executes. Accessing it before that point throws `ReferenceError`.

In a React functional component, hooks execute sequentially, top to bottom. A `useCallback` hook evaluates its **dependency array immediately** when the code line is reached — it is **not** lazily deferred. The callback body itself *is* lazy (it runs when called), but the deps array is an ordinary JS expression evaluated at that instant.

This means if hook A's dependency array references a `const` defined by hook B later in the same component function, hook A's deps evaluation triggers a TDZ error.

```
┌─────────────────────────────────────────────────────┐
│  Component renders (top → bottom)                   │
│                                                     │
│  Line 113: useCallback(fn, [openTabs,               │
│              extractFrontmatter, ← EVALUATED NOW    │
│              showToast])                            │
│              ↑ ReferenceError: TDZ!                 │
│                                                     │
│  Line 226: const extractFrontmatter = useCallback() │
│              ← Only initialized here               │
└─────────────────────────────────────────────────────┘
```

### Callback body vs. dependency array evaluation

| | Evaluated when? | TDZ danger? |
|---|---|---|
| Dependency array | **Eagerly** — at hook call time | **Yes** — references must be initialized |
| Callback body | **Lazily** — when the function is actually called | No — declaration order doesn't matter |

## The Bug

```javascript
// Line ~145 — BROKEN: references extractFrontmatter before it's declared
const reloadTabFromDisk = useCallback(async (tabId) => {
  // ...
  if (isMarkdown) {
    const fm = extractFrontmatter(content); // body is fine (lazy)
    // ...
  }
}, [openTabs, extractFrontmatter, showToast]); // ← CRASH: TDZ here

// ...many lines later...

// Line ~226 — declared too late
const extractFrontmatter = useCallback((rawContent) => {
  // ...
}, [showToast]);
```

## The Fix

Move `extractFrontmatter` **before** `reloadTabFromDisk` so it is initialized before `reloadTabFromDisk`'s dependency array is evaluated:

```javascript
// FIXED: extractFrontmatter declared first
const extractFrontmatter = useCallback((rawContent) => {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatter: null, frontmatterRaw: null, body: rawContent };

  try {
    const parsed = jsYaml.load(match[1]);
    return {
      frontmatter: typeof parsed === 'object' && parsed !== null ? parsed : null,
      frontmatterRaw: match[1],
      body: rawContent.slice(match[0].length),
    };
  } catch {
    showToast('Malformed YAML frontmatter', 'warning');
    return { frontmatter: null, frontmatterRaw: match[1], body: rawContent.slice(match[0].length) };
  }
}, [showToast]);

// FIXED: extractFrontmatter is now fully initialized — safe to reference
const reloadTabFromDisk = useCallback(async (tabId) => {
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab) return;

  try {
    const content = await fs.readFile(tab.path);
    const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');

    let bodyContent = content;
    let frontmatter = tab.frontmatter;
    let frontmatterRaw = tab.frontmatterRaw;

    if (isMarkdown && typeof content === 'string') {
      const fm = extractFrontmatter(content); // safe
      frontmatter = fm.frontmatter;
      frontmatterRaw = fm.frontmatterRaw;
      bodyContent = fm.body;
    }

    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? {
        ...t,
        content: bodyContent,
        tiptapJSON: null,
        isDirty: false,
        frontmatter,
        frontmatterRaw,
      } : t
    ));
  } catch (err) {
    showToast('Failed to reload file: ' + err.message, 'error');
  }
}, [openTabs, extractFrontmatter, showToast]); // all deps initialized
```

## Prevention

### Organize hooks by dependency level

Arrange `useCallback` hooks in **dependency DAG order** — leaf callbacks first, then callbacks that depend on them:

```javascript
function WorkspaceProvider({ children }) {
  // 1. State & external deps
  const { showToast } = useToast();
  const [openTabs, setOpenTabs] = useState([]);

  // 2. Leaf-level callbacks (only depend on external/state)
  const extractFrontmatter = useCallback(..., [showToast]);
  const toggleFolder = useCallback(..., []);

  // 3. Mid-level callbacks (depend on leaf callbacks)
  const reloadTabFromDisk = useCallback(..., [openTabs, extractFrontmatter, showToast]);
  const openFile = useCallback(..., [openTabs, extractFrontmatter, showToast]);

  // 4. High-level callbacks (depend on mid/leaf callbacks)
  const saveFile = useCallback(..., [activeTab, setTabDirty, showToast]);

  // 5. Effects (can reference any level)
  useEffect(() => { ... }, [workspacePath, reloadTabFromDisk]);
}
```

### Code review checklist

- [ ] For each `useCallback`, trace every dependency array item back to its declaration
- [ ] Verify each referenced `const` appears **earlier** in the component function
- [ ] If two callbacks mutually reference each other, extract shared logic into a plain function outside the component

### ESLint limitation

`react-hooks/exhaustive-deps` does **not** catch TDZ ordering violations. It validates that dependencies are listed, not that they're initialized in time. You cannot rely on ESLint to prevent this bug.

### Test that catches this class of bug

The bug manifests on first render, so a basic render test is sufficient:

```javascript
import { renderHook } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';

it('renders without TDZ error', () => {
  expect(() =>
    renderHook(() => useWorkspace(), { wrapper: WorkspaceProvider })
  ).not.toThrow();
});
```

## Context: How This Was Introduced

This bug was introduced while implementing the FRAME terminal enhancements feature (Phase 2). The `reloadTabFromDisk` callback was added to support file watching — when a file changes on disk, `WorkspaceContext` reloads the open tab. The implementation placed `reloadTabFromDisk` immediately after `snapshotTab`, but `extractFrontmatter` (which it depends on to handle markdown frontmatter re-parsing on reload) was left in its original position near the bottom of the component function.

Because the bug only surfaces at render time and not at import/module time, it would not be caught by a linter or type checker — only by running the application or a render test.

## Related

- [useCallback TDZ in useEffect](./usecallback-temporal-dead-zone-in-useeffect.md) — similar TDZ pattern but where `useEffect` references a `useCallback` declared later
- Plan: `docs/plans/2026-03-01-feat-terminal-frame-agent-comment-integration-plan.md` — the feature that introduced the bug
