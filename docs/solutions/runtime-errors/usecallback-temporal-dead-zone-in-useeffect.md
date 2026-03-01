---
title: "useCallback temporal dead zone in useEffect dependency"
date: 2026-03-01
category: runtime-errors
tags:
  - react
  - hooks
  - useCallback
  - useEffect
  - temporal-dead-zone
  - keyboard-shortcuts
severity: high
component: src/App.jsx
status: resolved
---

# useCallback Temporal Dead Zone in useEffect Dependency

## Symptom

```
App.jsx:145 Uncaught ReferenceError: Cannot access 'handleSendToClaude' before initialization
    at AppContent (App.jsx:145:132)
```

The app crashes immediately on mount. The error points to the `useEffect` dependency array referencing a `useCallback` that hasn't been initialized yet.

## Root Cause

JavaScript's **temporal dead zone (TDZ)** applies to `const` declarations. Unlike `var` or function declarations, `const` variables cannot be accessed before their initialization line — doing so throws a `ReferenceError`.

In this case, a `useEffect` was declared **above** the `useCallback` it depended on:

```jsx
// useEffect references handleSendToClaude BEFORE it's defined
useEffect(() => {
  const handler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
      handleSendToClaude(); // TDZ error at runtime
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [handleSendToClaude]); // <-- dependency listed but not yet initialized

// Defined AFTER the useEffect
const handleSendToClaude = useCallback(async () => { /* ... */ }, [deps]);
```

React evaluates hook calls top-to-bottom during render. When the `useEffect` is registered, it captures the dependency array values. Since `handleSendToClaude` is a `const` declared below, it's in the TDZ and throws.

## Working Solution

Move all `useCallback` definitions **above** the `useEffect` that references them:

```jsx
// Callbacks defined FIRST
const handleSendToTerminal = useCallback(() => { /* ... */ }, [editorInstance]);
const handleSendToClaude = useCallback(async () => { /* ... */ }, [deps]);

// useEffect comes AFTER — all references are initialized
useEffect(() => {
  const handler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      handleSendToTerminal(); // OK
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
      handleSendToClaude(); // OK
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [handleSendToTerminal, handleSendToClaude]);
```

Also converted `handleSendToTerminal` from a plain function to `useCallback` for consistency and added it to the dependency array.

## Prevention

### Hook Ordering Convention

All React components in this project must follow this order:

1. `useState` declarations
2. `useRef` declarations
3. `useCallback` / `useMemo` definitions
4. `useEffect` hooks (after all callbacks they depend on)
5. Helper functions and derived values
6. JSX return

### Code Review Checklist

When reviewing React components with keyboard shortcuts or event listeners:

- [ ] Every `useCallback` in a `useEffect` dependency array is defined **above** that effect
- [ ] No `useEffect` appears above the `useCallback` it depends on
- [ ] All handler functions used in effects are wrapped in `useCallback` (not plain functions)

### Why ESLint Doesn't Catch This

`eslint-plugin-react-hooks` with `exhaustive-deps` validates that dependencies are *listed* but does not check **declaration order**. The `no-use-before-define` rule can help for variables but doesn't specifically target hook ordering.

## Key Insight

Declaration order matters in React components. The TDZ is a JavaScript language feature, not a React bug. The safe pattern is: **state hooks -> callback hooks -> effect hooks**. This ensures all mutable values exist before any side effects reference them.

## Related

- File: [src/App.jsx](../../src/App.jsx) — keyboard shortcuts `useEffect` (line ~168)
- Skill: [.claude/skills/keyboard-shortcuts.md](../../.claude/skills/keyboard-shortcuts.md)
