---
title: "Visible gaps between UI panels caused by transparent react-resizable-panels separators"
date: "2026-02-28"
status: solved
module: Frontend Layout
component: Panel Separators
tags:
  - react-resizable-panels
  - css
  - layout
  - tailwind
related:
  - docs/solutions/integration-issues/resizable-panels-library-integration.md
  - docs/solutions/ui-bugs/editor-page-background-height.md
---

# Visible Gaps Between UI Panels from Transparent Separators

## Problem

The app uses `react-resizable-panels` v4.7.0 for a resizable layout: ActivityBar | Side Panel | Editor | Terminal. The `<Separator>` elements were styled as **8px wide/tall transparent containers** with a 1px `::after` pseudo-element for the visible divider line.

This created highly visible 8px gaps between panels with different background colors (e.g., warm editor `#252220` vs dark terminal `#1c1a17`). The transparent space revealed the color difference as a prominent stripe.

Additionally, component-level borders (`border-right` on `.side-panel`, `border-top` on `.terminal-pane`, `border-r` on ActivityBar) doubled up with the separator, creating 2-3px of stacked borders.

## Root Cause

The `<Separator>` component from `react-resizable-panels` occupies **real layout space**. An 8px transparent separator between two differently-colored panels makes those 8px visible as a gap. The `::after` pseudo-element approach (1px line centered inside 8px transparent container) does not solve this because the remaining 7px of transparent space is still visible.

```
BROKEN:  [dark panel] [8px transparent gap with 1px line] [light panel]
                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                       7px of gap visible between panels
```

## What Didn't Work

8px transparent separator with `::after` pseudo-element:

```html
<!-- Tailwind classes on Separator -->
<Separator className="shrink-0 w-2 cursor-col-resize bg-transparent relative
  after:content-[''] after:absolute after:top-0 after:bottom-0
  after:left-1/2 after:w-px after:bg-border" />
```

Equivalent CSS:
```css
.resize-handle-horizontal {
  width: 8px;
  background: transparent;
  position: relative;
}
.resize-handle-horizontal::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0; left: 50%;
  width: 1px;
  background-color: var(--border-color);
}
```

## Working Solution

### 1. Solid 1px separator (editor/terminal divider)

Make the separator itself the visual line. No pseudo-elements needed.

```html
<Separator
  className="shrink-0 h-px cursor-row-resize bg-border transition-colors hover:bg-accent/50 active:bg-accent"
  style={{ WebkitAppRegion: 'no-drag' }}
/>
```

### 2. Zero-width separator (side panel/editor boundary)

For seamless boundaries where no visible divider is wanted:

```html
<Separator
  className="shrink-0 w-0 cursor-col-resize bg-transparent"
  style={{ WebkitAppRegion: 'no-drag' }}
/>
```

### 3. Remove component-level borders

Eliminate borders that double up with separators:

```diff
- .side-panel { border-right: 1px solid var(--border-color); }
+ .side-panel { /* no border */ }

- .terminal-pane { border-top: 1px solid var(--border-color); }
+ .terminal-pane { /* no border */ }

- <!-- ActivityBar Tailwind -->
- className="... border-r border-border"
+ className="... "
```

## Key Insight

With `react-resizable-panels`, the `<Separator>` element IS the divider. Its dimensions define the visual gap.

- **Want a visible divider?** Make the separator 1px with a solid background (`h-px bg-border`).
- **Want no divider?** Make the separator 0px (`w-0 bg-transparent`). Resize still works.
- **Never** use a wider transparent element with a pseudo-element inside it. The transparent space will always be visible between differently-colored panels.

## Prevention

1. **Start minimal.** Default to 1px solid separators. Only widen if users can't grab them.
2. **Check adjacent backgrounds.** If panels have different background colors, transparent separators will always show gaps.
3. **One source of borders.** Either the separator or the component provides the visual boundary, never both.
4. **Always add `-webkit-app-region: no-drag`** on separators in Electron apps (see `resizable-panels-library-integration.md`).
