---
title: "Resizable Panels (VSCode-style)"
type: refactor
status: active
date: 2026-02-28
origin: docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md
---

# Resizable Panels (VSCode-style)

## Overview

Add drag-to-resize functionality to Quipu Simple's side panel and terminal, matching VSCode's panel interaction model. The Activity Bar remains fixed at 48px. Both the side panel and terminal can be collapsed/expanded via buttons and keyboard shortcuts. Uses the `react-resizable-panels` library for battle-tested drag handling, keyboard accessibility, and touch support.

## Problem Statement / Motivation

Currently all panels have hardcoded dimensions: the side panel is fixed at 250px and the terminal at 300px. Users cannot adjust these to their workflow — a user reading long file names needs a wider sidebar, a user running tests wants a taller terminal. There's also no way to hide the terminal at all. This makes the editor feel rigid compared to the VSCode experience the project targets (see brainstorm: `docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md`).

## Proposed Solution

Replace the current fixed-size flex layout with `react-resizable-panels` (`Group`, `Panel`, `Separator`, `usePanelRef`). The layout becomes two nested panel groups:

```
app-container (flex row, unchanged)
  ActivityBar (48px fixed, OUTSIDE panel groups, unchanged)
  <Group orientation="horizontal">
    <Panel collapsible>           ← side panel (Explorer | Search | Git)
    <Separator />                 ← vertical drag handle
    <Panel>                       ← main area
      <Group orientation="vertical">
        <Panel>                   ← editor pane
        <Separator />             ← horizontal drag handle
        <Panel collapsible>       ← terminal pane
      </Group>
    </Panel>
  </Group>
```

**Key architectural change:** The side panel switches from conditional rendering (`{activePanel && ...}`) to the library's collapse model (always in DOM, collapsed to 0px width). The panel *content* (Explorer/Search/Git) is still conditionally rendered inside the always-mounted panel container. This preserves the library's layout calculations while keeping component lifecycle clean.

## Technical Considerations

### Library: `react-resizable-panels`

- **Why**: Handles mouse, touch, and keyboard resize out of the box. ARIA `role="separator"` for accessibility. ~8KB gzipped. Well-maintained (bvaughn).
- **API**: `Group` (container with orientation), `Panel` (resizable child), `Separator` (drag handle), `usePanelRef` (imperative collapse/expand/resize).
- **Install**: `npm install react-resizable-panels`

### State Model Changes

**Current** (`src/App.jsx`):
- `activePanel` serves double duty: tracks which panel content AND whether the sidebar is visible (`null` = hidden)

**New**:
- `activePanel` — tracks which content to show (`'explorer'` | `'search'` | `'git'` | `null`). When `null`, content area is empty but the panel may still be in the DOM at 0 width.
- `sidePanelRef` via `usePanelRef()` — imperative control of collapse/expand
- `terminalPanelRef` via `usePanelRef()` — imperative control of collapse/expand
- `isTerminalVisible` state — tracks terminal visibility for the toggle

**`handlePanelToggle` rewrite** (three-way logic):
1. Panel collapsed + icon clicked → set `activePanel` to that panel, call `sidePanelRef.expand()`
2. Panel open showing same content + same icon clicked → call `sidePanelRef.collapse()`
3. Panel open showing different content + icon clicked → set `activePanel` to new panel (no resize)

### CSS Changes

**Remove from `App.css`**:
- `.side-panel { width: 250px; min-width: 200px; max-width: 400px; }` — library manages sizing
- `.terminal-pane { height: 300px; }` — library manages sizing

**Add separator styles** (target `[data-panel-group-direction]` and `[data-resize-handle-state]`):
- Default: 4px wide/tall, transparent, `cursor: col-resize` / `cursor: row-resize`
- Hover: `background: var(--accent-color)` at 50% opacity
- Active (dragging): `background: var(--accent-color)` at full opacity
- All separators: `-webkit-app-region: no-drag` (Electron compatibility)

**Hide separator when collapsed**: Use CSS to set `opacity: 0; pointer-events: none` on the separator when its adjacent panel is at `collapsedSize`.

### Size Constraints

| Panel         | defaultSize       | minSize | maxSize | collapsedSize |
| ------------- | ----------------- | ------- | ------- | ------------- |
| Side panel    | `250px`           | `200px` | `400px` | `0`           |
| Editor pane   | (fills remaining) | `100px` | —       | —             |
| Terminal pane | `300px`           | `100px` | `70%`   | `0`           |

### Keyboard Shortcuts

| Shortcut       | Action            | Current                             | New                                                               |
| -------------- | ----------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `Ctrl+B`       | Toggle side panel | Sets `activePanel` to null/explorer | Calls `sidePanelRef.collapse()` / `sidePanelRef.expand()`         |
| `` Ctrl+` ``   | Toggle terminal   | — (doesn't exist)                   | Calls `terminalPanelRef.collapse()` / `terminalPanelRef.expand()` |
| `Ctrl+Shift+F` | Open search panel | Sets `activePanel` to `'search'`    | Same + `sidePanelRef.expand()` if collapsed                       |

### Integration Concerns

- **Terminal ResizeObserver**: The Terminal component already uses `ResizeObserver` + `fitAddon.fit()`. When the terminal panel is resized by dragging, `ResizeObserver` fires automatically — no extra wiring needed.
- **SearchPanel auto-focus**: Currently uses `useEffect([], [])` which fires on mount. Since the panel is now always mounted, add a `useEffect` that focuses the search input when `activePanel` changes to `'search'`.
- **SourceControlPanel polling**: Currently polls `git status` every 5 seconds on mount. With always-mounted panels, gate polling behind a check: only poll when `activePanel === 'git'`.
- **Comment track positioning**: The `.comments-track` uses `left: calc(50% + 408px + 1rem)` which may overflow when the editor shrinks. This is a pre-existing issue — file as a follow-up, not a blocker.
- **Electron drag regions**: All `<Separator>` elements need `-webkit-app-region: no-drag` to prevent Electron from intercepting drag events for window movement.

## System-Wide Impact

- **Interaction graph**: Dragging a separator → library updates flex sizes → `ResizeObserver` fires on affected containers → terminal calls `fitAddon.fit()`, editor reflows content. Activity Bar icons → `handlePanelToggle` → `setActivePanel` + `sidePanelRef.collapse()/expand()`.
- **Error propagation**: No new error paths. The library is purely presentational. Panel content components are unchanged.
- **State lifecycle risks**: Switching from conditional rendering to always-mounted means SearchPanel and SourceControlPanel mount once and stay mounted. SearchPanel focus and SourceControlPanel polling must be gated on `activePanel` value.
- **API surface parity**: No backend changes. This is purely frontend. Works identically in Electron and browser runtimes.

## Acceptance Criteria

- [x] Side panel is resizable by dragging the vertical separator between it and the editor (`src/App.jsx`)
- [x] Terminal is resizable by dragging the horizontal separator between it and the editor (`src/App.jsx`)
- [x] Activity Bar remains fixed at 48px and is not affected by resize operations
- [x] Side panel respects min (200px) and max (400px) width constraints
- [x] Terminal respects min (100px) height constraint
- [x] `Ctrl+B` collapses/expands the side panel
- [x] `` Ctrl+` `` collapses/expands the terminal
- [x] Activity Bar icons expand the side panel if collapsed and show the correct content
- [x] Clicking the active panel's Activity Bar icon collapses the side panel
- [x] `Ctrl+Shift+F` expands the side panel and shows the search panel with input focused
- [x] Separator shows hover/active visual feedback (terracotta accent color)
- [x] Separator cursor changes to `col-resize` (vertical) or `row-resize` (horizontal) on hover
- [x] Terminal `fitAddon.fit()` works correctly during and after resize
- [x] SourceControlPanel only polls git status when it is the active panel
- [x] SearchPanel input is focused when switching to search panel (not just on mount)
- [x] Separators have `-webkit-app-region: no-drag` for Electron compatibility
- [x] No panel size persistence (sizes reset on reload) — intentional for now

## Success Metrics

- All existing keyboard shortcuts (`Ctrl+B`, `Ctrl+Shift+F`, `Ctrl+P`, `Ctrl+S`, `Ctrl+W`, `Ctrl+Tab`) continue to work
- Side panel and terminal can be resized smoothly without layout jank
- Terminal renders correctly (no blank areas or misaligned text) during and after resize
- Panel collapse/expand is responsive (< 100ms to toggle)

## Dependencies & Risks

**Dependencies:**
- `react-resizable-panels` npm package (new dependency)

**Risks:**
- **Comment track overflow**: Resizing the editor area may cause the `.comments-track` to overflow. Mitigation: flag as follow-up task, not a blocker.
- **Always-mounted side panel contents**: SearchPanel and SourceControlPanel will mount once and stay mounted. Mitigation: gate side-effects (focus, polling) behind `activePanel` checks.
- **Editor page width**: The A4-width editor page (816px) plus comments track (300px) needs ~1200px minimum. With a wide side panel, smaller viewports may clip. Mitigation: existing media queries handle this at viewport level; panel resize does not trigger media queries, so this is a known limitation for follow-up.

## MVP

### `src/App.jsx` (layout restructure)

```jsx
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';

// Inside App component:
const sidePanelRef = usePanelRef();
const terminalPanelRef = usePanelRef();
const [isTerminalVisible, setIsTerminalVisible] = useState(true);

const handlePanelToggle = useCallback((panelId) => {
  setActivePanel(prev => {
    const isSamePanel = prev === panelId;
    if (isSamePanel) {
      sidePanelRef.current?.collapse();
      return null;
    } else {
      sidePanelRef.current?.expand();
      return panelId;
    }
  });
}, []);

const handleToggleTerminal = useCallback(() => {
  if (terminalPanelRef.current?.isCollapsed()) {
    terminalPanelRef.current.expand();
    setIsTerminalVisible(true);
  } else {
    terminalPanelRef.current?.collapse();
    setIsTerminalVisible(false);
  }
}, []);

// In JSX:
<div className="app-container">
  <ActivityBar />
  <Group orientation="horizontal" style={{ flex: 1 }}>
    <Panel
      panelRef={sidePanelRef}
      collapsible
      collapsedSize={0}
      minSize={200}
      maxSize={400}
      defaultSize={250}
    >
      <div className="side-panel">
        {activePanel === 'explorer' && <FileExplorer />}
        {activePanel === 'search' && <SearchPanel />}
        {activePanel === 'git' && <SourceControlPanel />}
      </div>
    </Panel>
    <Separator className="resize-handle-horizontal" />
    <Panel>
      <Group orientation="vertical">
        <Panel minSize={100} className="editor-pane">
          <div className="editor-header">...</div>
          <TabBar />
          <Editor />
        </Panel>
        <Separator className="resize-handle-vertical" />
        <Panel
          panelRef={terminalPanelRef}
          collapsible
          collapsedSize={0}
          minSize={100}
          defaultSize={300}
        >
          <div className="terminal-pane">
            <Terminal />
          </div>
        </Panel>
      </Group>
    </Panel>
  </Group>
</div>
```

### `src/App.css` (separator styles + cleanup)

```css
/* Remove fixed sizing — library manages these */
/* .side-panel { width: 250px; ... } → remove width/min-width/max-width */
/* .terminal-pane { height: 300px; } → remove height */

/* Separator base styles */
.resize-handle-horizontal,
.resize-handle-vertical {
  -webkit-app-region: no-drag;
  background: transparent;
  transition: background-color 0.15s ease;
  flex-shrink: 0;
}

.resize-handle-horizontal {
  width: 4px;
  cursor: col-resize;
}

.resize-handle-vertical {
  height: 4px;
  cursor: row-resize;
}

/* Hover state */
.resize-handle-horizontal:hover,
.resize-handle-vertical:hover {
  background-color: color-mix(in srgb, var(--accent-color) 50%, transparent);
}

/* Active (dragging) state */
[data-resize-handle-state="active"].resize-handle-horizontal,
[data-resize-handle-state="active"].resize-handle-vertical {
  background-color: var(--accent-color);
}
```

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md](docs/brainstorms/2026-02-28-editor-overhaul-brainstorm.md) — Activity Bar layout structure, panel system design
- **Library docs:** react-resizable-panels by bvaughn — Group/Panel/Separator/usePanelRef API
- **Existing CSS constraints:** `src/App.css` — current `.side-panel` min/max widths (200px–400px), `.terminal-pane` height (300px)
- **Existing learnings:** `docs/solutions/ui-bugs/editor-page-background-height.md` — flexbox `align-items: flex-start` pattern for scrollable containers
