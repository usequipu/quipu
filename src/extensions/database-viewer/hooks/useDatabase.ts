import { useState, useCallback, useRef, useEffect } from 'react';
import { parseQuipuDb, serializeQuipuDb, createEmptyDatabase } from '../utils/jsonl';
import { generateRowId } from '../utils/id';
import type {
  DatabaseSchema,
  DatabaseRow,
  ColumnDef,
  ColumnType,
  ViewConfig,
  SelectOption,
} from '../types';

interface UseDatabaseOptions {
  content: string | null;
  onContentChange?: (content: string) => void;
}

interface UseDatabaseReturn {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  // Row operations
  addRow: () => void;
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  deleteRow: (rowId: string) => void;
  reorderRows: (fromIndex: number, toIndex: number) => void;
  // Column operations
  addColumn: (colDef: ColumnDef) => void;
  removeColumn: (columnId: string) => void;
  renameColumn: (columnId: string, newName: string) => void;
  changeColumnType: (columnId: string, newType: ColumnType) => void;
  reorderColumns: (newOrder: string[]) => void;
  updateColumnOptions: (columnId: string, options: SelectOption[]) => void;
  // View operations
  updateViewConfig: (viewId: string, updates: Partial<ViewConfig>) => void;
  // Schema
  updateDatabaseName: (name: string) => void;
}

const DEFAULT_SCHEMA: DatabaseSchema = {
  version: 1,
  name: 'Untitled Database',
  columns: [],
  views: [
    { id: 'default-table', name: 'Table', type: 'table', filters: [], sorts: [], columnWidths: {} },
    { id: 'default-board', name: 'Board', type: 'board', filters: [], sorts: [], columnWidths: {} },
  ],
};

/**
 * Convert a cell value from one column type to another (best-effort).
 */
function convertValue(value: unknown, fromType: ColumnType, toType: ColumnType): unknown {
  if (value == null) return null;

  const str = String(value);

  switch (toType) {
    case 'text':
      return str;
    case 'number': {
      const num = Number(str);
      return isNaN(num) ? null : num;
    }
    case 'select':
      return typeof value === 'string' ? value : str;
    case 'multi-select':
      return Array.isArray(value) ? value : [str];
    case 'date':
      // Accept ISO date strings, return null for invalid
      return typeof value === 'string' && !isNaN(Date.parse(value)) ? value : null;
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      if (str === 'true' || str === '1') return true;
      if (str === 'false' || str === '0') return false;
      return false;
    default:
      return value;
  }
}

export function useDatabase({ content, onContentChange }: UseDatabaseOptions): UseDatabaseReturn {
  const [schema, setSchema] = useState<DatabaseSchema>(DEFAULT_SCHEMA);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const isInitializedRef = useRef(false);
  const dataDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContentRef = useRef<string | null>(null);

  // Parse content on mount and when content changes (file watcher reload)
  useEffect(() => {
    if (content === lastContentRef.current) return;
    lastContentRef.current = content;

    if (!content) {
      const empty = createEmptyDatabase('Untitled Database');
      const parsed = parseQuipuDb(empty);
      setSchema(parsed.schema);
      setRows(parsed.rows);
      // For empty/new files, immediately write the initial content
      if (!isInitializedRef.current) {
        isInitializedRef.current = true;
        onContentChange?.(empty);
      }
      return;
    }

    try {
      const parsed = parseQuipuDb(content);
      setSchema(parsed.schema);
      setRows(parsed.rows);
    } catch {
      // If parse fails, keep current state
    }

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
    }
  }, [content, onContentChange]);

  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      if (dataDebounceRef.current) clearTimeout(dataDebounceRef.current);
      if (viewDebounceRef.current) clearTimeout(viewDebounceRef.current);
    };
  }, []);

  // Debounced content change emitter
  const emitDataChange = useCallback((newSchema: DatabaseSchema, newRows: DatabaseRow[]) => {
    if (!isInitializedRef.current || !onContentChange) return;
    if (dataDebounceRef.current) clearTimeout(dataDebounceRef.current);
    dataDebounceRef.current = setTimeout(() => {
      const serialized = serializeQuipuDb(newSchema, newRows);
      lastContentRef.current = serialized;
      onContentChange(serialized);
    }, 500);
  }, [onContentChange]);

  const emitViewChange = useCallback((newSchema: DatabaseSchema, currentRows: DatabaseRow[]) => {
    if (!isInitializedRef.current || !onContentChange) return;
    if (viewDebounceRef.current) clearTimeout(viewDebounceRef.current);
    viewDebounceRef.current = setTimeout(() => {
      const serialized = serializeQuipuDb(newSchema, currentRows);
      lastContentRef.current = serialized;
      onContentChange(serialized);
    }, 2000);
  }, [onContentChange]);

  // Row operations

  const addRow = useCallback(() => {
    setRows(prev => {
      const newRow: DatabaseRow = { _id: generateRowId() };
      // Initialize all columns with null
      for (const col of schema.columns) {
        newRow[col.id] = col.type === 'checkbox' ? false : null;
      }
      const next = [...prev, newRow];
      emitDataChange(schema, next);
      return next;
    });
  }, [schema, emitDataChange]);

  const updateCell = useCallback((rowId: string, columnId: string, value: unknown) => {
    setRows(prev => {
      const next = prev.map(row =>
        row._id === rowId ? { ...row, [columnId]: value } : row
      );
      emitDataChange(schema, next);
      return next;
    });
  }, [schema, emitDataChange]);

  const deleteRow = useCallback((rowId: string) => {
    setRows(prev => {
      const next = prev.filter(row => row._id !== rowId);
      emitDataChange(schema, next);
      return next;
    });
  }, [schema, emitDataChange]);

  const reorderRows = useCallback((fromIndex: number, toIndex: number) => {
    setRows(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      emitDataChange(schema, next);
      return next;
    });
  }, [schema, emitDataChange]);

  // Column operations

  const addColumn = useCallback((colDef: ColumnDef) => {
    setSchema(prev => {
      const next = { ...prev, columns: [...prev.columns, colDef] };
      setRows(currentRows => {
        const updatedRows = currentRows.map(row => ({
          ...row,
          [colDef.id]: colDef.type === 'checkbox' ? false : null,
        }));
        emitDataChange(next, updatedRows);
        return updatedRows;
      });
      return next;
    });
  }, [emitDataChange]);

  const removeColumn = useCallback((columnId: string) => {
    setSchema(prev => {
      const next = {
        ...prev,
        columns: prev.columns.filter(col => col.id !== columnId),
      };
      setRows(currentRows => {
        const updatedRows = currentRows.map(row => {
          const { [columnId]: _, ...rest } = row;
          return rest as DatabaseRow;
        });
        emitDataChange(next, updatedRows);
        return updatedRows;
      });
      return next;
    });
  }, [emitDataChange]);

  const renameColumn = useCallback((columnId: string, newName: string) => {
    setSchema(prev => {
      const next = {
        ...prev,
        columns: prev.columns.map(col =>
          col.id === columnId ? { ...col, name: newName } : col
        ),
      };
      // Data rows unchanged — they use stable column IDs
      emitDataChange(next, rows);
      return next;
    });
  }, [rows, emitDataChange]);

  const changeColumnType = useCallback((columnId: string, newType: ColumnType) => {
    setSchema(prev => {
      const oldCol = prev.columns.find(col => col.id === columnId);
      if (!oldCol || oldCol.type === newType) return prev;

      const newCol: ColumnDef = {
        id: columnId,
        name: oldCol.name,
        type: newType,
        ...(newType === 'select' || newType === 'multi-select' ? { options: [] } : {}),
      } as ColumnDef;

      const next = {
        ...prev,
        columns: prev.columns.map(col => col.id === columnId ? newCol : col),
      };

      setRows(currentRows => {
        const updatedRows = currentRows.map(row => ({
          ...row,
          [columnId]: convertValue(row[columnId], oldCol.type, newType),
        }));
        emitDataChange(next, updatedRows);
        return updatedRows;
      });

      return next;
    });
  }, [emitDataChange]);

  const reorderColumns = useCallback((newOrder: string[]) => {
    setSchema(prev => {
      const colMap = new Map(prev.columns.map(col => [col.id, col]));
      const reordered = newOrder
        .map(id => colMap.get(id))
        .filter((col): col is ColumnDef => col !== undefined);
      const next = { ...prev, columns: reordered };
      emitViewChange(next, rows);
      return next;
    });
  }, [rows, emitViewChange]);

  const updateColumnOptions = useCallback((columnId: string, options: SelectOption[]) => {
    setSchema(prev => {
      const next = {
        ...prev,
        columns: prev.columns.map(col => {
          if (col.id !== columnId) return col;
          if (col.type === 'select' || col.type === 'multi-select') {
            return { ...col, options };
          }
          return col;
        }),
      };
      emitDataChange(next, rows);
      return next;
    });
  }, [rows, emitDataChange]);

  // View operations

  const updateViewConfig = useCallback((viewId: string, updates: Partial<ViewConfig>) => {
    setSchema(prev => {
      const next = {
        ...prev,
        views: prev.views.map(view =>
          view.id === viewId ? { ...view, ...updates } : view
        ),
      };
      emitViewChange(next, rows);
      return next;
    });
  }, [rows, emitViewChange]);

  const updateDatabaseName = useCallback((name: string) => {
    setSchema(prev => {
      const next = { ...prev, name };
      emitViewChange(next, rows);
      return next;
    });
  }, [rows, emitViewChange]);

  return {
    schema,
    rows,
    addRow,
    updateCell,
    deleteRow,
    reorderRows,
    addColumn,
    removeColumn,
    renameColumn,
    changeColumnType,
    reorderColumns,
    updateColumnOptions,
    updateViewConfig,
    updateDatabaseName,
  };
}
