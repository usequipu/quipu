---
title: "feat: Notion-style database view for .quipudb.jsonl files"
type: feat
status: active
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-database-view-requirements.md
---

# Notion-Style Database View

## Overview

Add a new viewer extension for `.quipudb.jsonl` files that provides a Notion-style database experience: typed columns, inline cell editing, filtering, sorting, table view, and board (Kanban) view. The format is a self-describing JSONL file with schema-first-line, designed for git-friendliness and future CRDT collaboration.

## Problem Frame

Quipu supports markdown, code, PDF, diagrams, and notebooks — but has no way to work with structured data. Users managing tasks, inventories, or any tabular data must leave the editor. A database view lets users create, query, and interact with structured data as a first-class file type. (see origin: `docs/brainstorms/2026-04-08-database-view-requirements.md`)

## Requirements Trace

- R1-R6. Six column types: Text, Number, Select, Multi-select, Date, Checkbox
- R7. Table view with resizable, reorderable columns
- R8. Board (Kanban) view grouped by Select column, drag cards between lanes
- R9. View switching with per-view filter/sort state
- R10-R12. Type-aware filtering (AND logic) and multi-column sorting
- R13. Filters/sorts persisted in schema per view
- R14-R17. Row CRUD: add, inline edit, delete, reorder via drag
- R18-R22. Column management: add, remove, rename, change type, reorder via drag
- R23. Extension registry integration (`.quipudb.jsonl` opens as database view)
- R24. New database creation from file explorer
- R25-R26. Debounced save + dirty state tracking

## Scope Boundaries

- Inline markdown embedding: a static HTML placeholder (`EmbeddedDatabase.ts`) already exists and will be upgraded in this plan to mount the shared React component
- No relations, rollups, or formulas (v2)
- No import/export from CSV/Excel (v2)
- No real-time collaboration (v2)
- No SQL engine — JS in-memory filtering/sorting
- No Calendar or Timeline views

## Context & Research

### Relevant Code and Patterns

- `src/extensions/excalidraw-viewer/` — best reference for editable JSON-based viewer with debounced save and `isInitializedRef` pattern
- `src/extensions/notebook/` — best reference for complex viewer with toolbar, sub-components, and internal state
- `src/extensions/registry.ts` — `registerExtension()`, `resolveViewer()`, `getExtensionForTab()`
- `src/types/extensions.ts` — `ExtensionDescriptor` interface with `onSave`, `commands`
- `src/utils/fileTypes.ts` — file type detection functions
- `src/context/TabContext.tsx` — save flow reads `tab.content` for non-TipTap viewers
- `src/context/FileSystemContext.tsx` — `createNewFile()` for new database creation
- Radix primitives available: Select, Popover, DropdownMenu, ContextMenu, Dialog, Checkbox, Tabs, ScrollArea
- shadcn/ui: Button, Input, Badge (for select tags)
- cmdk already installed (for searchable select dropdowns)
- `src/components/editor/extensions/EmbeddedDatabase.ts` — existing inline node view (renders static HTML table preview via vanilla DOM); to be upgraded to mount the shared React component

### Institutional Learnings

- **Extension registry contract** (`docs/EXTENSIONS.md`): canHandle + priority + component. No App.tsx changes needed.
- **Non-TipTap save path**: `onContentChange(serializedString)` stores content on tab. `onSave` reads `tab.content` back.
- **False dirty state**: Use `isInitializedRef` pattern to skip first onChange during data load.
- **Binary/non-text guard**: Skip `readFile` for binary types. For JSONL, normal text read is fine.
- **File watcher**: Existing watcher in TabContext handles `.quipudb.jsonl` automatically. Viewer should handle content prop changes (re-parse).

### External References

- TanStack Table v8 — headless React table, zero CSS, dynamic column definitions from schema
- TanStack Virtual — row virtualization for 10K+ rows
- @dnd-kit — drag-and-drop for Kanban cards and table row/column reordering
- react-day-picker + date-fns — date picker for Date column type
- shadcn Combobox pattern (Radix Popover + cmdk) — for Select/Multi-select dropdowns

## Key Technical Decisions

- **TanStack Table over AG Grid or hand-rolling**: Headless = full Tailwind/theme control. AG Grid fights the design system. Hand-rolling reimplements TanStack poorly. TanStack handles sorting, filtering, column sizing, and column ordering natively. (see origin: Deferred to Planning question)
- **@dnd-kit over react-beautiful-dnd**: rbd is deprecated and incompatible with React 19. @dnd-kit is actively maintained, accessible, and handles both sortable lists (table rows) and multi-container drag (Kanban lanes).
- **Full file rewrite on save (debounced)**: Append-only breaks for deletes and reorders. 10K rows ~5MB serializes in <50ms. Differentiated debounce: 500ms for data edits, 2s for view config changes (sort/filter/column resize).
- **Schema version field from day 1**: `{"_schema": {"version": 1, ...}}` — zero cost now, prevents painful migrations later.
- **Column IDs separate from display names**: `{"id": "due_date", "name": "Due Date", "type": "date"}` — IDs are stable across renames, data rows use IDs as keys.
- **No new Tab boolean flags**: `canHandle()` in the extension descriptor checks `.quipudb.jsonl` extension. No `isDatabase` flag on Tab.
- **Lazy-load all new dependencies**: Database viewer bundle (TanStack + @dnd-kit + react-day-picker) behind dynamic import, zero impact on startup.
- **Date picker**: shadcn pattern (react-day-picker + Radix Popover). Matches design system. Native `input[type=date]` is unstyled and looks out of place.
- **Select/Multi-select dropdown**: shadcn Combobox (Radix Popover + cmdk) for searchable option lists with colored badges. Reuses existing cmdk dependency.
- **Full-bleed layout in both contexts**: The standalone viewer root uses `w-full h-full flex flex-col` with no max-width — it fills the editor panel completely, unlike the TipTap document page which centers at 816px. The inline node wrapper in `EmbeddedDatabase.ts` must also escape TipTap's page width via CSS negative margins (e.g., `-mx-[var(--doc-margin)]` or viewport-relative calc) so the embedded table spans the full editing container.
- **Shared React component for inline and standalone**: `EmbeddedDatabase.ts`'s `addNodeView()` will mount `DatabaseViewer` (or a shared `DatabaseTable` sub-component) via `ReactDOM.createRoot()` on the node's DOM container, with a `mode="inline"` prop for compact behavior (constrained height, scroll, read-only or limited editing). Avoids two renderer implementations diverging. Cleanup uses the root's `unmount()` in the node view's `destroy()` callback.

## Open Questions

### Resolved During Planning

- **Table library**: TanStack Table v8 — headless, zero CSS, TypeScript-first, virtual scrolling via companion library.
- **Kanban DnD**: @dnd-kit — React 19 compatible, handles multi-container drag.
- **Date picker**: react-day-picker + Radix Popover (shadcn pattern).
- **Select dropdown**: Radix Popover + cmdk (shadcn Combobox pattern).
- **Write strategy**: Full rewrite, debounced. No append-only or line-patching.

### Deferred to Implementation

- **Exact debounce timing**: 500ms for data, 2s for view config is the starting point. May adjust based on UX feel.
- **Color palette for Select options**: How many colors, which ones, whether user can pick or auto-assigned. Start with 8 predefined Tailwind colors.
- **Empty state UX**: Exact copy and layout when opening a new/empty `.quipudb.jsonl` file.
- **Column type conversion edge cases**: What happens when converting multi-select to text, or date to number. Best-effort with fallback to string representation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
graph TD
    subgraph Extension
        REG[registry.ts] -->|canHandle .quipudb.jsonl| DB[DatabaseViewer.tsx]
    end

    subgraph DatabaseViewer
        DB --> HOOK[useDatabase hook]
        HOOK -->|schema + rows| TV[TableView]
        HOOK -->|schema + rows| BV[BoardView]
        DB --> TB[Toolbar: view switch, filter, sort, add row/col]
    end

    subgraph TableView
        TV --> TT[TanStack Table]
        TT --> CELLS[Cell renderers: Text, Number, Select, Date, Checkbox]
        TT --> VR[TanStack Virtual rows]
        TT --> DND1[@dnd-kit column/row reorder]
    end

    subgraph BoardView
        BV --> LANES[Swim lanes by Select column]
        LANES --> CARDS[Row cards]
        CARDS --> DND2[@dnd-kit card drag between lanes]
    end

    HOOK -->|onContentChange| TAB[Tab content / save]
    TAB -->|serialize JSONL| FILE[.quipudb.jsonl]
```

### File Format Shape

```
Line 1: {"_schema": {"version": 1, "name": "Tasks", "columns": [...], "views": [{"id": "v1", "type": "table", "filters": [], "sorts": [], "columnWidths": {}}]}}
Line 2+: {"_id": "abc123", "title": "Ship v1", "status": "Todo", "due": "2026-04-15"}
```

## Implementation Units

### Phase 1: Foundation (format + extension shell)

- [ ] **Unit 1: JSONL format types, parser, and serializer**

  **Goal:** Define the `.quipudb.jsonl` format types and implement parse/serialize utilities.

  **Requirements:** R1-R6 (column type definitions), R13 (view config in schema), R25 (serialization for save)

  **Dependencies:** None

  **Files:**
  - Create: `src/extensions/database-viewer/types.ts`
  - Create: `src/extensions/database-viewer/utils/jsonl.ts`
  - Create: `src/extensions/database-viewer/utils/id.ts`
  - Test: `src/__tests__/quipudb-format.test.ts`

  **Approach:**
  - Define interfaces: `DatabaseSchema`, `ColumnDef` (with discriminated union for type-specific config like select options), `DatabaseRow`, `ViewConfig`, `FilterDef`, `SortDef`
  - `parseQuipuDb(content: string): { schema: DatabaseSchema; rows: DatabaseRow[] }` — split on newlines, JSON.parse each, validate schema line has `_schema` key
  - `serializeQuipuDb(schema: DatabaseSchema, rows: DatabaseRow[]): string` — JSON.stringify each, join with newlines, trailing newline
  - `generateRowId(): string` — `crypto.randomUUID().slice(0, 8)`
  - `createEmptyDatabase(name: string): string` — returns serialized JSONL with schema + zero rows
  - Schema version field: `version: 1`

  **Patterns to follow:**
  - TipTap JSON serialization in `src/context/TabContext.tsx` (`.quipu` format handling)

  **Test scenarios:**
  - Happy path: Parse a valid 3-row JSONL string -> returns schema with correct column count and 3 typed rows
  - Happy path: Serialize schema + rows -> produces valid JSONL with trailing newline, parseable back to same data
  - Happy path: `createEmptyDatabase("Tasks")` -> valid JSONL with schema line, zero data lines
  - Edge case: Parse file with empty lines between rows -> skips empty lines gracefully
  - Edge case: Parse file with only schema line (no rows) -> returns empty rows array
  - Edge case: Parse empty string -> throws descriptive error
  - Edge case: Parse malformed JSON on a data line -> throws with line number in error message
  - Edge case: Row missing `_id` -> generates one during parse
  - Happy path: `generateRowId()` produces 8-char string, two calls produce different IDs

  **Verification:**
  - Parse -> serialize -> parse round-trip produces identical data
  - All test scenarios pass

- [ ] **Unit 2: Extension registration and viewer shell**

  **Goal:** Register the database viewer extension and create a minimal component that parses and displays the file name — proving the end-to-end wiring works.

  **Requirements:** R23 (extension registry integration)

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/extensions/database-viewer/index.ts`
  - Create: `src/extensions/database-viewer/DatabaseViewer.tsx`
  - Create: `src/utils/fileTypes.ts` (add `isQuipuDbFile`)
  - Modify: `src/extensions/index.ts` (register new extension)
  - Test: `src/__tests__/database-viewer-registration.test.ts`

  **Approach:**
  - Extension descriptor: `{ id: 'database-viewer', canHandle: (tab) => tab.name.endsWith('.quipudb.jsonl'), priority: 10, component: DatabaseViewer }`
  - `DatabaseViewer` shell: parse content, show database name and row count. Wire up `onContentChange` with `isInitializedRef` pattern.
  - DatabaseViewer root element: `w-full h-full flex flex-col overflow-hidden` — no max-width, no centered page layout. Fills the editor panel completely in standalone mode.
  - Add `isQuipuDbFile(name: string)` to `src/utils/fileTypes.ts`
  - Lazy-load the viewer component in the extension descriptor using `React.lazy()`

  **Patterns to follow:**
  - `src/extensions/excalidraw-viewer/index.ts` — descriptor with `onSave`
  - `src/extensions/excalidraw-viewer/ExcalidrawViewer.tsx` — `isInitializedRef` pattern

  **Test scenarios:**
  - Happy path: `isQuipuDbFile("tasks.quipudb.jsonl")` returns true
  - Happy path: `isQuipuDbFile("data.csv")` returns false
  - Happy path: Extension resolves for a tab with name ending in `.quipudb.jsonl`
  - Integration: Opening a `.quipudb.jsonl` file renders the DatabaseViewer instead of the text editor

  **Verification:**
  - Create a `.quipudb.jsonl` test file, open it in the app, see the database viewer shell render

- [ ] **Unit 3: useDatabase hook (core state management)**

  **Goal:** Create the central state management hook that all views consume. Handles CRUD operations and serialization back through `onContentChange`.

  **Requirements:** R14-R16 (row CRUD), R18-R22 (column management), R25-R26 (save + dirty state)

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/extensions/database-viewer/hooks/useDatabase.ts`
  - Test: `src/__tests__/useDatabase.test.ts`

  **Approach:**
  - Input: `content: string | null`, `onContentChange: (content: string) => void`
  - State: `schema` (DatabaseSchema), `rows` (DatabaseRow[]), parsed from content on mount/change
  - Exposes: `addRow()`, `updateCell(rowId, columnId, value)`, `deleteRow(rowId)`, `reorderRows(fromIndex, toIndex)`, `addColumn(colDef)`, `removeColumn(columnId)`, `renameColumn(columnId, newName)`, `changeColumnType(columnId, newType)`, `reorderColumns(newOrder)`, `updateViewConfig(viewId, config)`
  - Every mutation updates in-memory state, then calls `onContentChange(serializeQuipuDb(schema, rows))` debounced (500ms for data, 2s for view config)
  - `isInitializedRef` prevents dirty state on initial parse
  - Handle content prop changes (file watcher reloaded content) — re-parse only if content changed

  **Patterns to follow:**
  - ExcalidrawViewer's `isInitializedRef` + debounced onChange pattern

  **Test scenarios:**
  - Happy path: Initialize with valid JSONL -> schema and rows available
  - Happy path: `addRow()` -> new row with generated `_id` and null values for each column
  - Happy path: `updateCell("r1", "title", "New Title")` -> row updated, onContentChange called with serialized JSONL
  - Happy path: `deleteRow("r1")` -> row removed from rows array
  - Happy path: `addColumn({ id: "priority", name: "Priority", type: "number" })` -> column added to schema, all rows get null for that column
  - Happy path: `removeColumn("status")` -> column removed from schema, key removed from all rows
  - Happy path: `renameColumn("status", "State")` -> schema name updated, row data unchanged (uses stable ID)
  - Edge case: `changeColumnType("due", "text")` -> date values converted to string representation
  - Edge case: Initialize with empty/null content -> empty schema with default name, zero rows
  - Edge case: Content prop changes after initialization -> re-parses (file watcher reload)
  - Integration: Mutation -> debounced onContentChange -> serialized JSONL matches expected format

  **Verification:**
  - All CRUD operations produce correct serialized output
  - Debouncing prevents excessive onContentChange calls

### Phase 2: Table View

- [ ] **Unit 4: Table view with TanStack Table**

  **Goal:** Render the database as an interactive table with typed cell renderers, column resizing, and sorting.

  **Requirements:** R1-R6 (column types), R7 (table view), R10-R12 (filter/sort)

  **Dependencies:** Unit 2, Unit 3

  **Files:**
  - Create: `src/extensions/database-viewer/components/TableView.tsx`
  - Create: `src/extensions/database-viewer/hooks/useColumnDefs.ts`
  - Modify: `src/extensions/database-viewer/DatabaseViewer.tsx` (render TableView)
  - Modify: `package.json` (add `@tanstack/react-table`, `@tanstack/react-virtual`)

  **Approach:**
  - `useColumnDefs(schema)` generates TanStack `ColumnDef[]` from the database schema, routing each column type to its display renderer
  - TanStack Table with `enableColumnResizing`, `enableSorting`, `enableColumnFilters`
  - TanStack Virtual for row virtualization (estimateSize 36px per row)
  - Column header: name + sort indicator + resize handle
  - Column widths persisted in view config via `updateViewConfig`
  - Use `table.options.meta` to pass `updateCell` down to cell renderers

  **Patterns to follow:**
  - Toolbar pattern from NotebookViewer: `shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border`
  - Theme tokens: `bg-bg-surface`, `border-border`, `text-text-primary`

  **Test scenarios:**
  - Happy path: Render 5-column, 10-row database -> all cells display with correct type formatting (text as string, number right-aligned, select as colored badge, date formatted, checkbox as toggle)
  - Happy path: Click column header -> rows sort ascending, click again -> descending, click again -> unsorted
  - Happy path: Resize column by dragging header border -> column width updates, persisted in view config
  - Edge case: Empty database (0 rows) -> shows "No rows" message + "Add row" button
  - Edge case: Null cell values -> display as empty/placeholder, not "null" text
  - Edge case: Very long text in cell -> truncated with ellipsis, full value on hover tooltip

  **Verification:**
  - Table renders with all 6 column types displaying correctly
  - Sorting works on all column types
  - Column resizing persists across view switches

- [ ] **Unit 5: Inline cell editing**

  **Goal:** Click any cell to edit it with a type-appropriate input.

  **Requirements:** R15 (inline editing), R1-R6 (type-appropriate inputs)

  **Dependencies:** Unit 4

  **Files:**
  - Create: `src/extensions/database-viewer/components/cells/TextCell.tsx`
  - Create: `src/extensions/database-viewer/components/cells/NumberCell.tsx`
  - Create: `src/extensions/database-viewer/components/cells/SelectCell.tsx`
  - Create: `src/extensions/database-viewer/components/cells/MultiSelectCell.tsx`
  - Create: `src/extensions/database-viewer/components/cells/DateCell.tsx`
  - Create: `src/extensions/database-viewer/components/cells/CheckboxCell.tsx`
  - Modify: `package.json` (add `react-day-picker`, `date-fns`)

  **Approach:**
  - Each cell has display mode and edit mode, toggled by click (except Checkbox which toggles directly)
  - TextCell: click -> `<input>`, commit on Enter/blur, cancel on Escape
  - NumberCell: click -> `<input type="number">`, same commit/cancel
  - SelectCell: click -> Radix Popover + cmdk Command list with colored option badges
  - MultiSelectCell: click -> Popover + cmdk with checkboxes for each option, dismiss to commit
  - DateCell: click -> Radix Popover + react-day-picker Calendar
  - CheckboxCell: direct toggle on click (no edit mode needed)
  - All edits call `updateCell(rowId, columnId, newValue)` from useDatabase hook

  **Patterns to follow:**
  - shadcn Combobox pattern for Select dropdowns (Radix Popover + cmdk)
  - Badge component for select tags: `src/components/ui/badge.tsx`

  **Test scenarios:**
  - Happy path: Click text cell -> input appears with current value, type new value, press Enter -> cell updates
  - Happy path: Click select cell -> dropdown opens with all options as colored badges, click option -> cell updates
  - Happy path: Click date cell -> calendar popover opens, click date -> cell updates with formatted date
  - Happy path: Click checkbox cell -> toggles between checked/unchecked immediately
  - Happy path: Press Escape while editing text cell -> reverts to original value
  - Edge case: Click outside while editing -> commits current value (blur behavior)
  - Edge case: Tab key in text cell -> commits and moves to next cell (if feasible)
  - Edge case: Empty multi-select -> shows placeholder text "Select options..."

  **Verification:**
  - All 6 cell types are editable with type-appropriate inputs
  - Edits propagate through useDatabase to onContentChange

- [ ] **Unit 6: Filtering and sorting UI**

  **Goal:** Add filter bar and sort controls that let users query their database.

  **Requirements:** R10-R13 (filtering, sorting, persistence)

  **Dependencies:** Unit 4

  **Files:**
  - Create: `src/extensions/database-viewer/components/FilterBar.tsx`
  - Create: `src/extensions/database-viewer/hooks/useDatabaseFilters.ts`
  - Modify: `src/extensions/database-viewer/components/TableView.tsx` (integrate filters)
  - Modify: `src/extensions/database-viewer/DatabaseViewer.tsx` (toolbar filter/sort buttons)

  **Approach:**
  - Filter bar: button opens a Radix Popover with add-filter form (column picker + operator + value)
  - Operators vary by type: text (contains, equals, is empty), number (=, !=, >, <, >=, <=), select (is, is not), date (before, after, is), checkbox (is checked, is unchecked)
  - Multiple filters combined with AND
  - Sort: column header click for quick sort, sort button in toolbar for multi-column sort config
  - Active filter count shown on filter button badge
  - Filters and sorts serialized into the active view's config in schema

  **Patterns to follow:**
  - Radix Popover for filter configuration panel

  **Test scenarios:**
  - Happy path: Add text filter "title contains ship" -> only matching rows shown
  - Happy path: Add number filter "amount > 100" -> filters correctly
  - Happy path: Add select filter "status is Done" -> only "Done" rows
  - Happy path: Add date filter "due before 2026-05-01" -> only earlier dates
  - Happy path: Add checkbox filter "completed is checked" -> only checked rows
  - Happy path: Multiple filters -> AND combination, only rows matching all filters
  - Happy path: Remove a filter -> rows re-expand
  - Happy path: Multi-column sort -> primary sort applied first, secondary breaks ties
  - Edge case: Filter on column with null values -> null values excluded by all operators except "is empty"
  - Integration: Filter state persisted in view config -> reopen file, filters still active

  **Verification:**
  - All operator types work correctly
  - Filter/sort state survives file close/reopen

- [ ] **Unit 7: Inline embedding upgrade and full-bleed layout**

  **Goal:** Replace `EmbeddedDatabase.ts`'s static HTML table with the shared React `DatabaseViewer` component, and ensure the inline block escapes TipTap's document width to fill the editing container.

  **Requirements:** R23 (extension registry integration — inline is a second entry point for the same viewer)

  **Dependencies:** Unit 4, Unit 5 (shared component must include table + cell renderers)

  **Files:**
  - Modify: `src/components/editor/extensions/EmbeddedDatabase.ts`
  - Modify: `src/styles/prosemirror.css` (full-bleed CSS for `.embedded-database-wrapper`)
  - Test: `src/__tests__/embedded-database.test.ts`

  **Approach:**
  - Remove the `loadDatabase` HTML-builder function and the manual DOM table construction
  - In `addNodeView()`, call `ReactDOM.createRoot(tableContainer)` and render `<DatabaseViewer content={...} onContentChange={...} mode="inline" />` (or a shared sub-component extracted from `DatabaseViewer`)
  - Add a `mode` prop to `DatabaseViewer`: `'standalone'` (default, full-height, full editing) | `'inline'` (max-height ~320px, overflow-y scroll, read-only or limited editing)
  - Implement `destroy()` on the node view to call `root.unmount()` and prevent React tree leaks
  - Full-bleed CSS in `prosemirror.css`: `.embedded-database-wrapper` uses `width: 100vw; margin-left: calc(-50vw + 50%);` pattern (or equivalent calc based on the TipTap page width token) to break out of the 816px page constraint
  - The node view reads the database file via `fs.readFile` and passes content to the React component; mutations call `fs.writeFile` directly (inline mode writes back to disk, not through TabContext)

  **Patterns to follow:**
  - Existing `addNodeView()` in `EmbeddedDatabase.ts` (wrapper DOM structure to keep)
  - `ReactDOM.createRoot` + `unmount()` pattern (same as any React-in-DOM-node pattern)
  - `src/extensions/excalidraw-viewer/ExcalidrawViewer.tsx` for `isInitializedRef` pattern to reuse in inline mode

  **Test scenarios:**
  - Happy path: Embed `![[tasks.quipudb.jsonl]]` in a markdown file -> inline block renders table rows using React DatabaseViewer component (not raw HTML)
  - Happy path: Inline block width matches the full editing container width, not the 816px document text column
  - Happy path: Edit a cell inline -> value updates in the `.quipudb.jsonl` file on disk
  - Happy path: Click the database header -> fires `quipu:open-embedded-database` event, opens full standalone view
  - Edge case: Unmount node (delete block from markdown) -> React root unmounts without console errors
  - Edge case: Database file not found -> shows "Could not load [name]" fallback (same as before)
  - Integration: Same `.quipudb.jsonl` open in a tab (standalone) and embedded inline -> both reflect the same on-disk data after a save

  **Verification:**
  - Inline block visually matches the standalone viewer's table layout
  - No layout constraint to 816px — inline block spans full editing area width
  - React tree cleans up correctly on node removal

### Phase 3: Board View, Column Management + Inline Upgrade

- [ ] **Unit 8: Board (Kanban) view**

  **Goal:** Add a Kanban board view that groups rows into swim lanes by a Select column.

  **Requirements:** R8 (board view), R9 (view switching)

  **Dependencies:** Unit 4, Unit 5

  **Files:**
  - Create: `src/extensions/database-viewer/components/BoardView.tsx`
  - Create: `src/extensions/database-viewer/components/BoardCard.tsx`
  - Modify: `src/extensions/database-viewer/DatabaseViewer.tsx` (view switcher using Radix Tabs)
  - Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)

  **Approach:**
  - View switcher: Radix Tabs in the toolbar (Table | Board)
  - Board view: group rows by the first Select column (user can pick which column via dropdown)
  - Each lane = one Select option value, rendered as a vertical column
  - Cards show: first text column as title, other columns as secondary info (badges for select, formatted dates)
  - Drag cards between lanes with @dnd-kit: `DndContext` + `SortableContext` per lane
  - Dragging a card from "Todo" to "Done" = `updateCell(rowId, statusColumnId, "Done")`
  - Lane for rows with null/empty grouping value labeled "No [column name]"
  - Per-view filter/sort state: switching views doesn't lose filter config

  **Patterns to follow:**
  - @dnd-kit sortable pattern with multiple containers
  - Badge component for select value lane headers

  **Test scenarios:**
  - Happy path: Switch to board view -> rows grouped into lanes by select column values
  - Happy path: Drag card from "Todo" lane to "Done" lane -> card moves, row's status updated to "Done"
  - Happy path: Switch back to table view -> row shows updated status value
  - Happy path: Switch grouping column -> lanes reorganize by new column's options
  - Edge case: Rows with null grouping value -> appear in "Uncategorized" lane
  - Edge case: Select column with unused options -> empty lanes still shown (with "No items" text)
  - Edge case: No select columns in schema -> board view disabled, shows message

  **Verification:**
  - View switching preserves data and per-view filter state
  - Dragging cards correctly updates the underlying data

- [ ] **Unit 9: Column management + row operations**

  **Goal:** Add column add/remove/rename/reorder/type-change and row add/delete/reorder.

  **Requirements:** R14 (add row), R16-R17 (delete/reorder row), R18-R22 (column management)

  **Dependencies:** Unit 4, Unit 5

  **Files:**
  - Modify: `src/extensions/database-viewer/components/TableView.tsx` (column header dropdown, add column button, add row button)
  - Create: `src/extensions/database-viewer/components/ColumnManager.tsx`
  - Modify: `src/extensions/database-viewer/DatabaseViewer.tsx` (row context menu)

  **Approach:**
  - "+" button after last column header -> opens add-column dialog (name, type, options for select types)
  - Column header right-click or dropdown -> rename, change type, delete (with confirmation dialog)
  - Column reorder: @dnd-kit on header row (horizontal sortable)
  - "+" row at bottom of table -> appends empty row
  - Row right-click context menu -> delete row (with confirmation), duplicate row
  - Row drag handle on left edge -> @dnd-kit vertical sortable for reordering
  - Type change: best-effort conversion (number "42" -> text "42", text "42" -> number 42, date "2026-04-08" -> text "2026-04-08", everything else -> string representation)

  **Patterns to follow:**
  - Radix Dialog for confirmation prompts
  - Radix DropdownMenu for column header actions
  - @dnd-kit sortable for both horizontal (columns) and vertical (rows)

  **Test scenarios:**
  - Happy path: Click "+" column -> dialog opens, enter name "Priority" + type "number" -> column appears, all rows get null for it
  - Happy path: Right-click column header -> "Delete column" -> confirmation -> column removed from schema and all rows
  - Happy path: Rename column "Status" to "State" -> header updates, data rows unchanged (stable ID)
  - Happy path: Change column type from "text" to "number" -> values "42" become 42, non-numeric become null
  - Happy path: Drag column header to reorder -> column order updates in schema
  - Happy path: Click "+" row -> empty row appended with generated ID
  - Happy path: Right-click row -> "Delete" -> row removed
  - Happy path: Drag row handle to reorder -> rows reorder in data
  - Edge case: Delete last column -> database has zero columns, shows "Add a column to get started"
  - Edge case: Delete column that board view groups by -> board view falls back to first available select column

  **Verification:**
  - All column management operations produce valid schema
  - Type conversion handles all 6×6 type pairs gracefully (no crashes)

### Phase 4: New Database Creation + Polish

- [ ] **Unit 10: New database creation and empty state**

  **Goal:** Let users create new `.quipudb.jsonl` files from the file explorer, with a welcoming empty state.

  **Requirements:** R24 (new database creation)

  **Dependencies:** Unit 2, Unit 3

  **Files:**
  - Modify: `src/components/ui/FileExplorer.tsx` (add "New Database" to context menu)
  - Modify: `src/context/FileSystemContext.tsx` (handle `.quipudb.jsonl` creation with initial schema)
  - Modify: `src/extensions/database-viewer/DatabaseViewer.tsx` (empty state UI)

  **Approach:**
  - File explorer right-click context menu gains "New Database" option (alongside "New File" and "New Folder")
  - Creates file with default name `untitled.quipudb.jsonl` containing schema line only
  - Empty state: centered card with database icon, "Add your first column" button, and "Add your first row" button
  - When first column is added, auto-focus the column name input

  **Patterns to follow:**
  - Existing "New File" / "New Folder" flow in FileExplorer

  **Test scenarios:**
  - Happy path: Right-click folder -> "New Database" -> inline rename input appears with `.quipudb.jsonl` extension -> submit -> file created, opens in database viewer
  - Happy path: Open empty `.quipudb.jsonl` -> empty state with add column/row buttons
  - Edge case: Create database in read-only directory -> error toast

  **Verification:**
  - New database files open correctly in the viewer
  - Empty state is helpful and non-confusing

## System-Wide Impact

- **Interaction graph:** DatabaseViewer calls `onContentChange` (App.tsx prop) which triggers `updateTabContent` in TabContext. File watcher in TabContext detects external `.quipudb.jsonl` changes. FileExplorer context menu gains "New Database" option. `EmbeddedDatabase.ts` node view mounts a `DatabaseViewer` React root and writes mutations directly to disk via `fs.writeFile` (bypasses TabContext).
- **Error propagation:** Parse errors (malformed JSONL) shown via `showToast(message, 'error')`. Save errors handled by existing TabContext save flow.
- **State lifecycle risks:** Debounced writes mean a crash within the debounce window loses the last edit. Mitigation: 500ms debounce is short enough that data loss is minimal. The same risk exists for all debounced editors (Excalidraw, TipTap).
- **API surface parity:** No Go server changes needed — JSONL is plain text, existing `readFile`/`writeFile` work. No Electron IPC changes needed.
- **Integration coverage:** The full chain (open file -> parse -> edit cell -> serialize -> onContentChange -> saveFile -> disk write -> file watcher reload) must be tested end-to-end.
- **Unchanged invariants:** Editor (TipTap), terminal, all other viewers, extension registry API — all unchanged. New extension is purely additive.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| TanStack Table bundle size | Lazy-load behind `React.lazy()`. All new deps loaded only when `.quipudb.jsonl` is opened. |
| @dnd-kit + TanStack Table integration complexity | Unit 7 and 8 can be delivered after table view works. Board view is separable. |
| Large JSONL files (>10K rows) degrade UX | TanStack Virtual handles rendering. Parse time may grow — profile at 50K rows and add streaming parser if needed (v2). |
| Column type conversion data loss | Conversion is best-effort with fallback to null. Show confirmation dialog warning about potential data loss. |
| react-day-picker styling conflicts with Tailwind v4 | react-day-picker v9 ships unstyled — no CSS conflicts. Style with Tailwind classes. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-08-database-view-requirements.md](docs/brainstorms/2026-04-08-database-view-requirements.md)
- Extension registry: `src/extensions/registry.ts`, `docs/EXTENSIONS.md`
- ExcalidrawViewer (editable viewer pattern): `src/extensions/excalidraw-viewer/ExcalidrawViewer.tsx`
- NotebookViewer (complex viewer pattern): `src/extensions/notebook/NotebookViewer.tsx`
- TanStack Table docs: https://tanstack.com/table/v8
- @dnd-kit docs: https://dndkit.com
