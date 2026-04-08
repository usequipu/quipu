import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { DatabaseRow, ColumnDef, SelectOption } from '../types';

interface BoardCardProps {
  row: DatabaseRow;
  columns: ColumnDef[];
  titleColumnId: string | undefined;
}

function formatCellValue(value: unknown, column: ColumnDef): React.ReactNode {
  if (value == null || value === '') return null;

  switch (column.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'select': {
      const option = column.options.find((o: SelectOption) => o.value === value);
      if (!option) return String(value);
      return (
        <span
          className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium text-white leading-4"
          style={{ backgroundColor: option.color }}
        >
          {option.value}
        </span>
      );
    }
    case 'multi-select': {
      const values = Array.isArray(value) ? value : [];
      return (
        <span className="flex flex-wrap gap-0.5">
          {values.map((v: string) => {
            const opt = column.options.find((o: SelectOption) => o.value === v);
            return (
              <span
                key={v}
                className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium text-white leading-4"
                style={{ backgroundColor: opt?.color ?? '#6b7280' }}
              >
                {v}
              </span>
            );
          })}
        </span>
      );
    }
    case 'date':
      return String(value);
    case 'number':
      return String(value);
    default:
      return String(value);
  }
}

const BoardCard: React.FC<BoardCardProps> = ({ row, columns, titleColumnId }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row._id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const titleValue = titleColumnId ? row[titleColumnId] : undefined;
  const titleText = titleValue != null && titleValue !== '' ? String(titleValue) : 'Untitled';

  // Secondary columns: visible columns excluding the title column and the groupBy column
  // (groupBy is excluded by the parent, so we just exclude titleColumnId here)
  const secondaryColumns = columns.filter(col => col.id !== titleColumnId);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'bg-bg-surface border border-border rounded-md p-3 shadow-sm',
        'cursor-grab active:cursor-grabbing',
        'hover:border-accent/40 transition-colors',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-accent/30',
      )}
    >
      {/* Title */}
      <div className="text-sm font-medium text-text-primary truncate mb-1">
        {titleText}
      </div>

      {/* Secondary fields */}
      {secondaryColumns.length > 0 && (
        <div className="flex flex-col gap-1">
          {secondaryColumns.map(col => {
            const cellValue = row[col.id];
            const formatted = formatCellValue(cellValue, col);
            if (formatted == null) return null;
            return (
              <div key={col.id} className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] text-text-tertiary uppercase tracking-wide shrink-0">
                  {col.name}
                </span>
                <span className="text-xs text-text-secondary truncate">
                  {formatted}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BoardCard;
