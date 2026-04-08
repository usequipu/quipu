import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ColumnDef as TanstackColumnDef, CellContext } from '@tanstack/react-table';
import type { DatabaseRow, DatabaseSchema, ColumnDef, SelectColumnDef, MultiSelectColumnDef } from '../types';
import TextCell from '../components/cells/TextCell';
import NumberCell from '../components/cells/NumberCell';
import SelectCell from '../components/cells/SelectCell';
import MultiSelectCell from '../components/cells/MultiSelectCell';
import DateCell from '../components/cells/DateCell';
import CheckboxCell from '../components/cells/CheckboxCell';

const columnHelper = createColumnHelper<DatabaseRow>();

interface TableMeta {
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
}

/**
 * Render an editable cell based on the column type.
 */
function renderCell(info: CellContext<DatabaseRow, unknown>, col: ColumnDef): React.ReactNode {
  const value = info.getValue();
  const rowId = info.row.original._id;
  const meta = info.table.options.meta as TableMeta | undefined;
  const update = (v: unknown) => meta?.updateCell(rowId, col.id, v);

  switch (col.type) {
    case 'text':
      return React.createElement(TextCell, {
        value: (value as string | null) ?? null,
        onUpdate: (v: string) => update(v),
      });
    case 'number':
      return React.createElement(NumberCell, {
        value: (value as number | null) ?? null,
        onUpdate: (v: number | null) => update(v),
      });
    case 'select':
      return React.createElement(SelectCell, {
        value: (value as string | null) ?? null,
        options: (col as SelectColumnDef).options,
        onUpdate: (v: string | null) => update(v),
      });
    case 'multi-select':
      return React.createElement(MultiSelectCell, {
        value: (value as string[] | null) ?? null,
        options: (col as MultiSelectColumnDef).options,
        onUpdate: (v: string[]) => update(v),
      });
    case 'date':
      return React.createElement(DateCell, {
        value: (value as string | null) ?? null,
        onUpdate: (v: string | null) => update(v),
      });
    case 'checkbox':
      return React.createElement(CheckboxCell, {
        value: Boolean(value),
        onUpdate: (v: boolean) => update(v),
      });
    default:
      return String(value ?? '');
  }
}

/**
 * Generate TanStack Table column definitions from the database schema.
 * Returns column defs with type-appropriate cell editors and sorting.
 */
export function useColumnDefs(schema: DatabaseSchema): TanstackColumnDef<DatabaseRow, unknown>[] {
  return useMemo(() => {
    return schema.columns.map((col) => {
      return columnHelper.accessor(col.id, {
        id: col.id,
        header: col.name,
        cell: (info) => renderCell(info, col),
        sortingFn: col.type === 'number' ? 'basic' : 'alphanumeric',
        size: 180,
        minSize: 80,
        maxSize: 500,
        enableResizing: true,
        meta: {
          columnDef: col,
        },
      });
    });
  }, [schema.columns]);
}
