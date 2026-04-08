import React, { useState, useCallback } from 'react';
import { Dialog, Popover, Select as RadixSelect } from 'radix-ui';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ColumnDef, ColumnType, SelectOption } from '../types';
import { SELECT_COLORS } from '../types';

interface AddColumnDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (colDef: ColumnDef) => void;
  existingIds: string[];
}

const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi-select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
];

function toColumnId(name: string, existingIds: string[]): string {
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!id) id = 'column';
  let candidate = id;
  let counter = 1;
  while (existingIds.includes(candidate)) {
    candidate = `${id}_${counter}`;
    counter++;
  }
  return candidate;
}

export function AddColumnDialog({ isOpen, onClose, onAdd, existingIds }: AddColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [newOptionValue, setNewOptionValue] = useState('');

  const isSelectType = type === 'select' || type === 'multi-select';

  const handleAdd = useCallback(() => {
    if (!name.trim()) return;
    const id = toColumnId(name, existingIds);
    const colDef = {
      id,
      name: name.trim(),
      type,
      ...(isSelectType ? { options } : {}),
    } as ColumnDef;
    onAdd(colDef);
    setName('');
    setType('text');
    setOptions([]);
    onClose();
  }, [name, type, options, isSelectType, existingIds, onAdd, onClose]);

  const handleAddOption = useCallback(() => {
    if (!newOptionValue.trim()) return;
    const color = SELECT_COLORS[options.length % SELECT_COLORS.length];
    setOptions(prev => [...prev, { value: newOptionValue.trim(), color }]);
    setNewOptionValue('');
  }, [newOptionValue, options.length]);

  const handleRemoveOption = useCallback((index: number) => {
    setOptions(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isSelectType && newOptionValue.trim()) {
        handleAddOption();
      } else {
        handleAdd();
      }
    }
  }, [isSelectType, newOptionValue, handleAddOption, handleAdd]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/35 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-lg p-5 w-[380px] z-[9999]">
          <Dialog.Title className="text-sm font-medium text-text-primary mb-4">Add Column</Dialog.Title>

          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Name</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Column name"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-text-secondary mb-1 block">Type</label>
              <RadixSelect.Root value={type} onValueChange={v => setType(v as ColumnType)}>
                <RadixSelect.Trigger className="w-full flex items-center justify-between px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary">
                  <RadixSelect.Value />
                  <RadixSelect.Icon />
                </RadixSelect.Trigger>
                <RadixSelect.Portal>
                  <RadixSelect.Content className="bg-bg-overlay border border-border rounded-md shadow-lg z-[10000]">
                    <RadixSelect.Viewport>
                      {COLUMN_TYPES.map(ct => (
                        <RadixSelect.Item
                          key={ct.value}
                          value={ct.value}
                          className="px-3 py-2 text-sm text-text-primary hover:bg-bg-surface cursor-pointer outline-none data-[highlighted]:bg-bg-surface"
                        >
                          <RadixSelect.ItemText>{ct.label}</RadixSelect.ItemText>
                        </RadixSelect.Item>
                      ))}
                    </RadixSelect.Viewport>
                  </RadixSelect.Content>
                </RadixSelect.Portal>
              </RadixSelect.Root>
            </div>

            {isSelectType && (
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Options</label>
                <div className="flex flex-col gap-1 mb-2">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: opt.color }}
                      />
                      <span className="text-sm text-text-primary flex-1">{opt.value}</span>
                      <button
                        onClick={() => handleRemoveOption(i)}
                        className="text-text-tertiary hover:text-text-secondary p-0.5"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newOptionValue}
                    onChange={e => setNewOptionValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddOption();
                      }
                    }}
                    placeholder="Add option..."
                    className="flex-1"
                  />
                  <Button variant="secondary" size="sm" onClick={handleAddOption}>
                    <PlusIcon size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!name.trim()}>
              Add Column
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ColumnHeaderMenuProps {
  columnId: string;
  columnName: string;
  onRename: (columnId: string, newName: string) => void;
  onDelete: (columnId: string) => void;
  onChangeType: (columnId: string, newType: ColumnType) => void;
  currentType: ColumnType;
}

export function ColumnHeaderMenu({ columnId, columnName, onRename, onDelete, onChangeType, currentType }: ColumnHeaderMenuProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(columnName);

  const handleRenameSubmit = useCallback(() => {
    if (renameValue.trim() && renameValue !== columnName) {
      onRename(columnId, renameValue.trim());
    }
    setIsRenaming(false);
  }, [renameValue, columnName, columnId, onRename]);

  if (isRenaming) {
    return (
      <input
        autoFocus
        value={renameValue}
        onChange={e => setRenameValue(e.target.value)}
        onBlur={handleRenameSubmit}
        onKeyDown={e => {
          if (e.key === 'Enter') handleRenameSubmit();
          if (e.key === 'Escape') setIsRenaming(false);
        }}
        className="bg-transparent border-none outline-none text-xs font-medium uppercase tracking-wide text-text-secondary w-full focus:ring-1 focus:ring-accent rounded-sm"
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="text-left truncate flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenameValue(columnName);
            setIsRenaming(true);
          }}
        >
          {columnName}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-overlay border border-border rounded-md shadow-lg py-1 min-w-[160px] z-[9999]"
          align="start"
          sideOffset={4}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-surface"
            onClick={() => {
              setRenameValue(columnName);
              setIsRenaming(true);
            }}
          >
            Rename
          </button>
          <div className="px-3 py-1.5">
            <span className="text-xs text-text-tertiary block mb-1">Change type</span>
            {COLUMN_TYPES.filter(ct => ct.value !== currentType).map(ct => (
              <button
                key={ct.value}
                className="w-full text-left px-2 py-1 text-sm text-text-secondary hover:bg-bg-surface rounded"
                onClick={() => onChangeType(columnId, ct.value)}
              >
                {ct.label}
              </button>
            ))}
          </div>
          <div className="h-px bg-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-error hover:bg-error/10"
            onClick={() => onDelete(columnId)}
          >
            Delete column
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
