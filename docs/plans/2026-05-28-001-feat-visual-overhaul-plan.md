---
title: "feat: visual overhaul — drop menubar, workspace switcher, floating sidebar/terminal"
type: feat
status: planned
date: 2026-05-28
---

# Visual overhaul

> **Color constraint:** the cream/tan palette in the user's design mockups is illustrative only. Keep Quipu's existing theme tokens (`bg-bg-base`, `bg-bg-surface`, etc.). This task is purely about layout, structure, and interaction patterns.

## Problem

Quipu's chrome today looks like a traditional code-editor: title bar with a File/Edit/View/Terminal menubar in the top-left, a thin sidebar that always sits flush against everything, no way to switch workspaces without opening a menu, and a terminal panel that hides behind a keyboard shortcut. The target is a more modern desktop-app shell (Linear / Notion family) where the sidebar and terminal feel like cards floating on a canvas, the workspace name itself is the workspace switcher, and the menubar disappears in favor of contextual surfaces.

## Final state

See `project/Tasks/VisualOverhaul.md` for the user-facing spec.

In one sentence per region:

- **Top strip** — slim band that sits *only above the editor area*; contents are just the Electron window controls on the right. No menubar.
- **Sidebar** — full window height, floating-card visual (rounded + shadow + gap); contents top-to-bottom: logo (collapse toggle), activity rail, workspace switcher button, file explorer.
- **Workspace switcher** — button labelled with the current workspace name; click opens a dropdown listing known workspaces (active one has an animated checkmark) plus `Open Folder…`, `View Recent`, `New Window`.
- **Editor area** — flat on the canvas, not a card. Tab bar unchanged.
- **Terminal** — floating-card visual matching sidebar; toolbar has an `×` close button (slide-down + fade-out, editor expands).
- **Status bar** — unchanged.

## Phased delivery

Five phases, each independently mergeable, ordered so earlier phases don't depend on later ones.

### Phase 1 — Drop the menubar, restructure the top of the window

**Files:**
- `src/components/ui/TitleBar.tsx` — remove `<MenuBar />` (line 42), remove centered title (lines 44-45); keep window controls anchored right.
- `src/components/ui/MenuBar.tsx` — DELETE the component, but harvest its keyboard shortcuts (Quick Open, find-in-files, save, undo/redo, etc.) — those stay registered via `keybindingRegistry` and the command palette so we don't lose accessibility.
- `src/App.tsx:1104-1283` — restructure the resizable panel composition so the sidebar reaches the very top of the window (no titlebar above it), and the top strip occupies only the area above the editor + terminal column.

**Actions to relocate from the menubar:**
- File → Open Folder → moves into the workspace switcher dropdown (Phase 2).
- File → Open Recent → moves into the workspace switcher dropdown (Phase 2).
- File → New Window → moves into the workspace switcher dropdown (Phase 2).
- File → Save / Close Tab / New File → already keyboard-shortcut driven; expose via command palette.
- Edit → Undo / Redo / Cut / Copy / Paste — system + editor handles these; remove the menu entries.
- Edit → Find in files — already has a keyboard shortcut + dedicated panel; add to command palette.
- View → Toggle sidebar — replaced by clicking the logo (Phase 4).
- View → Toggle terminal — replaced by terminal `×` button (Phase 5) + existing Ctrl+\` shortcut.
- View → Quick Open / Explorer / Search / Git — keyboard shortcuts already exist; add explicit entries to the command palette as a discoverability backstop.
- Terminal → Toggle / New / Send — same as View → Toggle terminal; keep the keyboard shortcuts.

**Acceptance:** menubar is gone, window has a slim top strip above editor only with window controls on the right, sidebar reaches the top edge, no functionality is silently lost (all menu actions reachable via keyboard or command palette).

### Phase 2 — Workspace switcher dropdown

**Files:**
- New: `src/components/ui/WorkspaceSwitcher.tsx` — a button labelled with the current workspace folder name, opens a Radix Popover (matching the existing `MenuBar.tsx:75-84` Open Recent submenu's logic) on click.
- `src/components/ui/FileExplorer.tsx` — embed `WorkspaceSwitcher` at the top of the explorer (above the file tree).
- `src/context/FileSystemContext.tsx` — already exposes `workspacePath`, `recentWorkspaces`, `selectFolder`. No new state needed.

**Dropdown contents (in order):**
1. Section header: workspaces (small label).
2. Each entry in `recentWorkspaces` — name on the left, animated checkmark on the active one. Click → `selectFolder(path)`.
3. Divider.
4. `Open Folder…` — calls existing `selectFolder()` (no path → opens the OS picker).
5. `View Recent` — opens a deeper recent-list view (existing route from MenuBar; reuse the handler).
6. `New Window` — calls Electron `window.electron.newWindow()` or the existing equivalent.

**Animated checkmark:** when the user picks a different workspace, the check icon translates from the previous active row to the new one with a ~200ms ease before the workspace actually switches (existing `selectFolder` is async; animate during that beat).

**Acceptance:** clicking the workspace label opens the dropdown, current workspace has the check, picking another workspace plays the animation and then loads it, Open Folder / View Recent / New Window work.

### Phase 3 — Floating-card styling for sidebar and terminal

**Files:**
- `src/App.tsx` layout — outer container background uses a slightly darker canvas token (existing `bg-bg-base` is fine; just ensure sidebar / terminal sit on top with their own surface token + shadow + gap).
- Sidebar wrapper (the column containing ActivityBar + FileExplorer) — wrap in a `<div className="rounded-lg border border-border bg-bg-surface shadow-md m-2">…` pattern. No theme changes — use existing tokens.
- Terminal panel wrapper (App.tsx:1266-1276) — same treatment.
- Editor panel stays flat (no border / shadow / margin).

**Resizable handles:** keep `react-resizable-panels` divider behavior, just make sure the visual handle is on the gap between the floating cards (not on the cards themselves). Adjust handle styling to be a subtle drag-pill in the gap.

**Acceptance:** sidebar and terminal visibly float with a small gap from the window edges and from each other; editor area is flat with no border/shadow; resizing the divider still works.

### Phase 4 — Sidebar collapse via logo

**Files:**
- `src/components/ui/ActivityBar.tsx` — relocate / add the brand logo at the top, above the icon list. Make the logo a button that toggles `sidebarCollapsed` state.
- `src/App.tsx` — add `sidebarCollapsed` state (probably in WorkspaceContext or a new `LayoutContext`). When collapsed, the whole left card slides + fades out (`translate-x-full opacity-0 transition duration-200`). The Panel can be `collapsed={true}` via `react-resizable-panels`.
- New: `src/components/ui/CollapsedSidebarHandle.tsx` — small logo button that appears in the top strip area when sidebar is collapsed. Hover after 200ms delay → popover with a compact explorer preview. Click → re-expands the sidebar.

**Acceptance:** clicking the logo collapses the sidebar with animation; collapsed state shows a small logo button in the top strip; hovering the button shows a small preview; clicking the button restores the sidebar with animation.

### Phase 5 — Terminal close button

**Files:**
- `src/components/ui/Terminal.tsx:75-662` — there's already a tab-close button (lines 590-594). Add a top-right `×` on the terminal panel itself (separate from per-tab close) that calls the existing `terminal.toggle` action (or `setCollapsed(true)` on the `terminalPanelRef`).
- `src/App.tsx:1266-1276` — verify the existing collapse logic from `terminalPanelRef.current?.collapse()` triggers a slide-down + fade animation. If not, add CSS transition via `react-resizable-panels` callbacks (`onCollapse` / `onExpand`) or wrap the Terminal in a transitioning container.

**Acceptance:** clicking the `×` slides the terminal down and fades it out; editor panes grow to fill the space; Ctrl+\` re-opens it with the reverse animation.

## Out of scope

- Theme changes / new colors. We keep `bg-bg-base`, `bg-bg-surface`, etc. as they are.
- Editor-pane internal redesign (agent chat layout, tab styling beyond removing any card wrapper if present).
- Date/context-number hover affordance on agent panes — separate task (`ec538edf`).
- Mobile / touch layout.
- Per-pane visual differentiation (the two side-by-side agents look identical today; we keep that).

## Test plan

- Per phase: type-check (`npx tsc --noEmit`), unit tests if any exist for the touched component, and a manual launch from the worktree to verify the live UI.
- Cross-phase regression checks: workspace switching still works, all keyboard shortcuts that the menubar exposed still work, file-watcher reload still works, terminal still receives input after close-then-reopen.
- For the animated transitions, eyeball them at the dev server with the React Profiler open to confirm no janky re-renders cascading.

## Notes for the implementor

- This is a layout-only change. **Touch theme tokens at your own risk.** If a token is missing for a new visual (e.g., the floating-card surface color), introduce a new token in `src/styles/theme.css` rather than swapping an existing one. Aside: the existing tokens (`bg-bg-surface`, `bg-bg-elevated`) already provide three surface levels which should be enough.
- `react-resizable-panels` is opinionated. Test resize handles after every layout change in App.tsx — it's easy to break.
- Window-region drag (`-webkit-app-region: drag` / `no-drag`) is sensitive in the top strip. Make sure the window controls stay clickable (`no-drag`) and the rest of the strip is `drag`.
- The TitleBar's center title text (line 44-45 in TitleBar.tsx today) was the only way users saw the workspace name in the chrome. After Phase 2 the workspace name lives in the sidebar dropdown button — the title can stay in the OS window title bar (set via `BrowserWindow.setTitle`) for taskbar identification but not on-screen.
