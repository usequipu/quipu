import React, { useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Select } from 'radix-ui';
import { CaretDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import BoardCard from './BoardCard';
import type {
  DatabaseSchema,
  DatabaseRow,
  ViewConfig,
  SelectColumnDef,
  SelectOption,
  ColumnDef,
} from '../types';

interface BoardViewProps {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  viewConfig: ViewConfig;
  updateCell: (rowId: string, columnId: string, value: unknown) => void;
  addRow: () => void;
  reorderRows: (fromIndex: number, toIndex: number) => void;
  updateViewConfig: (viewId: string, updates: Partial<ViewConfig>) => void;
}

interface Lane {
  id: string;
  label: string;
  color: string;
  rows: DatabaseRow[];
}

const UNCATEGORIZED_ID = '__uncategorized__';

const BoardView: React.FC<BoardViewProps> = ({
  schema,
  rows,
  viewConfig,
  updateCell,
  addRow,
  reorderRows,
  updateViewConfig,
}) => {
  // Find all select columns that can be used for grouping
  const selectColumns = useMemo(
    () => schema.columns.filter(
      (col): col is SelectColumnDef => col.type === 'select'
    ),
    [schema.columns],
  );

  // Resolve which column to group by
  const groupByColumnId = viewConfig.groupByColumnId ?? selectColumns[0]?.id;
  const groupByColumn = selectColumns.find(col => col.id === groupByColumnId);

  // First text column used as card title
  const titleColumnId = useMemo(
    () => schema.columns.find(col => col.type === 'text')?.id,
    [schema.columns],
  );

  // Columns to show on cards (exclude groupBy column)
  const cardColumns = useMemo(
    () => schema.columns.filter(col => col.id !== groupByColumnId),
    [schema.columns, groupByColumnId],
  );

  // Build lanes from the select column's options
  const lanes: Lane[] = useMemo(() => {
    if (!groupByColumn || !groupByColumnId) return [];

    const rowsByValue = new Map<string | null, DatabaseRow[]>();
    // Initialize with option order
    for (const option of groupByColumn.options) {
      rowsByValue.set(option.value, []);
    }
    rowsByValue.set(null, []); // uncategorized

    for (const row of rows) {
      const cellValue = row[groupByColumnId] as string | null | undefined;
      const key = cellValue != null && cellValue !== '' ? cellValue : null;
      const existing = rowsByValue.get(key);
      if (existing) {
        existing.push(row);
      } else {
        // Value not in options — treat as uncategorized
        const uncategorized = rowsByValue.get(null)!;
        uncategorized.push(row);
      }
    }

    const result: Lane[] = groupByColumn.options.map((option: SelectOption) => ({
      id: option.value,
      label: option.value,
      color: option.color,
      rows: rowsByValue.get(option.value) ?? [],
    }));

    const uncategorizedRows = rowsByValue.get(null) ?? [];
    if (uncategorizedRows.length > 0) {
      result.push({
        id: UNCATEGORIZED_ID,
        label: 'Uncategorized',
        color: '#6b7280',
        rows: uncategorizedRows,
      });
    }

    return result;
  }, [groupByColumn, groupByColumnId, rows]);

  // Drag state
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeRow = useMemo(
    () => (activeId ? rows.find(r => r._id === activeId) : undefined),
    [activeId, rows],
  );

  // Find which lane a row belongs to
  const findLaneForRow = useCallback(
    (rowId: string): Lane | undefined => {
      return lanes.find(lane => lane.rows.some(r => r._id === rowId));
    },
    [lanes],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || !groupByColumnId) return;

      const activeRowId = String(active.id);
      const overId = String(over.id);

      // Determine source and target lanes
      const sourceLane = findLaneForRow(activeRowId);
      if (!sourceLane) return;

      // The overId could be a row ID or a lane droppable ID (prefixed with "lane:")
      let targetLane: Lane | undefined;
      if (overId.startsWith('lane:')) {
        const laneId = overId.slice(5);
        targetLane = lanes.find(l => l.id === laneId);
      } else {
        targetLane = findLaneForRow(overId);
      }
      if (!targetLane) return;

      if (sourceLane.id !== targetLane.id) {
        // Moving between lanes: update the cell value
        const newValue = targetLane.id === UNCATEGORIZED_ID ? null : targetLane.id;
        updateCell(activeRowId, groupByColumnId, newValue);
      } else {
        // Reorder within the same lane
        const oldIndex = rows.findIndex(r => r._id === activeRowId);
        const overRowIndex = rows.findIndex(r => r._id === overId);
        if (oldIndex !== -1 && overRowIndex !== -1 && oldIndex !== overRowIndex) {
          reorderRows(oldIndex, overRowIndex);
        }
      }
    },
    [groupByColumnId, lanes, rows, findLaneForRow, updateCell, reorderRows],
  );

  const handleGroupByChange = useCallback(
    (value: string) => {
      updateViewConfig(viewConfig.id, { groupByColumnId: value });
    },
    [viewConfig.id, updateViewConfig],
  );

  // No select columns available
  if (selectColumns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Board view requires at least one Select column to group by.
      </div>
    );
  }

  if (!groupByColumn) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Select a column to group by.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Board toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-elevated">
        <span className="text-xs text-text-tertiary">Group by</span>
        <Select.Root value={groupByColumnId} onValueChange={handleGroupByChange}>
          <Select.Trigger
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded text-xs',
              'bg-bg-surface border border-border text-text-primary',
              'hover:bg-bg-elevated transition-colors',
              'focus:outline-none focus:ring-1 focus:ring-accent',
            )}
          >
            <Select.Value />
            <Select.Icon>
              <CaretDown size={12} weight="bold" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 z-[9999]"
              position="popper"
              sideOffset={4}
            >
              <Select.Viewport>
                {selectColumns.map(col => (
                  <Select.Item
                    key={col.id}
                    value={col.id}
                    className={cn(
                      'px-3 py-1.5 text-xs text-text-primary cursor-pointer',
                      'hover:bg-bg-surface outline-none focus:bg-bg-surface',
                    )}
                  >
                    <Select.ItemText>{col.name}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Board lanes */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 p-4 h-full min-w-min">
            {lanes.map(lane => (
              <BoardLane
                key={lane.id}
                lane={lane}
                columns={cardColumns}
                titleColumnId={titleColumnId}
                onAddRow={addRow}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeRow ? (
              <div className="opacity-90 rotate-2 pointer-events-none">
                <BoardCard
                  row={activeRow}
                  columns={cardColumns}
                  titleColumnId={titleColumnId}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
};

// --- Lane sub-component ---

interface BoardLaneProps {
  lane: Lane;
  columns: ColumnDef[];
  titleColumnId: string | undefined;
  onAddRow: () => void;
}

const BoardLane: React.FC<BoardLaneProps> = ({
  lane,
  columns,
  titleColumnId,
  onAddRow,
}) => {
  const rowIds = useMemo(() => lane.rows.map(r => r._id), [lane.rows]);
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane.id}` });

  return (
    <div className={cn(
      'flex flex-col w-64 shrink-0 bg-bg-base rounded-lg border overflow-hidden',
      isOver ? 'border-accent/60 bg-accent/5' : 'border-border/50',
    )}>
      {/* Lane header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-bg-elevated border-b border-border/50">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: lane.color }}
        />
        <span className="text-sm font-medium text-text-primary truncate">
          {lane.label}
        </span>
        <span className="text-xs text-text-tertiary ml-auto">
          {lane.rows.length}
        </span>
      </div>

      {/* Lane body */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-[60px]">
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          {lane.rows.map(row => (
            <BoardCard
              key={row._id}
              row={row}
              columns={columns}
              titleColumnId={titleColumnId}
            />
          ))}
        </SortableContext>

        {lane.rows.length === 0 && (
          <div className="text-xs text-text-tertiary text-center py-4">
            No items
          </div>
        )}
      </div>

      {/* Add card button */}
      <button
        onClick={onAddRow}
        className={cn(
          'shrink-0 text-left px-3 py-2 text-xs text-text-tertiary',
          'hover:bg-bg-surface/50 hover:text-text-secondary transition-colors',
          'border-t border-border/30',
        )}
      >
        + New
      </button>
    </div>
  );
};

export default BoardView;
