---
date: 2026-04-08
topic: database-view
---

# Notion-Style Database View

## Problem Frame

Quipu supports markdown, code, PDF, diagrams, and notebooks — but has no way to work with structured data as a first-class object. Users who manage tasks, inventories, reading lists, or any tabular data must use external tools (Notion, Airtable) or embed raw markdown tables (no types, no filtering, no views). A Notion-style database view would let users create, query, and interact with structured data without leaving the editor.

## Format: `.quipudb.jsonl`

A custom JSONL-based format with schema-first design:

- **Line 1**: Schema object defining the database name, column definitions (id, type, options), and view configurations
- **Lines 2+**: One JSON object per row, each with a unique `_id` and column values
- **Git-friendly**: human-readable, line-per-row diffs cleanly
- **Zero dependencies**: standard JSON parsing, no binary formats
- **Future collab**: CRDT-friendly (each line is an independent unit)

```
{"_schema": {"name": "Tasks", "columns": [{"id": "title", "type": "text"}, {"id": "status", "type": "select", "options": ["Todo","In Progress","Done"]}, {"id": "due", "type": "date"}], "views": [...]}}
{"_id": "r1", "title": "Ship v1", "status": "Todo", "due": "2026-04-15"}
{"_id": "r2", "title": "Write docs", "status": "Done", "due": "2026-04-10"}
```

## Requirements

**Column Types (v1)**
- R1. Text — free-form string, inline editing
- R2. Number — numeric values, right-aligned display
- R3. Select — single value from a defined set of options, rendered as colored tag
- R4. Multi-select — multiple values from a defined set, rendered as colored tags
- R5. Date — date picker, displayed in locale format
- R6. Checkbox — boolean toggle

**Views**
- R7. Table view — rows and columns, resizable column widths, column reordering via drag
- R8. Board view (Kanban) — rows grouped as cards in swim lanes by a Select column. Drag cards between lanes to change the grouping value
- R9. View switching — toggle between Table and Board views for the same data. Each view preserves its own filter/sort configuration

**Filtering and Sorting**
- R10. Filter by any column — type-appropriate operators (text: contains/equals, number: >/</=, select: is/is not, date: before/after, checkbox: is checked/unchecked)
- R11. Multiple filters — combine with AND logic (OR is a future enhancement)
- R12. Sort by any column — ascending/descending, multi-column sort
- R13. Filters and sorts are persisted in the schema (per view)

**Row Operations**
- R14. Add new row — appends to the JSONL file with a generated `_id`
- R15. Edit cells inline — click to edit, type-appropriate input (text input, number input, select dropdown, date picker, checkbox toggle)
- R16. Delete row — with confirmation, removes the line from the JSONL file
- R17. Row reordering via drag-and-drop (in table view)

**Column Management**
- R18. Add column — choose type, set name, configure options (for select/multi-select)
- R19. Remove column — with confirmation, removes from schema and all rows
- R20. Rename column — updates schema, data rows keep the column id as key
- R21. Change column type — with best-effort value conversion (e.g., text "42" -> number 42)
- R22. Reorder columns via drag

**File Integration**
- R23. `.quipudb.jsonl` files open as a full-page database view (via extension registry pattern)
- R24. New database creation — "New Database" option in file creation, generates the file with schema + empty rows
- R25. Save on edit — changes write back to the `.quipudb.jsonl` file (debounced, like other editors)
- R26. Dirty state tracking — unsaved changes show the dot indicator in the tab, Ctrl+S force-saves

**Future (explicitly out of v1 scope)**
- Inline rendering in markdown (embed database view inside `.md` files via link)
- Relations between databases (link rows across `.quipudb.jsonl` files)
- Rollup columns (aggregations over related data)
- Formula columns
- Calendar and Timeline views
- Live collaboration / multi-user editing
- Import from CSV/Excel into `.quipudb.jsonl`

## Success Criteria

- A user can create a `.quipudb.jsonl` file, define columns, add rows, filter/sort, and switch between table and board views — all without leaving Quipu
- The file is human-readable in a text editor and diffs cleanly in git
- The database view follows the same extension/viewer pattern as PDF, Excalidraw, etc.
- Performance is acceptable for databases up to 10,000 rows

## Scope Boundaries

- No SQL engine — filtering, sorting, and grouping happen in-memory in JavaScript
- No binary formats — `.quipudb.jsonl` is the only format
- No import/export from other formats in v1 (CSV import is a natural v2 feature)
- No real-time collaboration in v1
- No inline markdown embedding in v1 — databases open as standalone pages
- No relations, rollups, or formulas in v1
- Column IDs are stable snake_case identifiers (separate from display names) to make the format durable across renames

## Key Decisions

- **JSONL over SQLite**: Git-friendly, human-readable, zero-dependency, CRDT-friendly for future collab. In-memory JS filtering is fast enough for <100K rows. SQLite would give SQL power but at the cost of binary diffs and heavier infrastructure.
- **Schema-first line**: The first line of the JSONL defines the database structure. This keeps the format self-describing — no sidecar files needed.
- **Custom extension `.quipudb.jsonl`**: Distinguishes database files from generic JSONL. Allows clean file type detection and viewer routing.
- **Table + Board for v1**: Table is the baseline. Board (Kanban) adds high value for task management with modest extra complexity (it's a groupBy + card layout on the same data).
- **Column IDs separate from display names**: `{"id": "due_date", "name": "Due Date", "type": "date"}` — IDs are stable across renames, making the format more durable.

## Outstanding Questions

### Deferred to Planning
- [Affects R7][Technical] Best React table library for the table view (TanStack Table, AG Grid community, or hand-rolled)
- [Affects R8][Technical] Board view implementation — existing Kanban library or custom flex/grid layout
- [Affects R25][Technical] Debounce strategy for writes — write the entire file on each change, or maintain a write buffer with line-level patches
- [Affects R5][Technical] Date picker component — use an existing shadcn/Radix date picker or build with native input[type=date]
- [Affects R3, R4][Technical] Select/multi-select dropdown — use shadcn Popover + Command (cmdk) or a custom dropdown

## Next Steps

-> `/ce:plan` for structured implementation planning
