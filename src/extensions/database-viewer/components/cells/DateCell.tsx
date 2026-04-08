import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface DateCellProps {
  value: string | null;
  onUpdate: (value: string | null) => void;
}

const DateCell: React.FC<DateCellProps> = ({ value, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value || null;
    onUpdate(newValue);
    setIsEditing(false);
  }, [onUpdate]);

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString()
    : '';

  if (isEditing) {
    return (
      <input
        type="date"
        defaultValue={value ?? ''}
        onChange={handleChange}
        onBlur={() => setIsEditing(false)}
        autoFocus
        className="w-full bg-transparent border-none outline-none text-sm text-text-primary px-0 py-0 focus:ring-1 focus:ring-accent rounded-sm"
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={cn(
        'w-full cursor-text min-h-[20px]',
        !value && 'text-text-tertiary',
      )}
    >
      {displayValue}
    </div>
  );
};

export default DateCell;
