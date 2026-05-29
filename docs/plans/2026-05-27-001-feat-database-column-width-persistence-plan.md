---
title: "feat: persist database column widths + smarter per-type defaults"
type: feat
status: planned
date: 2026-05-27
---

# Persist database column widths + smarter per-type defaults

## Problem

A `.quipudb.jsonl` table view today gives every column the same 180px default. The drag-resize handle in the column header works, but the new width lives only in TanStack's internal state — it survives tab switches but resets on reload. The schema already declares `columnWidths: Record<string, number>` on each view (see `project/Tasks.quipudb.jsonl` line 1: `"columnWidths":{}`), but no code reads or writes it.

So: defaults are bad, drag works in-session, persistence is broken.

## Approach

Three small surgical changes:

1. **Per-type default sizing in `useColumnDefs.ts`.** Replace the blanket `size: 180` with a `defaultSizeForType(col.type)` lookup. Suggested values: `checkbox` 60, `number` 100, `date` 140, `select` 160, `text`/`link` 240, `multi-select` 200. `minSize` stays 80, but text columns should accept `maxSize` ~ 800 (current 500 caps the user's drag well before the screenshot width they actually want).

2. **Wire `columnWidths` end-to-end in `TableView.tsx`.**
   - Read `activeView.columnWidths` (passed in via the `view` prop) and seed a TanStack `columnSizing` state from it.
   - Make the table controlled: `state: { columnSizing, ... }` + `onColumnSizingChange`.
   - On change, call `updateViewConfig(activeView.id, { columnWidths: nextSizing })`. The existing 2s debounce on `emitViewChange` in `useDatabase.ts` already serializes back to disk — no new IO path needed.

3. **Resolution order, in `useColumnDefs.ts`.** Saved width (from `columnWidths[col.id]`) wins. If absent → per-type default. Pass the view's `columnWidths` map in as a second argument.

## Files touched

- `src/extensions/database-viewer/hooks/useColumnDefs.ts` — accept `columnWidths` arg; per-type default lookup.
- `src/extensions/database-viewer/components/TableView.tsx` — controlled `columnSizing`, `onColumnSizingChange` → `updateViewConfig`.
- `src/extensions/database-viewer/DatabaseViewer.tsx` (or wherever `useColumnDefs` is called) — thread the active view's `columnWidths` into the hook.
- `src/extensions/database-viewer/hooks/useDatabase.ts` — `updateViewConfig` already exists; verify partial-merge semantics with `columnWidths`. No new function needed.
- `src/extensions/database-viewer/types.ts` — `columnWidths` already on `DatabaseView`; no schema change.

## Out of scope

- Board view widths (separate task — board cards have no column-width concept yet).
- Inline / chat-mode rendering. They reuse `TableView` with `outerPaddingInline: 0`; saved widths should still apply, but no new affordance there.
- Auto-fit-to-content (double-click handle to autosize) — future polish.
- Literal `\n` line-break insertion in text cells. The task is mistitled in `Tasks.quipudb.jsonl`; this plan only addresses width.

## Test plan

- Open `project/Tasks.quipudb.jsonl`, drag the Name column wider, switch to another tab and back → width preserved.
- Close and relaunch Quipu → width still preserved (round-trips through the file).
- Inspect line 1 of `Tasks.quipudb.jsonl` after the drag: `columnWidths` reflects the new size.
- Create a brand-new database → text columns default to 240px, number to 100px, checkbox to 60px.
- `npx tsc --noEmit` clean on the touched files; `npm run test:run` green.
