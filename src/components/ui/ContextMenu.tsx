import React, { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

export interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Imperative context menu rendered at a given {x, y} position.
 *
 * We intentionally keep the hand-rolled approach here because the app uses an
 * imperative pattern: state is set with `{ x, y, items }` from global
 * `contextmenu` event handlers. Radix ContextMenu requires wrapping a
 * declarative trigger element, which would mean rewriting every call-site.
 *
 * The menu provides: viewport clamping, click-outside dismiss, Escape dismiss,
 * keyboard arrow navigation, and focus management.
 */
export default function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number>(-1);

  // Collect non-separator item indices for keyboard navigation
  const actionableIndices = items.reduce<number[]>((acc, item, i) => {
    if (!item.separator) acc.push(i);
    return acc;
  }, []);

  // Clamp position to viewport so the menu doesn't overflow offscreen
  const getClampedPosition = useCallback((): { x: number; y: number } => {
    if (!menuRef.current) return position;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    return { x, y };
  }, [position]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Keyboard handling: Escape, Arrow keys, Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentPos = actionableIndices.indexOf(focusedIndexRef.current);
        const nextPos = currentPos < actionableIndices.length - 1 ? currentPos + 1 : 0;
        focusedIndexRef.current = actionableIndices[nextPos];
        focusItem(focusedIndexRef.current);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentPos = actionableIndices.indexOf(focusedIndexRef.current);
        const nextPos = currentPos > 0 ? currentPos - 1 : actionableIndices.length - 1;
        focusedIndexRef.current = actionableIndices[nextPos];
        focusItem(focusedIndexRef.current);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[focusedIndexRef.current];
        if (item && !item.separator && !item.disabled && item.onClick) {
          item.onClick();
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, items, actionableIndices]);

  const focusItem = (index: number) => {
    if (!menuRef.current) return;
    const el = menuRef.current.querySelector(`[data-menu-index="${index}"]`) as HTMLElement | null;
    el?.focus();
  };

  // Clamp after mount and on resize
  useEffect(() => {
    if (!menuRef.current) return;
    const clamped = getClampedPosition();
    menuRef.current.style.left = `${clamped.x}px`;
    menuRef.current.style.top = `${clamped.y}px`;
  }, [getClampedPosition]);

  // Focus the menu container on mount for keyboard accessibility
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className={cn(
        "fixed bg-bg-elevated border border-border rounded-md shadow-lg py-1 min-w-[180px] z-[9999]",
        "animate-menu-fade-in outline-none",
      )}
      style={{
        top: position.y,
        left: position.x,
      }}
      onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} role="separator" className="h-px bg-border my-1" />;
        }

        return (
          <div
            key={`${item.label}-${index}`}
            role="menuitem"
            tabIndex={-1}
            data-menu-index={index}
            aria-disabled={item.disabled || undefined}
            className={cn(
              "flex items-center justify-between py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary",
              "transition-colors outline-none",
              item.disabled
                ? "opacity-40 cursor-default"
                : item.danger
                  ? "hover:bg-error hover:text-white focus:bg-error focus:text-white"
                  : "hover:bg-accent hover:text-white focus:bg-accent focus:text-white",
            )}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-[11px] text-text-tertiary ml-6">{item.shortcut}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
