import React, { useState, useCallback } from 'react';
import { Popover, Select } from 'radix-ui';
import { FunnelIcon, SortAscendingIcon, XIcon, PlusIcon, CaretDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { OPERATORS_BY_TYPE, OPERATOR_LABELS, VALUE_LESS_OPERATORS } from '../hooks/useDatabaseFilters';
import type {
  ColumnDef,
  FilterDef,
  SortDef,
  FilterOperator,
  SelectColumnDef,
  MultiSelectColumnDef,
} from '../types';

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  columns: ColumnDef[];
  filters: FilterDef[];
  sorts: SortDef[];
  onFiltersChange: (filters: FilterDef[]) => void;
  onSortsChange: (sorts: SortDef[]) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  columns,
  filters,
  sorts,
  onFiltersChange,
  onSortsChange,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // --- Filter handlers ---

  const handleAddFilter = useCallback(
    (columnId: string) => {
      const col = columns.find(c => c.id === columnId);
      if (!col) return;
      const operators = OPERATORS_BY_TYPE[col.type] ?? [];
      const defaultOp = operators[0];
      if (!defaultOp) return;
      const newFilter: FilterDef = {
        columnId,
        operator: defaultOp,
        value: VALUE_LESS_OPERATORS.has(defaultOp) ? null : '',
      };
      onFiltersChange([...filters, newFilter]);
    },
    [columns, filters, onFiltersChange],
  );

  const handleUpdateFilter = useCallback(
    (index: number, updates: Partial<FilterDef>) => {
      const next = filters.map((f, i) => (i === index ? { ...f, ...updates } : f));
      onFiltersChange(next);
    },
    [filters, onFiltersChange],
  );

  const handleRemoveFilter = useCallback(
    (index: number) => {
      onFiltersChange(filters.filter((_, i) => i !== index));
    },
    [filters, onFiltersChange],
  );

  // --- Sort handlers ---

  const handleAddSort = useCallback(
    (columnId: string) => {
      onSortsChange([...sorts, { columnId, direction: 'asc' }]);
    },
    [sorts, onSortsChange],
  );

  const handleUpdateSort = useCallback(
    (index: number, updates: Partial<SortDef>) => {
      const next = sorts.map((s, i) => (i === index ? { ...s, ...updates } : s));
      onSortsChange(next);
    },
    [sorts, onSortsChange],
  );

  const handleRemoveSort = useCallback(
    (index: number) => {
      onSortsChange(sorts.filter((_, i) => i !== index));
    },
    [sorts, onSortsChange],
  );

  // Columns not yet used in sorts
  const availableSortColumns = columns.filter(
    col => !sorts.some(s => s.columnId === col.id),
  );

  return (
    <div className="flex items-center gap-1">
      {/* Filter popover */}
      <Popover.Root open={filterOpen} onOpenChange={setFilterOpen}>
        <Popover.Trigger asChild>
          <Button variant="ghost" size="sm" className="relative gap-1.5">
            <FunnelIcon size={14} />
            <span>Filter</span>
            {filters.length > 0 && (
              <Badge variant="default" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
                {filters.length}
              </Badge>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="bg-bg-overlay border border-border rounded-lg shadow-lg p-3 min-w-[360px] max-w-[480px] z-[9999]"
            align="start"
            sideOffset={4}
          >
            {/* Active filters */}
            {filters.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {filters.map((filter, index) => (
                  <FilterRow
                    key={index}
                    filter={filter}
                    columns={columns}
                    onUpdate={(updates) => handleUpdateFilter(index, updates)}
                    onRemove={() => handleRemoveFilter(index)}
                  />
                ))}
              </div>
            )}

            {filters.length === 0 && (
              <div className="text-xs text-text-tertiary mb-3">No filters applied.</div>
            )}

            {/* Add filter */}
            {columns.length > 0 && (
              <ColumnPicker
                columns={columns}
                onSelect={handleAddFilter}
                label="Add filter"
              />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Sort popover */}
      <Popover.Root open={sortOpen} onOpenChange={setSortOpen}>
        <Popover.Trigger asChild>
          <Button variant="ghost" size="sm" className="relative gap-1.5">
            <SortAscendingIcon size={14} />
            <span>Sort</span>
            {sorts.length > 0 && (
              <Badge variant="default" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
                {sorts.length}
              </Badge>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="bg-bg-overlay border border-border rounded-lg shadow-lg p-3 min-w-[300px] max-w-[400px] z-[9999]"
            align="start"
            sideOffset={4}
          >
            {/* Active sorts */}
            {sorts.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {sorts.map((sort, index) => {
                  const col = columns.find(c => c.id === sort.columnId);
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="text-text-secondary min-w-0 truncate shrink">
                        {col?.name ?? sort.columnId}
                      </span>
                      <Select.Root
                        value={sort.direction}
                        onValueChange={(dir: string) =>
                          handleUpdateSort(index, { direction: dir as 'asc' | 'desc' })
                        }
                      >
                        <Select.Trigger
                          className={cn(
                            'inline-flex items-center gap-1 h-7 px-2 rounded border border-border',
                            'bg-bg-elevated text-text-primary text-xs',
                            'focus:outline-none focus:ring-1 focus:ring-accent',
                          )}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <CaretDownIcon size={10} />
                          </Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content
                            className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
                            position="popper"
                            sideOffset={4}
                          >
                            <Select.Viewport>
                              <Select.Item
                                value="asc"
                                className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                              >
                                <Select.ItemText>Ascending</Select.ItemText>
                              </Select.Item>
                              <Select.Item
                                value="desc"
                                className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                              >
                                <Select.ItemText>Descending</Select.ItemText>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                      <button
                        onClick={() => handleRemoveSort(index)}
                        className="shrink-0 p-0.5 rounded hover:bg-bg-surface text-text-tertiary hover:text-text-primary transition-colors"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {sorts.length === 0 && (
              <div className="text-xs text-text-tertiary mb-3">No sorts applied.</div>
            )}

            {/* Add sort */}
            {availableSortColumns.length > 0 && (
              <ColumnPicker
                columns={availableSortColumns}
                onSelect={handleAddSort}
                label="Add sort"
              />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FilterRow — a single active filter editor
// ---------------------------------------------------------------------------

interface FilterRowProps {
  filter: FilterDef;
  columns: ColumnDef[];
  onUpdate: (updates: Partial<FilterDef>) => void;
  onRemove: () => void;
}

const FilterRow: React.FC<FilterRowProps> = ({ filter, columns, onUpdate, onRemove }) => {
  const col = columns.find(c => c.id === filter.columnId);
  const operators = col ? OPERATORS_BY_TYPE[col.type] ?? [] : [];
  const needsValue = !VALUE_LESS_OPERATORS.has(filter.operator);

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Column select */}
      <Select.Root
        value={filter.columnId}
        onValueChange={(colId: string) => {
          const newCol = columns.find(c => c.id === colId);
          const newOps = newCol ? OPERATORS_BY_TYPE[newCol.type] ?? [] : [];
          const newOp = newOps[0];
          if (newOp) {
            onUpdate({
              columnId: colId,
              operator: newOp,
              value: VALUE_LESS_OPERATORS.has(newOp) ? null : '',
            });
          }
        }}
      >
        <Select.Trigger
          className={cn(
            'inline-flex items-center gap-1 h-7 px-2 rounded border border-border',
            'bg-bg-elevated text-text-primary text-xs min-w-[80px] max-w-[120px] truncate',
            'focus:outline-none focus:ring-1 focus:ring-accent',
          )}
        >
          <Select.Value />
          <Select.Icon>
            <CaretDownIcon size={10} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport>
              {columns.map(c => (
                <Select.Item
                  key={c.id}
                  value={c.id}
                  className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                >
                  <Select.ItemText>{c.name}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {/* Operator select */}
      <Select.Root
        value={filter.operator}
        onValueChange={(op: string) => {
          const newOp = op as FilterOperator;
          onUpdate({
            operator: newOp,
            value: VALUE_LESS_OPERATORS.has(newOp) ? null : filter.value,
          });
        }}
      >
        <Select.Trigger
          className={cn(
            'inline-flex items-center gap-1 h-7 px-2 rounded border border-border',
            'bg-bg-elevated text-text-primary text-xs min-w-[80px] max-w-[120px] truncate',
            'focus:outline-none focus:ring-1 focus:ring-accent',
          )}
        >
          <Select.Value />
          <Select.Icon>
            <CaretDownIcon size={10} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport>
              {operators.map(op => (
                <Select.Item
                  key={op}
                  value={op}
                  className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                >
                  <Select.ItemText>{OPERATOR_LABELS[op]}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {/* Value input */}
      {needsValue && (
        <FilterValueInput
          column={col ?? null}
          value={filter.value}
          onChange={(val) => onUpdate({ value: val })}
        />
      )}

      {/* Remove */}
      <button
        onClick={onRemove}
        className="shrink-0 p-0.5 rounded hover:bg-bg-surface text-text-tertiary hover:text-text-primary transition-colors"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FilterValueInput — type-appropriate value editor
// ---------------------------------------------------------------------------

interface FilterValueInputProps {
  column: ColumnDef | null;
  value: unknown;
  onChange: (value: unknown) => void;
}

const FilterValueInput: React.FC<FilterValueInputProps> = ({ column, value, onChange }) => {
  if (!column) {
    return (
      <Input
        className="h-7 text-xs min-w-[100px] max-w-[140px]"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value..."
      />
    );
  }

  switch (column.type) {
    case 'number':
      return (
        <Input
          type="number"
          className="h-7 text-xs min-w-[80px] max-w-[120px]"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => {
            const num = e.target.value === '' ? null : Number(e.target.value);
            onChange(num);
          }}
          placeholder="0"
        />
      );

    case 'date':
      return (
        <Input
          type="date"
          className="h-7 text-xs min-w-[120px] max-w-[160px]"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'select': {
      const options = (column as SelectColumnDef).options;
      return (
        <Select.Root
          value={typeof value === 'string' ? value : ''}
          onValueChange={(val: string) => onChange(val)}
        >
          <Select.Trigger
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded border border-border',
              'bg-bg-elevated text-text-primary text-xs min-w-[80px] max-w-[140px] truncate',
              'focus:outline-none focus:ring-1 focus:ring-accent',
            )}
          >
            <Select.Value placeholder="Select..." />
            <Select.Icon>
              <CaretDownIcon size={10} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
              position="popper"
              sideOffset={4}
            >
              <Select.Viewport>
                {options.map(opt => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                  >
                    <Select.ItemText>{opt.value}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      );
    }

    case 'multi-select': {
      const msOptions = (column as MultiSelectColumnDef).options;
      return (
        <Select.Root
          value={typeof value === 'string' ? value : ''}
          onValueChange={(val: string) => onChange(val)}
        >
          <Select.Trigger
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded border border-border',
              'bg-bg-elevated text-text-primary text-xs min-w-[80px] max-w-[140px] truncate',
              'focus:outline-none focus:ring-1 focus:ring-accent',
            )}
          >
            <Select.Value placeholder="Select..." />
            <Select.Icon>
              <CaretDownIcon size={10} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
              position="popper"
              sideOffset={4}
            >
              <Select.Viewport>
                {msOptions.map(opt => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    className="px-3 py-1.5 text-xs text-text-primary cursor-pointer hover:bg-bg-surface outline-none data-[highlighted]:bg-bg-surface"
                  >
                    <Select.ItemText>{opt.value}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      );
    }

    default:
      return (
        <Input
          className="h-7 text-xs min-w-[100px] max-w-[140px]"
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Value..."
        />
      );
  }
};

// ---------------------------------------------------------------------------
// ColumnPicker — reusable "Add filter/sort" button with column dropdown
// ---------------------------------------------------------------------------

interface ColumnPickerProps {
  columns: ColumnDef[];
  onSelect: (columnId: string) => void;
  label: string;
}

const ColumnPicker: React.FC<ColumnPickerProps> = ({ columns, onSelect, label }) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors">
          <PlusIcon size={12} />
          <span>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[160px] z-[9999]"
          align="start"
          sideOffset={4}
        >
          {columns.map(col => (
            <button
              key={col.id}
              onClick={() => {
                onSelect(col.id);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs text-text-primary',
                'hover:bg-bg-surface transition-colors',
              )}
            >
              {col.name}
              <span className="ml-2 text-text-tertiary">{col.type}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FilterBar;
