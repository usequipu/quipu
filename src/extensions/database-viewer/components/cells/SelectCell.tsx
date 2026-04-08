import React, { useState, useCallback } from 'react';
import { Popover } from 'radix-ui';
import { cn } from '@/lib/utils';
import type { SelectOption } from '../../types';

interface SelectCellProps {
  value: string | null;
  options: SelectOption[];
  onUpdate: (value: string | null) => void;
}

const SelectCell: React.FC<SelectCellProps> = ({ value, options, onUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(o => o.value === value);

  const handleSelect = useCallback((optionValue: string) => {
    onUpdate(optionValue === value ? null : optionValue);
    setIsOpen(false);
  }, [value, onUpdate]);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button className="w-full text-left min-h-[20px] flex items-center">
          {selectedOption ? (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: selectedOption.color }}
            >
              {selectedOption.value}
            </span>
          ) : (
            <span className="text-text-tertiary text-sm" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[160px] z-[9999]"
          align="start"
          sideOffset={4}
        >
          {options.map(option => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
                'hover:bg-bg-surface transition-colors',
                option.value === value && 'bg-bg-surface',
              )}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: option.color }}
              />
              <span className="text-text-primary">{option.value}</span>
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-tertiary">No options defined</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default SelectCell;
