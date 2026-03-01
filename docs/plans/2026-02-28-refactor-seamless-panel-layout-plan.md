---
title: "Seamless Panel Layout: Remove Spacing and Title Bar"
type: refactor
status: active
date: 2026-02-28
---

# Seamless Panel Layout: Remove Spacing and Title Bar

## Overview

Remove all visual gaps and spacing between UI panels (Activity Bar, side panels, editor, terminal) so they flow as one continuous surface. Remove the 40px `editor-header` title bar entirely, relocating its functionality to keyboard shortcuts and the existing TabBar. Slim resize handles from 4px to a 1px visible line with an 8px invisible hit target.

## Problem Statement / Motivation

The current layout has visual separation between every panel — borders on both sides of resize handles, a 4px-wide handle, and a 40px title bar that duplicates information already shown in the TabBar. This creates unnecessary visual noise and wastes vertical space. The editor should feel like a single cohesive surface where content areas flow directly into each other, separated only by minimal 1px resize dividers.

## Proposed Solution

Three coordinated changes:

### 1. Remove the `editor-header` title bar

Delete the `.editor-header` div from `src/App.jsx` (lines 195-216) and its CSS from `src/App.css` (lines 45-120). This removes:

| Function | Current Location | Replacement |
|---|---|---|
| Sidebar toggle | Button in header | `Ctrl+B` (already exists) |
| Window title + dirty indicator | Header `<span>` | TabBar already shows filename + dirty dot |
| Save button | Button in header | `Ctrl+S` (already exists) |
| Send to Terminal | Button in header | New shortcut: `Ctrl+Shift+Enter` |
| Electron drag region | `-webkit-app-region: drag` on header | Move to TabBar container |

**Files changed:**
- `src/App.jsx` — remove `.editor-header` JSX block (lines 195-216), remove `title` variable (lines 162-166), add `Ctrl+Shift+Enter` to keyboard handler (around line 107)
- `src/App.css` — remove `.editor-header`, `.header-left`, `.header-right`, `.window-title`, `.save-btn`, `.send-btn` rules (lines 45-120)

### 2. Remove all inter-panel borders (resize handles become sole separators)

Remove component-level borders that create double-separation alongside resize handles:

| Border to Remove | File | Line |
|---|---|---|
| `.side-panel { border-right }` | `src/App.css` | 134 |
| `.terminal-pane { border-top }` | `src/App.css` | 124 |
| ActivityBar `border-r border-border` | `src/components/ActivityBar.jsx` | 14 |

### 3. Slim resize handles: 1px visible line, 8px hit target

Change `<Separator>` styling from a 4px solid element to an 8px transparent element with a centered 1px line via `::after` pseudo-element:

```css
/* src/App.css */

.resize-handle-horizontal {
  width: 8px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.resize-handle-horizontal::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background-color: var(--border-color);
  transition: background-color 0.15s ease;
}

.resize-handle-horizontal:hover::after {
  background-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
}

.resize-handle-horizontal:active::after {
  background-color: var(--accent-color);
}

.resize-handle-vertical {
  height: 8px;
  cursor: row-resize;
  background: transparent;
  position: relative;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.resize-handle-vertical::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background-color: var(--border-color);
  transition: background-color 0.15s ease;
}

.resize-handle-vertical:hover::after {
  background-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
}

.resize-handle-vertical:active::after {
  background-color: var(--accent-color);
}
```

### 4. Make TabBar the Electron drag region

Add `-webkit-app-region: drag` to the TabBar container and `-webkit-app-region: no-drag` to all interactive children (tabs, close buttons). This mirrors VS Code's approach.

**File changed:** `src/components/TabBar.jsx` — add drag region classes to the outer container div, and `no-drag` style to each tab element and button.

### 5. Wire `Ctrl+Shift+Enter` for Send to Terminal

Add to the existing keyboard handler in `src/App.jsx` (around line 107):

```javascript
// Ctrl+Shift+Enter: Send to Terminal
if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
  e.preventDefault();
  handleSendToTerminal();
  return;
}
```

Also auto-expand the terminal if it's collapsed when this shortcut is triggered (expand `terminalPanelRef` before sending content).

## Technical Considerations

- **Electron drag region on TabBar**: All interactive children (tab buttons, close icons, scroll areas) must have `-webkit-app-region: no-drag` to prevent drag from swallowing clicks. This is documented in `docs/solutions/integration-issues/resizable-panels-library-integration.md` — the same `-webkit-app-region` pattern is already used on resize handles.

- **macOS traffic light overlap**: With `titleBarStyle: 'hiddenInset'`, macOS traffic lights render at approximately `(12px, 8px)`. The TabBar starts at `y=0` in the editor pane, but the Activity Bar and side panel are to the left, so traffic lights likely overlap the side panel area, not the TabBar. Verify at runtime — if overlap occurs, add conditional `padding-top: 28px` on macOS Electron via `navigator.platform` detection.

- **Collapsed panel handle visibility**: When the side panel is collapsed to 0, the horizontal resize handle's 1px line would appear as a floating border at the ActivityBar edge. The `react-resizable-panels` library handles this — when `collapsedSize={0}`, the separator still exists but the panel is hidden. The 1px line will sit between ActivityBar and editor. This is acceptable since the ActivityBar's right edge needs a visual boundary anyway.

- **Terminal auto-expand on Send**: When `Ctrl+Shift+Enter` is pressed and the terminal is collapsed, call `terminalPanelRef.current.expand()` before sending content. Add a small delay (e.g., `requestAnimationFrame`) to ensure the terminal has mounted and xterm is ready before writing.

- **Dead code cleanup**: Remove the `title` variable computation (lines 162-166 in App.jsx) and the `handleToggleSidebar` references from the header (the function itself stays — it's used by `Ctrl+B`).

## Acceptance Criteria

- [ ] No visible gaps or padding between Activity Bar, side panels, editor, and terminal
- [ ] Resize handles render as a 1px line (using `--border-color`) with 8px invisible hit target
- [ ] Resize handles show accent color on hover/active
- [ ] The `editor-header` bar is completely removed — no 40px bar at the top
- [ ] `Ctrl+Shift+Enter` sends editor content to the terminal (same behavior as the old button)
- [ ] `Ctrl+Shift+Enter` auto-expands the terminal if it was collapsed
- [ ] TabBar is draggable in Electron for window movement
- [ ] Tab buttons and close icons remain clickable (not intercepted by drag region)
- [ ] All existing shortcuts still work: `Ctrl+S`, `Ctrl+B`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+F`, `Ctrl+P`, `` Ctrl+` ``
- [ ] Both Electron and browser runtimes work correctly
- [ ] No double borders anywhere between panels

## Success Metrics

- **40px vertical space recovered** by removing the title bar, giving more room to the editor
- **Visual cohesion** — panels feel like one surface, not separate boxes
- **Zero regressions** — all existing functionality (save, sidebar toggle, tab management, resize, terminal) works via keyboard shortcuts

## Dependencies & Risks

- **`react-resizable-panels` `::after` compatibility**: The `<Separator>` component renders as a plain `<div>`. CSS `::after` pseudo-elements should work, but verify the library doesn't override `position` or `overflow` on the separator. If it does, wrap the separator content differently.

- **Risk: TabBar drag region click conflicts**: If `-webkit-app-region: drag` is applied too broadly, double-clicking the TabBar could maximize the window instead of triggering tab actions. Mitigation: apply `drag` only to the TabBar's empty space (the container), and `no-drag` to every child element.

- **Risk: macOS traffic light overlap**: May need conditional padding. Low risk since this only affects Electron on macOS and can be patched after visual testing.

- **Risk: "Send to Terminal" discoverability**: Users who relied on the button won't know about `Ctrl+Shift+Enter`. Consider adding a tooltip to the terminal panel header or a brief toast notification on first use in a future iteration.

## Sources & References

- **Institutional learning**: [resizable-panels-library-integration.md](docs/solutions/integration-issues/resizable-panels-library-integration.md) — `-webkit-app-region: no-drag` is mandatory on all `<Separator>` elements in Electron
- **Institutional learning**: [editor-page-background-height.md](docs/solutions/ui-bugs/editor-page-background-height.md) — `align-items: flex-start` pattern for scrollable flex containers
- **Related brainstorm**: [2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — Activity Bar layout structure decision: `[ActivityBar | SidePanel | editor/terminal]`
- Current resize handle CSS: [src/App.css](src/App.css) lines 8-43
- Current title bar: [src/App.jsx](src/App.jsx) lines 162-216
- Keyboard handler: [src/App.jsx](src/App.jsx) lines 62-111
- TabBar component: [src/components/TabBar.jsx](src/components/TabBar.jsx)
- ActivityBar component: [src/components/ActivityBar.jsx](src/components/ActivityBar.jsx)
