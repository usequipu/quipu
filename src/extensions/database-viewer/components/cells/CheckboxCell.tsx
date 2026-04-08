import React, { useCallback } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface CheckboxCellProps {
  value: boolean;
  onUpdate: (value: boolean) => void;
}

const CheckboxCell: React.FC<CheckboxCellProps> = ({ value, onUpdate }) => {
  const handleToggle = useCallback(() => {
    onUpdate(!value);
  }, [value, onUpdate]);

  return (
    <button
      onClick={handleToggle}
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center transition-colors',
        value
          ? 'bg-accent border-accent text-white'
          : 'border-border hover:border-accent/50',
      )}
    >
      {value && <CheckIcon size={12} weight="bold" />}
    </button>
  );
};

export default CheckboxCell;
