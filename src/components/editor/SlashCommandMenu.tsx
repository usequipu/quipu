import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { cn } from '@/lib/utils';
import type { SlashCommandItem } from './extensions/SlashCommand';

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
      if (menuRef.current) {
        const selected = menuRef.current.querySelector('[data-selected="true"]');
        selected?.scrollIntoView({ block: 'nearest' });
      }
    }, [selectedIndex]);

    const handleSelect = useCallback((index: number) => {
      const item = items[index];
      if (item) command(item);
    }, [items, command]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex(prev => (prev + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          handleSelect(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-bg-overlay border border-border rounded-lg shadow-lg p-3 w-[280px] z-[9999]">
          <p className="text-sm text-page-text/40 text-center">No matching commands</p>
        </div>
      );
    }

    // Group items by category
    const groups = new Map<string, SlashCommandItem[]>();
    for (const item of items) {
      const group = groups.get(item.category) ?? [];
      group.push(item);
      groups.set(item.category, group);
    }

    let globalIndex = 0;

    return (
      <div
        ref={menuRef}
        className="bg-bg-overlay border border-border rounded-lg shadow-lg py-2 w-[280px] max-h-[320px] overflow-y-auto z-[9999]"
      >
        {[...groups.entries()].map(([category, groupItems]) => (
          <div key={category}>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-page-text/30">
              {category}
            </div>
            {groupItems.map((item) => {
              const idx = globalIndex++;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.title}
                  data-selected={isSelected}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors',
                    isSelected ? 'bg-accent/10 text-page-text' : 'text-page-text/70 hover:bg-page-text/[0.04]',
                  )}
                  onClick={() => handleSelect(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className={cn(
                    'w-7 h-7 flex items-center justify-center rounded text-xs font-mono shrink-0',
                    isSelected ? 'bg-accent/20 text-accent' : 'bg-page-text/[0.06] text-page-text/50',
                  )}>
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.title}</div>
                    <div className="text-xs text-page-text/40 truncate">{item.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

SlashCommandMenu.displayName = 'SlashCommandMenu';

export default SlashCommandMenu;
