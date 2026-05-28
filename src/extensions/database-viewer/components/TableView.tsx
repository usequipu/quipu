import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import type {
  ColumnSizingState,
  ColumnSizingInfoState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PlusIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useColumnDefs } from '../hooks/useColumnDefs';
import { ColumnHeaderMenu } from './ColumnManager';
import ColumnTypeIcon from './ColumnTypeIcon';
import type { DatabaseSchema, DatabaseRow, ColumnDef, ColumnType, SelectOption, ViewConfig } from '../types';

interface TableViewProps {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  addRow: () => void;
  deleteRow?: (rowId: string) => void;
  renameColumn?: (columnId: string, newName: string) => void;
  removeColumn?: (columnId: string) => void;
  changeColumnType?: (columnId: string, newType: ColumnType) => void;
  /** Toggle wrap-vs-clip per column. Omitted in chat / read-only mode. */
  setColumnWrap?: (columnId: string, wrap: boolean) => void;
  /** Append a new option to a select / multi-select column on the fly. */
  updateColumnOptions?: (columnId: string, options: SelectOption[]) => void;
  onAddColumn?: () => void;
  // Required for link cells to resolve sibling folders + workspace-relative
  // global paths. Optional so non-link tables work without plumbing.
  databaseFilePath?: string | null;
  workspacePath?: string | null;
  /**
   * When true, cells render display-only — no inline editors, no
   * checkbox toggles, no "+ Pick" affordance. The "+ New row" footer is
   * also hidden. Used by the chat block.
   */
  readOnly?: boolean;
  /** Horizontal padding for the scroll container — keep the standalone
   * viewer's --db-h-pad indent but flush the inline / chat modes. */
  outerPaddingInline?: string;
  /**
   * Active view config. Provides persisted `columnWidths` (seeds TanStack's
   * column-sizing state) and the view id used to persist new widths via
   * `updateViewConfig`. Both are optional so chat / preview surfaces that
   * don't own a view can still render the table with per-type defaults.
   */
  view?: ViewConfig;
  updateViewConfig?: (viewId: string, updates: Partial<ViewConfig>) => void;
}

const ROW_HEIGHT = 36;

const TableView: React.FC<TableViewProps> = ({
  schema,
  rows,
  updateCell,
  addRow,
  deleteRow,
  renameColumn,
  removeColumn,
  changeColumnType,
  setColumnWrap,
  updateColumnOptions,
  onAddColumn,
  databaseFilePath = null,
  workspacePath = null,
  readOnly = false,
  outerPaddingInline = 'var(--db-h-pad)',
  view,
  updateViewConfig,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const columns = useColumnDefs(schema);

  // Clamp every column width to its [minSize, maxSize] range. TanStack's
  // resize math allows storing sub-minSize values during drag (it does
  // `Math.max(headerSize + delta, 0)`, NOT `Math.max(..., minSize)`), then
  // `getSize()` clamps when reading. That's fine for display but it means
  // we'd persist invalid widths (e.g. 0) to disk, which then re-loads as
  // a column stuck at minSize because every mousedown re-captures the
  // clamped size and dragging left can only push it back to 0.
  const clampSizing = useCallback((raw: ColumnSizingState): ColumnSizingState => {
    const clamped: ColumnSizingState = {};
    for (const [colId, size] of Object.entries(raw)) {
      if (typeof size !== 'number' || Number.isNaN(size)) continue;
      clamped[colId] = Math.min(Math.max(size, 80), 800);
    }
    return clamped;
  }, []);

  const [columnSizing, setRawColumnSizing] = useState<ColumnSizingState>(
    () => clampSizing(view?.columnWidths ?? {}),
  );
  const setColumnSizing = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setRawColumnSizing(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return clampSizing(next);
      });
    },
    [clampSizing],
  );
  const [columnSizingInfo, setColumnSizingInfo] = useState<ColumnSizingInfoState>(() => ({
    startOffset: null,
    startSize: null,
    deltaOffset: null,
    deltaPercentage: null,
    isResizingColumn: false,
    columnSizingStart: [],
  }));

  // Resync local widths when the *view itself* changes (view switcher /
  // different file opened). Depend on `viewId` alone — depending on the
  // `columnWidths` object would re-fire mid-drag from the parent
  // re-rendering, overwriting in-progress sizing.
  const viewId = view?.id;
  const seedWidthsRef = useRef(view?.columnWidths);
  seedWidthsRef.current = view?.columnWidths;
  useEffect(() => {
    setColumnSizing(seedWidthsRef.current ?? {});
  }, [viewId, setColumnSizing]);

  // Persist on the falling edge of `isResizingColumn`. We do this in a
  // proper useEffect (not inside a setState updater) so the disk-write
  // side effect runs after commit, not during render. `emitViewChange`
  // in `useDatabase.ts` already debounces the actual file write.
  const sizingRef = useRef(columnSizing);
  sizingRef.current = columnSizing;
  const updateViewConfigRef = useRef(updateViewConfig);
  updateViewConfigRef.current = updateViewConfig;
  const wasResizingRef = useRef(false);
  const isResizingNow = Boolean(columnSizingInfo.isResizingColumn);
  useEffect(() => {
    if (wasResizingRef.current && !isResizingNow) {
      const uvc = updateViewConfigRef.current;
      if (viewId && uvc) {
        uvc(viewId, { columnWidths: sizingRef.current });
      }
    }
    wasResizingRef.current = isResizingNow;
  }, [isResizingNow, viewId]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableSorting: false,
    getRowId: (row) => row._id,
    state: {
      columnSizing,
      columnSizingInfo,
    },
    onColumnSizingChange: setColumnSizing,
    onColumnSizingInfoChange: setColumnSizingInfo,
    meta: {
      updateCell,
      updateColumnOptions,
      databaseFilePath,
      workspacePath,
      readOnly,
    },
  });

  const { rows: tableRows } = table.getRowModel();

  // Dynamic row heights — `measureElement` lets the virtualizer record each
  // row's actual measured height after layout. Required for "wrap text"
  // columns where row height depends on word-wrapped content.
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    measureElement: (el) => el?.getBoundingClientRect().height ?? ROW_HEIGHT,
    overscan: 15,
  });

  const handleAddRow = useCallback(() => {
    addRow();
  }, [addRow]);

  if (schema.columns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-page-text/40 text-sm py-16">
        <p>No columns yet</p>
        {onAddColumn && (
          <button
            onClick={onAddColumn}
            className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            + Add first column
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Table scroll container — horizontal scroll is internal to the
          database, never bubbling to the document. Outer padding is the
          --db-h-pad token for standalone mode; inline / chat modes get
          0 so the first cell aligns with the surrounding container. */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ paddingInline: outerPaddingInline }}
      >
        <table
          className="border-collapse"
          // `table-layout: fixed` is required — the default `auto` layout
          // ignores the `width` style on `<th>`/`<td>` when cell content
          // would push the column wider. That's why text columns with long
          // content (e.g. Name) appeared unresizable while badge-shaped
          // columns (select, multi-select) resized fine. With `fixed`, the
          // header widths are authoritative and `overflow: hidden` on cells
          // clips long content with the existing ellipsis.
          style={{ width: table.getCenterTotalSize(), tableLayout: 'fixed' }}
        >
          {/* Header */}
          <thead className="sticky top-0 z-10 bg-page-bg">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (

                  <th
                    key={header.id}
                    className={cn(
                      'text-left text-page-text/60 font-medium text-xs tracking-wide',
                      'border-b border-border/30 select-none',
                    )}
                    // padding 0 here — the inner wrapper owns padding +
                    // positioning context. We can't rely on `position:
                    // relative` directly on `<th>` because some browsers
                    // ignore it under `border-collapse: collapse`, which
                    // makes absolutely-positioned children resolve against
                    // the table/thead instead of the cell.
                    style={{ width: header.getSize(), padding: 0 }}
                  >
                    <div
                      className="relative flex items-center gap-1.5"
                      // The wrapper is the positioning context for the
                      // resize handle. Padding lives here so the handle
                      // can extend the full height of the cell.
                      style={{ padding: '0.375rem 0.75rem' }}
                    >
                      {!header.isPlaceholder && (
                        <ColumnTypeIcon type={(header.column.columnDef.meta as { columnDef?: ColumnDef })?.columnDef?.type ?? 'text'} />
                      )}
                      {header.isPlaceholder ? null : (
                        renameColumn && removeColumn && changeColumnType ? (
                          <ColumnHeaderMenu
                            columnId={header.column.id}
                            columnName={String(header.column.columnDef.header ?? header.column.id)}
                            onRename={renameColumn}
                            onDelete={removeColumn}
                            onChangeType={changeColumnType}
                            onSetWrap={setColumnWrap}
                            currentType={(header.column.columnDef.meta as { columnDef?: ColumnDef })?.columnDef?.type ?? 'text'}
                            isWrapping={(header.column.columnDef.meta as { columnDef?: ColumnDef })?.columnDef?.wrap !== false}
                          />
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )
                      )}
                      {/* Resize handle. Lives inside a wrapper `<div>`
                          (not directly on `<th>`) so the positioning
                          context is reliable under `border-collapse:
                          collapse`. 12px-wide grab zone fully inside the
                          cell's right edge; a 1px visible divider sits
                          flush with the cell border, thickening on
                          hover. Stop propagation so a stray click on
                          the handle never opens the column-header
                          popover. */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          header.getResizeHandler()(e);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          header.getResizeHandler()(e);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          header.column.resetSize();
                          if (view && updateViewConfig) {
                            const next = { ...sizingRef.current };
                            delete next[header.column.id];
                            updateViewConfig(view.id, { columnWidths: next });
                          }
                        }}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize column ${String(header.column.columnDef.header ?? header.column.id)}`}
                        title="Drag to resize, double-click to reset"
                        className={cn(
                          'group absolute top-0 right-0 h-full w-3 z-20',
                          'cursor-col-resize select-none touch-none',
                        )}
                      >
                        <div
                          className={cn(
                            'absolute right-0 top-0 h-full w-px',
                            'bg-border/30 transition-all',
                            'group-hover:bg-accent group-hover:w-0.5',
                            header.column.getIsResizing() && 'bg-accent w-0.5',
                          )}
                        />
                      </div>
                    </div>
                  </th>
                ))}
                {onAddColumn && (
                  <th className="border-b border-border w-10" style={{ padding: '0.375rem 0.5rem' }}>
                    <button
                      onClick={onAddColumn}
                      className="text-text-tertiary hover:text-text-secondary p-1 rounded hover:bg-bg-surface transition-colors"
                      title="Add column"
                    >
                      <PlusIcon size={14} />
                    </button>
                  </th>
                )}
              </tr>
            ))}
          </thead>

          {/* Body with virtualization */}
          <tbody>
            {/* Spacer for virtualized rows */}
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0 }}
                  colSpan={schema.columns.length}
                />
              </tr>
            )}
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const row = tableRows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  // `data-index` + `ref` let the virtualizer record this
                  // row's natural height after layout — required so wrapped
                  // text rows don't get clipped to the 36px estimate.
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="border-b border-border/20 hover:bg-page-text/[0.03] transition-colors align-top"
                >
                  {row.getVisibleCells().map(cell => {
                    const colDef = (cell.column.columnDef.meta as { columnDef?: ColumnDef })?.columnDef;
                    const wrap = colDef?.wrap !== false;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'text-sm text-page-text overflow-hidden',
                          wrap
                            ? 'whitespace-normal break-words'
                            : 'text-ellipsis whitespace-nowrap',
                        )}
                        // Inline padding overrides the editor's .ProseMirror
                        // td rule that would otherwise bleed through.
                        style={{ width: cell.column.getSize(), padding: '0.375rem 0.75rem' }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Bottom spacer */}
            {rowVirtualizer.getVirtualItems().length > 0 && (
              <tr>
                <td
                  style={{
                    height:
                      rowVirtualizer.getTotalSize() -
                      (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                  }}
                  colSpan={schema.columns.length}
                />
              </tr>
            )}
          </tbody>
        </table>

        {/* Add row button — hidden in read-only mode */}
        {!readOnly && (
          <button
            onClick={handleAddRow}
            className={cn(
              'w-full text-left px-3 py-2 text-sm text-page-text/30',
              'hover:bg-page-text/[0.03] hover:text-page-text/60 transition-colors',
            )}
          >
            + New row
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center px-3 py-1 border-t border-border/20 text-xs text-page-text/40">
        {tableRows.length === rows.length
          ? `${rows.length} row${rows.length !== 1 ? 's' : ''}`
          : `${tableRows.length} of ${rows.length} rows (filtered)`}
      </div>
    </div>
  );
};

export default TableView;
