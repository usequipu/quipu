import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface TextCellProps {
  value: string | null;
  onUpdate: (value: string) => void;
}

const TextCell: React.FC<TextCellProps> = ({ value, onUpdate }) => {
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
    setEditValue(value ?? '');
    setIsEditing(true);
  }, [value]);

  const handleCommit = useCallback(() => {
    setIsEditing(false);
    if (editValue !== (value ?? '')) {
      onUpdate(editValue);
    }
  }, [editValue, value, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCommit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  }, [handleCommit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent border-none outline-none text-sm text-text-primary px-0 py-0 focus:ring-1 focus:ring-accent rounded-sm"
      />
    );
  }

  return (
    <div
      onClick={handleStartEdit}
      className={cn(
        'w-full cursor-text truncate min-h-[20px]',
        !value && 'text-text-tertiary',
      )}
    >
      {value || ''}
    </div>
  );
};

export default TextCell;
