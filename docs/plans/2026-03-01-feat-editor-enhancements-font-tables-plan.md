---
title: "feat: Editor Enhancements — Geist Font, Softer Syntax, Table Editing"
type: feat
status: active
date: 2026-03-01
---

# Editor Enhancements — Geist Font, Softer Syntax, Table Editing

## Overview

Four editor improvements bundled together: change the default editor font to Geist Sans, replace the current reveal-syntax decoration color with a softer blue underline, add a right-click context menu for table editing, and add a table creation button to the rich text toolbar.

## Problem Statement / Motivation

- **Font**: Clash Grotesk works but Geist Sans (by Vercel) offers better readability for long-form writing with its clean, modern proportions.
- **Syntax decorations**: The current `.reveal-syntax` decorations use `color: var(--color-accent)` (terracotta) which can feel harsh. A subtle blue underline would be less distracting in obsidian mode.
- **Tables**: The Table TipTap extension is loaded but there's no UI to insert tables or manipulate rows/columns once created.

## Proposed Solution

### 1. Change Editor Font to Geist Sans

**Load from Google Fonts** (user specified the URL: https://fonts.google.com/specimen/Geist)

#### src/index.css

```css
/* Update the Google Fonts @import to include Geist */
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

#### src/styles/theme.css

```css
/* Replace Clash Grotesk with Geist in --font-editor */
--font-editor: "Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

**Cleanup:**
- Remove the `@font-face` declarations for Clash Grotesk in `src/index.css` (lines 4-31)
- Delete the woff2 files from `public/fonts/` (ClashGrotesk-Regular.woff2, etc.)

### 2. Softer Syntax Decoration

Replace the terracotta accent color on `.reveal-syntax` with a subtle blue tone using the info color token at reduced opacity.

#### src/styles/theme.css

```css
/* Current: color: var(--color-accent); opacity: 0.45; */
/* New: subtle blue underline instead */
.reveal-syntax {
  color: var(--color-info);
  opacity: 0.3;
  font-family: var(--font-mono);
  font-size: 0.85em;
  user-select: none;
  text-decoration: underline;
  text-decoration-color: var(--color-info);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
```

This uses `--color-info` which adapts across themes:
- Light: `#0969da`
- Dark: `#58a6ff`
- Tinted: `#6899d9`

### 3. Table Context Menu (Right-Click)

When the user right-clicks inside a table cell, show a custom context menu with table operations. Outside tables, show the browser's native context menu.

**Operations (minimal set):**
- Add Row Above
- Add Row Below
- Add Column Left
- Add Column Right
- (separator)
- Delete Row
- Delete Column
- Delete Table

**Implementation pattern:** Follow the existing context menu pattern from `FileExplorer.jsx` (state-based `{ x, y }` positioning, click-outside dismissal).

#### Editor.jsx (context menu handler)

```jsx
const [tableContextMenu, setTableContextMenu] = useState(null);

const handleEditorContextMenu = useCallback((e) => {
  if (!editor) return;

  // Check if cursor is inside a table
  const { $from } = editor.state.selection;
  const isInTable = $from.node($from.depth).type.name === 'tableCell' ||
                    $from.node($from.depth).type.name === 'tableHeader' ||
                    editor.isActive('table');

  if (isInTable) {
    e.preventDefault();
    setTableContextMenu({ x: e.clientX, y: e.clientY });
  }
  // else: allow native context menu
}, [editor]);
```

#### Editor.jsx (context menu UI)

```jsx
{tableContextMenu && (
  <div
    className="fixed z-50 bg-bg-surface border border-border rounded-md shadow-lg py-1 min-w-[180px]"
    style={{ top: tableContextMenu.y, left: tableContextMenu.x }}
  >
    <ContextMenuItem
      label="Add Row Above"
      onClick={() => { editor.chain().focus().addRowBefore().run(); closeTableMenu(); }}
    />
    <ContextMenuItem
      label="Add Row Below"
      onClick={() => { editor.chain().focus().addRowAfter().run(); closeTableMenu(); }}
    />
    <ContextMenuItem
      label="Add Column Left"
      onClick={() => { editor.chain().focus().addColumnBefore().run(); closeTableMenu(); }}
    />
    <ContextMenuItem
      label="Add Column Right"
      onClick={() => { editor.chain().focus().addColumnAfter().run(); closeTableMenu(); }}
    />
    <div className="h-px bg-border mx-2 my-1" />
    <ContextMenuItem
      label="Delete Row"
      onClick={() => { editor.chain().focus().deleteRow().run(); closeTableMenu(); }}
    />
    <ContextMenuItem
      label="Delete Column"
      onClick={() => { editor.chain().focus().deleteColumn().run(); closeTableMenu(); }}
    />
    <ContextMenuItem
      label="Delete Table"
      className="text-error"
      onClick={() => { editor.chain().focus().deleteTable().run(); closeTableMenu(); }}
    />
  </div>
)}
```

### 4. Table Creation Toolbar Button

Add a table button to the rich text toolbar after the Code Block button, separated by a `ToolbarSeparator`.

- Icon: `Table` from `@phosphor-icons/react` (imported as `TableIcon`)
- Click inserts a 3x3 table with header row: `editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()`
- Disabled when cursor is already inside a table (prevents nested tables)

#### Editor.jsx (toolbar addition)

```jsx
<ToolbarSeparator />
<ToolbarButton
  onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
  isActive={editor.isActive('table')}
  title="Insert Table"
  disabled={editor.isActive('table')}
>
  <TableIcon size={16} />
</ToolbarButton>
```

## Technical Considerations

### Markdown Table Round-Trip
`tiptap-markdown` v0.9.0 must serialize tables to pipe-syntax markdown and parse them back. **This must be verified before shipping.** If serialization fails, table features should only be enabled for `.quipu` files.

Test: Insert a table, save as `.md`, reload, verify the table reconstructs with correct data.

### Context Menu Positioning
- Near viewport edges, the menu could overflow. Implement boundary detection: if `x + menuWidth > window.innerWidth`, flip to the left side.
- Dismiss on: click outside, Escape, scroll, another right-click.

### Font Weights
Geist Sans variable font supports 100-900. Load specific weights 400, 500, 600, 700 to match current usage:
- Body text: 400 (regular)
- Headings H3-H4: 500-600
- Headings H1-H2, display title: 700

### Context Menu in Both Modes
The context menu works in both richtext and obsidian modes since it's independent of the toolbar. Tables are editable in both modes.

### `--font-sans` Unchanged
Only `--font-editor` changes. The `--font-sans` variable (used for UI elements like sidebar, menus) keeps Inter.

## Acceptance Criteria

- [ ] Editor content renders in Geist Sans across all three themes
- [ ] Clash Grotesk font files removed from `/public/fonts/`
- [ ] Reveal-syntax decorations show a subtle blue underline instead of terracotta text
- [ ] Decorations are visible in obsidian mode, hidden in rich text mode (existing behavior)
- [ ] Right-click inside table shows custom context menu
- [ ] Right-click outside table shows native browser context menu
- [ ] All 8 table operations (add/delete row/column, delete table) work correctly
- [ ] Context menu dismisses on click outside, Escape, or scroll
- [ ] Table toolbar button visible in rich text toolbar
- [ ] Clicking table button inserts a 3x3 table with header row
- [ ] Table button disabled when cursor is already in a table
- [ ] Tables round-trip correctly through markdown save/load
- [ ] Tables save/load correctly in `.quipu` format

## Sources

- Font import: [src/index.css](src/index.css) — Google Fonts loading
- Theme tokens: [src/styles/theme.css](src/styles/theme.css) — `--font-editor`, `.reveal-syntax`, `--color-info`
- ProseMirror styles: [src/styles/prosemirror.css](src/styles/prosemirror.css) — table styles
- Editor: [src/components/Editor.jsx](src/components/Editor.jsx) — TipTap extensions, toolbar
- RevealMarkdown extension: [src/extensions/RevealMarkdown.js](src/extensions/RevealMarkdown.js)
- Context menu pattern: [src/components/FileExplorer.jsx](src/components/FileExplorer.jsx) — existing context menu implementation
- Solution doc: [docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md](docs/solutions/editor-patterns/tiptap-rich-text-toolbar-mode-toggle.md)
- Solution doc: [docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md](docs/solutions/ui-bugs/editor-font-command-palette-theme-toggle.md)
