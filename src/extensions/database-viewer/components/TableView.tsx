import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import type { ColumnSizingState, Updater } from '@tanstack/react-table';
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
  const columns = useColumnDefs(schema, view?.columnWidths);

  // Controlled column-sizing state. Seeded from the active view's saved
  // widths so resize-then-reload shows the persisted size; updates flow
  // back to disk via `updateViewConfig` (which the database hook already
  // debounces — see `emitViewChange` in `useDatabase.ts`).
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => view?.columnWidths ?? {},
  );

  // Resync local state when the active view changes (view switcher) or the
  // file is reloaded externally (file watcher). Without this, switching
  // views would keep stale sizing applied to the new view's columns.
  const viewId = view?.id;
  const viewColumnWidths = view?.columnWidths;
  useEffect(() => {
    setColumnSizing(viewColumnWidths ?? {});
  }, [viewId, viewColumnWidths]);

  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnSizing(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (view && updateViewConfig) {
          updateViewConfig(view.id, { columnWidths: next });
        }
        return next;
      });
    },
    [view, updateViewConfig],
  );

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
    },
    onColumnSizingChange: handleColumnSizingChange,
    meta: {
      updateCell,
      updateColumnOptions,
      databaseFilePath,
      workspacePath,
      readOnly,
    },
  });

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
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
          style={{ width: table.getCenterTotalSize() }}
        >
          {/* Header */}
          <thead className="sticky top-0 z-10 bg-page-bg">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (

                  <th
                    key={header.id}
                    className={cn(
                      'relative text-left text-page-text/60 font-medium text-xs tracking-wide',
                      'border-b border-border/30 select-none',
                    )}
                    // Inline padding overrides any prose-CSS padding the
                    // editor's `.ProseMirror th, td` rule would otherwise
                    // apply to React-rendered tables nested inside it.
                    style={{ width: header.getSize(), padding: '0.375rem 0.75rem' }}
                  >
                    <div className="flex items-center gap-1.5">
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
                            currentType={(header.column.columnDef.meta as { columnDef?: ColumnDef })?.columnDef?.type ?? 'text'}
                          />
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                        'hover:bg-accent/50',
                        header.column.getIsResizing() && 'bg-accent',
                      )}
                    />
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
                  className="border-b border-border/20 hover:bg-page-text/[0.03] transition-colors"
                  style={{ height: ROW_HEIGHT }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className={cn(
                        'text-sm text-page-text',
                        'overflow-hidden text-ellipsis whitespace-nowrap',
                      )}
                      // Inline padding overrides the editor's .ProseMirror
                      // td rule that would otherwise bleed through.
                      style={{ width: cell.column.getSize(), padding: '0.375rem 0.75rem' }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
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
