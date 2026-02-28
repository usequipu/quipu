---
name: quipu-component
description: Pattern for creating new React components in Quipu following project conventions
triggers:
  - creating new component
  - adding UI panel or view
  - building new React component
---

# Quipu Component Pattern

Use this skill when creating new React components for Quipu.

## File Structure

Every component gets two co-located files:

```
src/components/
  ComponentName.jsx
  ComponentName.css
```

## Component Template

```jsx
// src/components/ComponentName.jsx
import React, { useState, useCallback } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import './ComponentName.css';

export default function ComponentName() {
    const { /* destructure only what you need */ } = useWorkspace();

    const handleAction = useCallback(() => {
        // handler logic
    }, [/* deps */]);

    return (
        <div className="component-name">
            {/* content */}
        </div>
    );
}
```

## Rules

### JavaScript
- **Functional components only** - no class components
- **useCallback** for all event handlers
- **useRef** for DOM references and mutable values
- **useEffect** with explicit dependency arrays
- Named function declaration for exports: `export default function ComponentName()`
- Handler naming: `handleClick`, `handleSubmit`, `handleContextMenu`
- Boolean state naming: `isExpanded`, `isDirty`, `isLoading`

### CSS
- **Plain CSS** - no CSS modules, no CSS-in-JS, no Tailwind
- **kebab-case** class names: `component-name`, `component-name-header`
- **CSS variables** for colors (from `src/index.css`):
  - Warm theme panels: `var(--bg-color)`, `var(--text-color)`, `var(--border-color)`, `var(--accent-color)`
  - Dark elements (Activity Bar): `#252526`, `#1e1e1e`
  - Terminal: `var(--terminal-bg)`
- **No hardcoded hex** for warm-themed areas - always use variables

### Theme Zones

| Zone | Background | Text | Use for |
|---|---|---|---|
| Editor area | `#ffffff` (page) on `var(--bg-color)` | `var(--text-color)` | Editor, tab bar |
| Side panels | `var(--bg-color)` | `var(--text-color)` | Explorer, Search, Source Control |
| Activity Bar | `#252526` | `#cccccc` | Icon rail |
| Terminal | `var(--terminal-bg)` | `#cccccc` | Terminal pane |

### Accessibility
- Add `role` attributes for interactive containers (`tablist`, `toolbar`, `tree`, `menu`)
- Add `aria-label` on icon-only buttons
- Add `aria-selected` on selectable items (tabs, tree items)
- Support keyboard navigation where applicable (arrow keys, Enter, Escape)

### Electron Compatibility
- For draggable title bar areas: `-webkit-app-region: drag`
- For interactive elements in drag regions: `-webkit-app-region: no-drag`

## Error Handling

```jsx
try {
    await someOperation();
    showToast('Operation succeeded', 'success');
} catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
}
```

Never use `console.error` for user-facing failures. Always surface errors via `showToast()`.
