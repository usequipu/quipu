import React, { useRef, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PlusIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useColumnDefs } from '../hooks/useColumnDefs';
import { ColumnHeaderMenu } from './ColumnManager';
import type { DatabaseSchema, DatabaseRow, ColumnDef, ColumnType } from '../types';

interface TableViewProps {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  addRow: () => void;
  deleteRow?: (rowId: string) => void;
  renameColumn?: (columnId: string, newName: string) => void;
  removeColumn?: (columnId: string) => void;
  changeColumnType?: (columnId: string, newType: ColumnType) => void;
  onAddColumn?: () => void;
}

const ROW_HEIGHT = 36;

const TableView: React.FC<TableViewProps> = ({ schema, rows, updateCell, addRow, deleteRow, renameColumn, removeColumn, changeColumnType, onAddColumn }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const columns = useColumnDefs(schema);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableSorting: false,
    getRowId: (row) => row._id,
    meta: {
      updateCell,
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
      {/* Table container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
      >
        <table
          className="w-full border-collapse"
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
                      'relative text-left px-3 py-1.5 text-page-text/50 font-medium text-xs tracking-wide',
                      'border-b border-border/30 select-none',
                    )}
                    style={{ width: header.getSize() }}
                  >
                    <div className="flex items-center gap-1">
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
                  <th className="border-b border-border px-2 py-2 w-10">
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
                        'px-3 py-1.5 text-sm text-page-text',
                        'overflow-hidden text-ellipsis whitespace-nowrap',
                      )}
                      style={{ width: cell.column.getSize() }}
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

        {/* Add row button */}
        <button
          onClick={handleAddRow}
          className={cn(
            'w-full text-left px-3 py-2 text-sm text-page-text/30',
            'hover:bg-page-text/[0.03] hover:text-page-text/60 transition-colors',
          )}
        >
          + New row
        </button>
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
