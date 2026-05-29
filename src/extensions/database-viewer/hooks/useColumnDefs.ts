import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ColumnDef as TanstackColumnDef, CellContext } from '@tanstack/react-table';
import type {
  DatabaseRow,
  DatabaseSchema,
  ColumnDef,
  ColumnType,
  SelectColumnDef,
  MultiSelectColumnDef,
  LinkColumnDef,
  SelectOption,
} from '../types';
import TextCell from '../components/cells/TextCell';
import NumberCell from '../components/cells/NumberCell';
import SelectCell from '../components/cells/SelectCell';
import MultiSelectCell from '../components/cells/MultiSelectCell';
import DateCell from '../components/cells/DateCell';
import CheckboxCell from '../components/cells/CheckboxCell';
import LinkCell from '../components/cells/LinkCell';

const columnHelper = createColumnHelper<DatabaseRow>();

interface TableMeta {
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  updateColumnOptions?: (columnId: string, options: SelectOption[]) => void;
  databaseFilePath: string | null;
  workspacePath: string | null;
  readOnly?: boolean;
}

/**
 * Render an editable cell based on the column type.
 */
function renderCell(info: CellContext<DatabaseRow, unknown>, col: ColumnDef): React.ReactNode {
  const value = info.getValue();
  const rowId = info.row.original._id;
  const meta = info.table.options.meta as TableMeta | undefined;
  const readOnly = meta?.readOnly ?? false;
  const update = (v: unknown) => {
    if (readOnly) return; // chat / preview surfaces don't persist edits
    meta?.updateCell(rowId, col.id, v);
  };

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
    case 'select': {
      const selectCol = col as SelectColumnDef;
      const onAddOption = !readOnly && meta?.updateColumnOptions
        ? (option: SelectOption) => meta.updateColumnOptions!(col.id, [...selectCol.options, option])
        : undefined;
      return React.createElement(SelectCell, {
        value: (value as string | null) ?? null,
        options: selectCol.options,
        onUpdate: (v: string | null) => update(v),
        onAddOption,
      });
    }
    case 'multi-select': {
      const msCol = col as MultiSelectColumnDef;
      const onAddOption = !readOnly && meta?.updateColumnOptions
        ? (option: SelectOption) => meta.updateColumnOptions!(col.id, [...msCol.options, option])
        : undefined;
      return React.createElement(MultiSelectCell, {
        value: (value as string[] | null) ?? null,
        options: msCol.options,
        onUpdate: (v: string[]) => update(v),
        onAddOption,
      });
    }
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
    case 'link':
      return React.createElement(LinkCell, {
        value: (value as string | null) ?? null,
        column: col as LinkColumnDef,
        databaseFilePath: meta?.databaseFilePath ?? null,
        workspacePath: meta?.workspacePath ?? null,
        onUpdate: (v: string | null) => update(v),
        readOnly,
      });
    default:
      return String(value ?? '');
  }
}

/**
 * Per-column-type default widths (px). Chosen to fit each editor's natural
 * content density: checkboxes are narrow, free-text columns are wide.
 * Saved widths in `view.columnWidths` always win over these defaults.
 */
export function defaultSizeForType(type: ColumnType): number {
  switch (type) {
    case 'checkbox':
      return 60;
    case 'number':
      return 100;
    case 'date':
      return 140;
    case 'select':
      return 160;
    case 'multi-select':
      return 200;
    case 'text':
    case 'link':
      return 240;
    default:
      return 180;
  }
}

/**
 * Generate TanStack Table column definitions from the database schema.
 * Returns column defs with type-appropriate cell editors and sorting.
 *
 * `columnWidths` (from the active view) overrides per-type defaults so
 * user-resized widths persist across reloads.
 */
export function useColumnDefs(
  schema: DatabaseSchema,
  columnWidths?: Record<string, number>,
): TanstackColumnDef<DatabaseRow, unknown>[] {
  return useMemo(() => {
    return schema.columns.map((col) => {
      const savedWidth = columnWidths?.[col.id];
      const size = savedWidth ?? defaultSizeForType(col.type);
      return columnHelper.accessor(col.id, {
        id: col.id,
        header: col.name,
        cell: (info) => renderCell(info, col),
        sortingFn: col.type === 'number' ? 'basic' : 'alphanumeric',
        size,
        minSize: 80,
        maxSize: 800,
        enableResizing: true,
        meta: {
          columnDef: col,
        },
      });
    });
  }, [schema.columns, columnWidths]);
}
