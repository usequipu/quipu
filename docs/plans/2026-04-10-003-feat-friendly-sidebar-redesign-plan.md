---
title: "feat: Friendly sidebar redesign — Explorer & ActivityBar"
type: feat
status: active
date: 2026-04-10
---

# feat: Friendly sidebar redesign — Explorer & ActivityBar

## Overview

Redesign the ActivityBar and FileExplorer to feel like a modern workspace app (Notion/Affine-style) rather than a VS Code clone. The jarring dark-blue ActivityBar column is replaced with a unified surface-toned sidebar. File tree items get comfortable height, rounded hover states, and theme-aware colors that are actually visible in light mode. A soft shadow divides the sidebar cluster from the main editor.

All work is done on a feature branch: `git checkout -b feat/friendly-sidebar`.

## Problem Frame

The current sidebar has three friction points:

1. **ActivityBar contrast mismatch** — the deep blue `bg-activity-bar` (#2b4c7e) next to the white FileExplorer looks like two unrelated UI panels bolted together.
2. **Invisible hover states in light mode** — `hover:bg-white/[0.06]` (6% white opacity) on a white background is imperceptible; the active state `bg-white/10` fares only slightly better. These tokens were clearly tuned for dark mode only.
3. **VS Code typography** — "EXPLORER" in uppercase tracking-wider, the redundant workspace folder name row also in uppercase, and the dense 22px item rows all signal "code editor", not "friendly workspace app."

## Scope Boundaries

- No functional changes — file CRUD, search, git panel, drag-and-drop, context menus, and keyboard shortcuts are untouched.
- No changes to SearchPanel, SourceControlPanel, TabBar, Terminal, or Editor.
- No changes to services, contexts, or data models.
- The ActivityBar stays as a separate narrow column (panel-switching logic is preserved).
- No new icons library — Phosphor icons are already in use.

## Context & Research

### Relevant Code and Patterns

- `src/components/ui/ActivityBar.tsx` — 65 lines; uses `bg-activity-bar`, `rounded-r-2xl`, left `border-l-3` active indicator
- `src/components/ui/FileExplorer.tsx:487` — root div uses `bg-bg-surface`; header at line 488 uses `uppercase tracking-wider`; file tree item at line 313 uses `h-[22px] hover:bg-white/[0.06]`
- `src/App.tsx:816-832` — layout: `<ActivityBar /> <Group><Panel (sidebar)><div class="bg-bg-surface ..."><FileExplorer /></div></Panel><Separator/><Panel (editor)>`
- `src/styles/theme.css` — theme tokens for all three themes (light, dark, tinted)
- Existing theme-aware hover pattern: `bg-bg-elevated` / `bg-bg-overlay` work across all three themes (light: #f5f5f5/#e8e8e8, dark: #2d2d2d/#333333, tinted: #efe3c4/#e8ddb8)

### Key Token Inventory

| Token | Light | Dark | Tinted |
|-------|-------|------|--------|
| `bg-bg-surface` | #ffffff | #242424 | #f9f1d8 |
| `bg-bg-elevated` | #f5f5f5 | #2d2d2d | #efe3c4 |
| `bg-bg-overlay` | #e8e8e8 | #333333 | #e8ddb8 |
| `text-text-secondary` | #616161 | #a0a0a0 | #877771 |
| `text-text-tertiary` | #9e9e9e | #666666 | #c4b3a3 |
| `border-border` | #e0e0e0 | #383838 | (see dark overrides) |

## Key Technical Decisions

- **Use `bg-bg-elevated` / `bg-bg-overlay` for hover/active** instead of `bg-white/*` alpha — the existing theme tokens are the right abstraction and already work across all three themes. The `bg-white/[0.06]` pattern is only usable in dark mode.
- **No new theme tokens needed** — the surface and text tokens already cover the ActivityBar redesign. The `--color-activity-bar*` tokens can be updated to alias the surface tokens, or the component can reference surface tokens directly. Direct reference is simpler and avoids token proliferation.
- **Shadow on the sidebar panel wrapper** (in App.tsx) rather than on ActivityBar alone — this puts the visual edge in the right place (after the file explorer, not after the activity bar), even though ActivityBar sits outside the PanelGroup.
- **Remove the redundant h-[22px] workspace folder name row** from FileExplorer — the redesigned header already shows the workspace name, so the separate mini-row is no longer needed.
- **Keep `rounded-md` for hover pill shape** — matches the style of reference apps while being compatible with react-resizable-panels layout (no clip issues).

## Open Questions

### Resolved During Planning

- **Should the ActivityBar be merged into the FileExplorer?** No — it switches between Explorer/Search/Git panels. Keeping it as a narrow separate column is correct; we just unify the visual style.
- **Which hover token to use?** `bg-bg-elevated` on hover, `bg-bg-overlay` on active. These are already theme-correct for all three themes.
- **Shadow approach?** Add `shadow-[2px_0_8px_rgba(0,0,0,0.06)]` and `relative z-10` to the `div.bg-bg-surface` wrapper in App.tsx (line 827). This makes the shadow appear at the sidebar/editor seam. Also add a `border-r border-border` to ActivityBar so there's a visual line between it and FileExplorer.

### Deferred to Implementation

- Exact shadow values may need minor tuning once rendered across all three themes.
- The tinted theme may want a warmer shadow color — adjust if the gray shadow looks off.

## Implementation Units

- [ ] **Unit 1: ActivityBar visual unification**

**Goal:** Remove the dark blue ActivityBar and make it visually part of the sidebar surface.

**Requirements:** Less VS Code, friendlier, unified with FileExplorer visually.

**Dependencies:** None — no other units depend on this.

**Files:**
- Modify: `src/components/ui/ActivityBar.tsx`
- Modify: `src/styles/theme.css`

**Approach:**
- Change the root div: remove `bg-activity-bar rounded-r-2xl`, add `bg-bg-surface border-r border-border`
- Change each button: remove `w-12 h-12 border-l-3 border-transparent`, add `w-9 h-9 rounded-lg mx-1.5` with `hover:bg-bg-elevated transition-colors`
- Change active state: remove `border-l-activity-bar-active`, add `bg-bg-elevated text-text-primary`
- Change icon colors: replace `text-activity-bar-text hover:text-activity-bar-active` with `text-text-tertiary hover:text-text-secondary`, active with `text-text-primary`
- Git badge: replace `bg-white/90 text-activity-bar` with `bg-accent text-white` (works on any background)
- In theme.css: update `--color-activity-bar*` tokens in all three theme blocks to alias the surface values (keeps tokens usable if referenced elsewhere, prevents future confusion)

**Patterns to follow:**
- `src/components/ui/FileExplorer.tsx:492` — existing `hover:bg-white/[0.08] rounded-sm` on the refresh button (we'll upgrade this pattern in Unit 3, but it shows the rounded approach)

**Test scenarios:**
- Happy path: All three panels (Explorer, Search, Git) show correct active highlight when selected
- Happy path: Inactive icons use muted text color; hovering lightens them
- Happy path: Git badge renders with `bg-accent text-white` on the changed icon
- Edge case: ActivityBar with no active panel shows no highlight
- Visual: Light theme — no dark blue strip visible; the sidebar looks unified
- Visual: Dark and tinted themes — ActivityBar blends with the sidebar surface, border divider is subtle

**Verification:**
- Opening the app shows a sidebar where ActivityBar and FileExplorer appear to share the same background
- Switching panels (Explorer → Search → Git) shows a rounded highlight on the active icon
- No left-border indicator remains

---

- [ ] **Unit 2: FileExplorer header redesign**

**Goal:** Replace the VS Code "EXPLORER" uppercase header with a friendly workspace name and remove the redundant workspace folder name row.

**Requirements:** Friendlier, less VS Code, workspace name visible and prominent.

**Dependencies:** None.

**Files:**
- Modify: `src/components/ui/FileExplorer.tsx`

**Approach:**
- Header div (line 488): Change height from `h-[35px]` to `h-[44px]`, remove `uppercase tracking-wider text-[11px] font-semibold`
- Header content: Replace `<span>EXPLORER</span>` with a small colored icon badge + workspace name
  - Icon badge: `w-5 h-5 rounded bg-accent/15 flex items-center justify-center` containing `FolderIcon size={12} className="text-accent"`
  - Workspace name: `text-[13px] font-medium text-text-primary truncate flex-1`, showing `workspacePath?.split('/').pop() ?? 'Files'`
  - When no workspace is open, show `'Files'` as a fallback label
- Refresh button: keep as-is but tighten the hover style — use `rounded-md hover:bg-bg-elevated` instead of `hover:bg-white/[0.08]`
- Remove the h-[22px] workspace folder name row entirely (lines 514-519). The header now serves this purpose. The `openFolder` click can move to a right-click / menu action or to the header icon.

**Patterns to follow:**
- `src/components/ui/FileExplorer.tsx:505-510` — "No folder opened" state calls `openFolder` via a button; maintain this flow when no workspace is set

**Test scenarios:**
- Happy path: Header shows `<FolderIcon> my-project-name` when a workspace is open
- Happy path: Header shows `<FolderIcon> Files` when no workspace is set
- Edge case: Very long workspace name truncates cleanly with `truncate`
- Edge case: Workspace path with trailing slash — `split('/').pop()` still returns the folder name
- Visual: Header visually distinct from the file tree below (border-b) but not VS Code uppercase

**Verification:**
- No "EXPLORER" text visible anywhere in the sidebar
- Workspace folder name appears once in the header (not again in a separate row below)
- Refresh button still works and tooltip is preserved

---

- [ ] **Unit 3: File tree item restyling**

**Goal:** Make file tree rows comfortable, clearly interactive in all themes, and give them rounded hover highlights.

**Requirements:** More friendly, hover states visible in light mode.

**Dependencies:** None.

**Files:**
- Modify: `src/components/ui/FileExplorer.tsx`

**Approach:**
- **Row height**: Change `h-[22px]` to `h-[26px]` everywhere — both in `FileTreeItem` (line 313) and the `isRootCreating` create row (lines 359, 531)
- **Hover/active states on FileTreeItem** (line 312-316):
  - Replace `hover:bg-white/[0.06]` with `hover:bg-bg-elevated`
  - Replace `bg-white/10` (active) with `bg-bg-overlay`
  - Add `rounded-md mx-1` to the row className so the highlight has inset rounding
  - Adjust `paddingLeft` accordingly to account for the `mx-1` margin (subtract 4px: `${8 + depth * 16}px`)
- **Caret/indent color**: `text-text-tertiary` is already used on carets (line 324-325) — keep as-is
- **Scrollbar colors**: Change `[&::-webkit-scrollbar-thumb]:bg-white/15` and hover to `[&::-webkit-scrollbar-thumb]:bg-border` / `hover:bg-text-tertiary` (line 522)
- **Rename/create inputs** (lines 332, 362, 535): Update `h-[18px]` to `h-[20px]` to fit the taller rows; keep existing border-accent styling
- **Workspace folder name row hover** (line 515): This row is being removed in Unit 2, so skip
- **leading-[22px]** on the filename span (line 344): Update to `leading-[26px]`

**Patterns to follow:**
- `src/styles/theme.css` — `bg-bg-elevated` / `bg-bg-overlay` for hover hierarchy

**Test scenarios:**
- Happy path: Clicking a file opens it and shows `bg-bg-overlay` active highlight
- Happy path: Expanding a folder shows children with correct indentation
- Happy path: Hover state on a file/folder row is visibly distinct from the resting state in light theme
- Edge case: Deep nesting (depth 5+) — rows are still readable, indentation doesn't overflow
- Edge case: Drag-and-drop `bg-accent/20` highlight still visible and not clashing with new hover styles
- Edge case: Inline rename input appears at full row height and focus ring is visible
- Integration: Scrollbar thumb visible in all three themes (was invisible in light mode previously)

**Verification:**
- In light mode: hovering any file/folder row shows a clearly visible gray background
- In dark mode: same hover visible as a slightly lighter row
- Active (open) file has a distinctly darker background than hovered items
- No layout shift — row heights are consistent throughout the tree

---

- [ ] **Unit 4: Sidebar shadow divider**

**Goal:** Add a subtle shadow between the sidebar (ActivityBar + FileExplorer) and the main editor area.

**Requirements:** "A line dividing the explorer and the workspace (you can add a little shadow)"

**Dependencies:** Units 1–3 (visual coherence of the sidebar should be in place before adding the shadow, but technically independent)

**Files:**
- Modify: `src/App.tsx`

**Approach:**
- Target the `div.bg-bg-surface` wrapper around the sidebar panel content (App.tsx line 827):
  ```
  <div className="h-full overflow-hidden flex flex-col bg-bg-surface" data-context="explorer">
  ```
- Add `relative z-10 shadow-[2px_0_8px_rgba(0,0,0,0.06)]` to this div's className
- The `z-10` ensures the shadow renders on top of the editor panel content to the right
- The horizontal Separator (line 833) stays transparent as it is — the shadow provides the visual division

**Patterns to follow:**
- Existing `shadow-lg` on context menus / overlays in the codebase — same aesthetic language, much lighter weight

**Test scenarios:**
- Visual: Light theme — soft shadow visible between sidebar and editor, not harsh
- Visual: Dark theme — shadow is subtle (dark on dark); may need to increase alpha slightly if invisible. Implementation should verify and tune.
- Visual: Tinted theme — warm cream background; shadow reads correctly
- Edge case: When sidebar panel is collapsed (Ctrl+B), the shadow collapses with it (since it's on the panel content div, not on the outer group)

**Verification:**
- A soft shadow is visible at the right edge of the sidebar
- Shadow does not appear when the sidebar is fully collapsed
- No layout shift or clipping of the editor content

## System-Wide Impact

- **Interaction graph:** No callbacks or middleware affected — this is purely CSS/className changes
- **Error propagation:** No error paths affected
- **State lifecycle risks:** None — no state changes
- **API surface parity:** ActivityBar props interface is unchanged
- **Integration coverage:** react-resizable-panels layout is not modified; the shadow is on inner content divs, not on Panel components
- **Unchanged invariants:** All file operations, context menus, drag-and-drop, panel toggling, and keyboard shortcuts are untouched

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Shadow invisible in dark theme (dark-on-dark) | Verify during Unit 4 implementation; increase `rgba` alpha if needed (try up to `0.15`) |
| `rounded-md mx-1` on file tree rows causes horizontal overflow or clipping | Test with long filenames; adjust `mx-1` to `mx-0.5` if clipping occurs |
| Removing the h-[22px] workspace folder row breaks any test that targets it | No tests currently target this element; confirm with a grep before removing |
| ActivityBar `border-r border-border` too prominent in tinted theme | Check tinted `--color-border` value; adjust to `border-border/60` if too heavy |

## Sources & References

- Related code: `src/components/ui/ActivityBar.tsx`, `src/components/ui/FileExplorer.tsx`, `src/App.tsx:816-833`, `src/styles/theme.css`
- Design reference: user-provided screenshots (Affine/Notion-style sidebar with workspace nav)
