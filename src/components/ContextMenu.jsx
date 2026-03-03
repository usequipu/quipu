import React, { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * A reusable context menu component that renders a list of menu items
 * at the specified position. Supports separators, keyboard shortcut hints,
 * and auto-dismisses on click outside or Escape.
 *
 * @param {Object} props
 * @param {Array} props.items - Menu items, each: { label, shortcut?, onClick, danger?, disabled? } or { separator: true }
 * @param {{ x: number, y: number }} props.position - Screen position
 * @param {Function} props.onClose - Called when the menu should close
 */
export default function ContextMenu({ items, position, onClose }) {
  const menuRef = useRef(null);

  // Clamp position to viewport so the menu doesn't overflow offscreen
  const getClampedPosition = useCallback(() => {
    if (!menuRef.current) return position;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > vw) {
      x = vw - rect.width - 4;
    }
    if (y + rect.height > vh) {
      y = vh - rect.height - 4;
    }
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    return { x, y };
  }, [position]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Use mousedown so the menu closes before the click bubbles
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Clamp after mount and on resize
  useEffect(() => {
    if (!menuRef.current) return;
    const clamped = getClampedPosition();
    menuRef.current.style.left = `${clamped.x}px`;
    menuRef.current.style.top = `${clamped.y}px`;
  }, [getClampedPosition]);

  if (!items || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed bg-bg-elevated border border-border rounded-md shadow-lg py-1 min-w-[180px] z-[9999]",
        "animate-menu-fade-in",
      )}
      style={{
        top: position.y,
        left: position.x,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} className="h-px bg-border my-1" />;
        }

        return (
          <div
            key={`${item.label}-${index}`}
            className={cn(
              "flex items-center justify-between py-1.5 px-4 cursor-pointer text-[13px] text-text-secondary",
              "transition-colors",
              item.disabled
                ? "opacity-40 cursor-default"
                : item.danger
                  ? "hover:bg-error hover:text-white"
                  : "hover:bg-accent hover:text-white",
            )}
            onClick={(e) => {
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
