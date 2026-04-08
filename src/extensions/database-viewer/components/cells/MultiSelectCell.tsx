import React, { useState, useCallback } from 'react';
import { Popover } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { SelectOption } from '../../types';

interface MultiSelectCellProps {
  value: string[] | null;
  options: SelectOption[];
  onUpdate: (value: string[]) => void;
}

const MultiSelectCell: React.FC<MultiSelectCellProps> = ({ value, options, onUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = value ?? [];

  const handleToggle = useCallback((optionValue: string) => {
    const next = selected.includes(optionValue)
      ? selected.filter(v => v !== optionValue)
      : [...selected, optionValue];
    onUpdate(next);
  }, [selected, onUpdate]);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button className="w-full text-left min-h-[20px] flex items-center gap-1 flex-wrap">
          {selected.length > 0 ? (
            selected.map(val => {
              const opt = options.find(o => o.value === val);
              return (
                <span
                  key={val}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: opt?.color ?? '#6b7280' }}
                >
                  {val}
                </span>
              );
            })
          ) : (
            <span className="text-text-tertiary text-sm" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[180px] z-[9999]"
          align="start"
          sideOffset={4}
        >
          {options.map(option => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                onClick={() => handleToggle(option.value)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
                  'hover:bg-bg-surface transition-colors',
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    isSelected ? 'bg-accent border-accent text-white' : 'border-border',
                  )}
                >
                  {isSelected && <CheckIcon size={10} weight="bold" />}
                </span>
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: option.color }}
                />
                <span className="text-text-primary">{option.value}</span>
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-tertiary">No options defined</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default MultiSelectCell;
