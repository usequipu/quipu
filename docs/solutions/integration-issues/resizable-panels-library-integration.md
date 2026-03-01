---
title: "Implement VSCode-style resizable panels with react-resizable-panels"
date: "2026-02-28"
module: "Frontend layout and panel management"
problem_type: "UI architecture refactor"
severity: "medium"
tags:
  - react
  - layout
  - resizable-panels
  - electron
  - keyboard-shortcuts
  - collapsible-panels
  - css
related_files:
  - src/App.jsx
  - src/App.css
  - src/components/SearchPanel.jsx
  - package.json
---

# VSCode-Style Resizable Panels with react-resizable-panels

## Problem

All panels had hardcoded CSS dimensions: side panel fixed at 250px, terminal at 300px. No way to resize panels by dragging or hide the terminal. The layout felt rigid compared to VSCode.

## Root Cause

The layout used static CSS values with no resize mechanism. The side panel used conditional rendering (removed from DOM when hidden) which prevented any drag-based resize library from managing it.

## Solution

### 1. Library Choice

Installed `react-resizable-panels` v4.7.0. Provides `Group`, `Panel`, `Separator`, `usePanelRef`. Handles mouse, touch, keyboard resize. ARIA accessible. ~8KB gzipped.

### 2. Layout Restructure (App.jsx)

**Before:**
```
app-container (flex row)
  ActivityBar (48px, fixed)
  side-panel (250px, conditionally rendered)
  main-area (flex: 1)
    editor-pane (flex: 1)
    terminal-pane (300px fixed)
```

**After:**
```
app-container (flex row)
  ActivityBar (48px, OUTSIDE panel groups)
  Group (horizontal)
    Panel (side, collapsible, min 200px, max 400px)
      side-panel content (conditionally rendered)
    Separator (vertical drag handle)
    Panel (main)
      Group (vertical)
        Panel (editor, min 100px)
        Separator (horizontal drag handle)
        Panel (terminal, collapsible, min 100px)
```

**Key insight:** Activity Bar stays OUTSIDE the Group to maintain fixed 48px. The horizontal Group wraps side panel + main area. Inside main, a nested vertical Group handles editor/terminal split.

### 3. State Model

```javascript
const sidePanelRef = usePanelRef();
const terminalPanelRef = usePanelRef();
```

**Three-way Activity Bar toggle:**
```javascript
const handlePanelToggle = useCallback((panelId) => {
  const isCollapsed = sidePanelRef.current?.isCollapsed();
  if (isCollapsed) {
    // Collapsed + icon clicked -> expand with that content
    setActivePanel(panelId);
    sidePanelRef.current?.expand();
  } else if (activePanel === panelId) {
    // Open + same icon -> collapse
    setActivePanel(null);
    sidePanelRef.current?.collapse();
  } else {
    // Open + different icon -> just switch content
    setActivePanel(panelId);
  }
}, [activePanel, sidePanelRef]);
```

**Keyboard shortcuts:**
- `Ctrl+B` -> `handleToggleSidebar()` (collapse/expand, defaults to 'explorer')
- `` Ctrl+` `` -> `handleToggleTerminal()` (collapse/expand terminal)
- `Ctrl+Shift+F` -> expand sidebar if collapsed + set activePanel to 'search'

### 4. CSS Changes (App.css)

**Removed:** Fixed width/height from `.side-panel` and `.terminal-pane`. Both now use `height: 100%` to fill their Panel containers.

**Added separator styles:**
```css
.resize-handle-horizontal,
.resize-handle-vertical {
  -webkit-app-region: no-drag;  /* Electron: allow drag interaction */
  background: transparent;
  transition: background-color 0.15s ease;
}

.resize-handle-horizontal { width: 4px; cursor: col-resize; }
.resize-handle-vertical { height: 4px; cursor: row-resize; }

.resize-handle-horizontal:hover,
.resize-handle-vertical:hover {
  background-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
}

.resize-handle-horizontal:active,
.resize-handle-vertical:active {
  background-color: var(--accent-color);
}
```

### 5. SearchPanel Focus Fix

Changed from mount-time focus to `activePanel`-driven focus:
```javascript
useEffect(() => {
  if (activePanel === 'search' && inputRef.current) {
    inputRef.current.focus();
  }
}, [activePanel]);
```

## Key Architectural Insight

The library uses a **collapse model** (panel always in DOM, size 0 when collapsed). However, panel **contents** (Explorer/Search/Git) are still conditionally rendered inside the always-mounted container. This preserves component lifecycle cleanup (polling timers, event listeners) while satisfying the library's requirement for stable DOM structure.

## Prevention & Gotchas

### Electron Drag Regions
All `<Separator>` elements MUST have `-webkit-app-region: no-drag`. Otherwise Electron intercepts drag events for window movement instead of panel resizing.

### Comments Track Positioning
The `.comments-track` uses `left: calc(50% + 408px + 1rem)` which assumes a certain editor width. When the side panel is widened, the comments track may overflow. Media queries only respond to viewport resize, not panel resize. **Follow-up needed:** use container queries or `usePanelRef().getSize()` to adapt.

### Sizing Units
The library accepts pixels (numbers), percentages (strings like `"25%"`), and CSS units (strings like `"1rem"`). Numeric values are assumed to be pixels. Use pixels for min/max constraints to avoid circular dependencies when parent panels are themselves resizing.

### Separator Styling
The library renders separators as plain divs. Style with CSS `:hover` and `:active` pseudo-classes. The library manages its own cursor styles during drag.

### Panel Content Mount/Unmount
Since panel contents are still conditionally rendered, switching between Explorer/Search/Git still causes mount/unmount. SourceControlPanel polling stops automatically via cleanup. SearchPanel needs explicit focus management via the `activePanel` prop.

## Related Documentation

- [Editor page background height fix](../ui-bugs/editor-page-background-height.md) — flexbox `align-items: flex-start` pattern for scrollable containers
- [File explorer & editor integration](../integration-issues/file-explorer-editor-integration-fixes.md) — terminal ResizeObserver patterns, Electron compatibility
- [Editor overhaul brainstorm](../../brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — Activity Bar layout structure, panel system design
- [Resizable panels plan](../../plans/2026-02-28-refactor-resizable-panels-plan.md) — full plan with acceptance criteria
