import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface NumberCellProps {
  value: number | null;
  onUpdate: (value: number | null) => void;
}

const NumberCell: React.FC<NumberCellProps> = ({ value, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(() => {
    setEditValue(value != null ? String(value) : '');
    setIsEditing(true);
  }, [value]);

  const handleCommit = useCallback(() => {
    setIsEditing(false);
    if (editValue.trim() === '') {
      if (value != null) onUpdate(null);
      return;
    }
    const num = Number(editValue);
    if (!isNaN(num) && num !== value) {
      onUpdate(num);
    }
  }, [editValue, value, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCommit();
    else if (e.key === 'Escape') setIsEditing(false);
  }, [handleCommit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent border-none outline-none text-sm text-text-primary px-0 py-0 text-right focus:ring-1 focus:ring-accent rounded-sm"
      />
    );
  }

  return (
    <div
      onClick={handleStartEdit}
      className={cn(
        'w-full cursor-text text-right min-h-[20px]',
        value == null && 'text-text-tertiary',
      )}
    >
      {value != null ? value.toLocaleString() : ''}
    </div>
  );
};

export default NumberCell;
