// Column type definitions

export type ColumnType = 'text' | 'number' | 'select' | 'multi-select' | 'date' | 'checkbox' | 'link';

/**
 * Link column mode.
 * - `global`: cell value is a path relative to the workspace root.
 * - `relative`: cell value is a basename inside a sibling folder named
 *    after the database file. The folder is auto-created on first use and
 *    moved/renamed/deleted in lockstep with the database file.
 */
export type LinkMode = 'global' | 'relative';

export interface BaseColumnDef {
  id: string;
  name: string;
  /**
   * Cell text overflow behavior. When `false`, content is clipped with
   * ellipsis and rows stay one line tall (Excel-style "clip"). When
   * absent or `true`, content wraps onto new lines and the row grows
   * to fit. Default is wrap (omit the field).
   */
  wrap?: boolean;
}

export interface TextColumnDef extends BaseColumnDef {
  type: 'text';
}

export interface NumberColumnDef extends BaseColumnDef {
  type: 'number';
}

export interface SelectColumnDef extends BaseColumnDef {
  type: 'select';
  options: SelectOption[];
}

export interface MultiSelectColumnDef extends BaseColumnDef {
  type: 'multi-select';
  options: SelectOption[];
}

export interface DateColumnDef extends BaseColumnDef {
  type: 'date';
}

export interface CheckboxColumnDef extends BaseColumnDef {
  type: 'checkbox';
}

export interface LinkColumnDef extends BaseColumnDef {
  type: 'link';
  /** Where the linked file lives. Defaults to 'global' if omitted. */
  mode: LinkMode;
  /**
   * Extension applied to newly created files (with leading dot, e.g. '.md').
   * Empty string means no extension. Optional — defaults to '.md' when
   * absent.
   */
  defaultExtension?: string;
}

export interface SelectOption {
  value: string;
  color: string;
}

export type ColumnDef =
  | TextColumnDef
  | NumberColumnDef
  | SelectColumnDef
  | MultiSelectColumnDef
  | DateColumnDef
  | CheckboxColumnDef
  | LinkColumnDef;

// Filter and sort definitions

export type FilterOperator =
  // Text
  | 'contains' | 'equals' | 'not_equals' | 'is_empty' | 'is_not_empty'
  // Number
  | 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq'
  // Select
  | 'is' | 'is_not'
  // Date
  | 'before' | 'after' | 'date_is'
  // Checkbox
  | 'is_checked' | 'is_unchecked';

export interface FilterDef {
  columnId: string;
  operator: FilterOperator;
  value: unknown;
}

export interface SortDef {
  columnId: string;
  direction: 'asc' | 'desc';
}

// View configuration

export interface ViewConfig {
  id: string;
  name: string;
  type: 'table' | 'board';
  filters: FilterDef[];
  sorts: SortDef[];
  columnWidths: Record<string, number>;
  groupByColumnId?: string; // Board view: which select column to group by
}

// Database schema (first line of .quipudb.jsonl)

export interface DatabaseSchema {
  version: number;
  name: string;
  columns: ColumnDef[];
  views: ViewConfig[];
}

// Row data (subsequent lines)

export interface DatabaseRow {
  _id: string;
  [columnId: string]: unknown;
}

// Parsed database

export interface ParsedDatabase {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
}

// Schema line wrapper (as stored in JSONL)

export interface SchemaLine {
  _schema: DatabaseSchema;
}

// Predefined select option colors

export const SELECT_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
] as const;
