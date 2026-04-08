import { useMemo } from 'react';
import type { DatabaseRow, ColumnDef, FilterDef, SortDef, FilterOperator } from '../types';

/** Operators valid for each column type. */
const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  'multi-select': ['contains', 'not_equals', 'is_empty', 'is_not_empty'],
  date: ['date_is', 'before', 'after', 'is_empty', 'is_not_empty'],
  checkbox: ['is_checked', 'is_unchecked'],
};

/** Human-readable labels for filter operators. */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  equals: 'equals',
  not_equals: 'does not equal',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  eq: '=',
  neq: '!=',
  is: 'is',
  is_not: 'is not',
  before: 'before',
  after: 'after',
  date_is: 'is',
  is_checked: 'is checked',
  is_unchecked: 'is unchecked',
};

/** Operators that require no value input. */
const VALUE_LESS_OPERATORS: Set<FilterOperator> = new Set([
  'is_empty',
  'is_not_empty',
  'is_checked',
  'is_unchecked',
]);

export { OPERATORS_BY_TYPE, OPERATOR_LABELS, VALUE_LESS_OPERATORS };

// ---------------------------------------------------------------------------
// Filter logic
// ---------------------------------------------------------------------------

function applyFilter(row: DatabaseRow, filter: FilterDef, columns: ColumnDef[]): boolean {
  const col = columns.find(c => c.id === filter.columnId);
  if (!col) return true; // Unknown column -- don't filter out

  const cellValue = row[filter.columnId];
  const filterValue = filter.value;

  switch (col.type) {
    case 'text':
      return applyTextFilter(cellValue, filter.operator, filterValue);
    case 'number':
      return applyNumberFilter(cellValue, filter.operator, filterValue);
    case 'select':
      return applySelectFilter(cellValue, filter.operator, filterValue);
    case 'multi-select':
      return applyMultiSelectFilter(cellValue, filter.operator, filterValue);
    case 'date':
      return applyDateFilter(cellValue, filter.operator, filterValue);
    case 'checkbox':
      return applyCheckboxFilter(cellValue, filter.operator);
    default:
      return true;
  }
}

function applyTextFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown): boolean {
  const text = typeof cellValue === 'string' ? cellValue : '';
  const target = typeof filterValue === 'string' ? filterValue : '';

  switch (operator) {
    case 'contains':
      return text.toLowerCase().includes(target.toLowerCase());
    case 'equals':
      return text === target;
    case 'not_equals':
      return text !== target;
    case 'is_empty':
      return text.trim() === '';
    case 'is_not_empty':
      return text.trim() !== '';
    default:
      return true;
  }
}

function applyNumberFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown): boolean {
  const num = typeof cellValue === 'number' ? cellValue : null;
  const target = typeof filterValue === 'number' ? filterValue : Number(filterValue);

  if (num === null) return operator === 'is_empty';
  if (isNaN(target)) return true;

  switch (operator) {
    case 'eq': return num === target;
    case 'neq': return num !== target;
    case 'gt': return num > target;
    case 'lt': return num < target;
    case 'gte': return num >= target;
    case 'lte': return num <= target;
    default: return true;
  }
}

function applySelectFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown): boolean {
  const val = typeof cellValue === 'string' ? cellValue : '';
  const target = typeof filterValue === 'string' ? filterValue : '';

  switch (operator) {
    case 'is': return val === target;
    case 'is_not': return val !== target;
    case 'is_empty': return !val;
    case 'is_not_empty': return !!val;
    default: return true;
  }
}

function applyMultiSelectFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown): boolean {
  const arr = Array.isArray(cellValue) ? cellValue as string[] : [];
  const target = typeof filterValue === 'string' ? filterValue : '';

  switch (operator) {
    case 'contains': return arr.includes(target);
    case 'not_equals': return !arr.includes(target);
    case 'is_empty': return arr.length === 0;
    case 'is_not_empty': return arr.length > 0;
    default: return true;
  }
}

function applyDateFilter(cellValue: unknown, operator: FilterOperator, filterValue: unknown): boolean {
  const dateStr = typeof cellValue === 'string' ? cellValue : '';
  const targetStr = typeof filterValue === 'string' ? filterValue : '';

  switch (operator) {
    case 'is_empty':
      return !dateStr;
    case 'is_not_empty':
      return !!dateStr;
    case 'date_is': {
      if (!dateStr || !targetStr) return false;
      return dateStr.slice(0, 10) === targetStr.slice(0, 10);
    }
    case 'before': {
      if (!dateStr || !targetStr) return false;
      return new Date(dateStr) < new Date(targetStr);
    }
    case 'after': {
      if (!dateStr || !targetStr) return false;
      return new Date(dateStr) > new Date(targetStr);
    }
    default:
      return true;
  }
}

function applyCheckboxFilter(cellValue: unknown, operator: FilterOperator): boolean {
  const checked = Boolean(cellValue);
  switch (operator) {
    case 'is_checked': return checked;
    case 'is_unchecked': return !checked;
    default: return true;
  }
}

// ---------------------------------------------------------------------------
// Sort logic
// ---------------------------------------------------------------------------

function compareValues(a: unknown, b: unknown, col: ColumnDef | undefined): number {
  if (!col) return 0;

  switch (col.type) {
    case 'number': {
      const na = typeof a === 'number' ? a : null;
      const nb = typeof b === 'number' ? b : null;
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    case 'checkbox': {
      const ba = Boolean(a);
      const bb = Boolean(b);
      if (ba === bb) return 0;
      return ba ? -1 : 1;
    }
    case 'date': {
      const da = typeof a === 'string' && a ? new Date(a).getTime() : null;
      const db = typeof b === 'string' && b ? new Date(b).getTime() : null;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    case 'multi-select': {
      const sa = Array.isArray(a) ? (a as string[]).join(', ') : '';
      const sb = Array.isArray(b) ? (b as string[]).join(', ') : '';
      return sa.localeCompare(sb);
    }
    default: {
      const sa = typeof a === 'string' ? a : String(a ?? '');
      const sb = typeof b === 'string' ? b : String(b ?? '');
      return sa.localeCompare(sb);
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDatabaseFiltersOptions {
  rows: DatabaseRow[];
  columns: ColumnDef[];
  filters: FilterDef[];
  sorts: SortDef[];
}

export function useDatabaseFilters({
  rows,
  columns,
  filters,
  sorts,
}: UseDatabaseFiltersOptions): DatabaseRow[] {
  return useMemo(() => {
    // 1. Filter
    let result = rows;
    if (filters.length > 0) {
      result = result.filter(row =>
        filters.every(filter => applyFilter(row, filter, columns))
      );
    }

    // 2. Sort
    if (sorts.length > 0) {
      result = [...result].sort((a, b) => {
        for (const sort of sorts) {
          const col = columns.find(c => c.id === sort.columnId);
          const cmp = compareValues(a[sort.columnId], b[sort.columnId], col);
          if (cmp !== 0) return sort.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }

    return result;
  }, [rows, columns, filters, sorts]);
}
