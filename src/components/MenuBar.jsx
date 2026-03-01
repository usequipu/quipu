import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

const MenuBar = ({ onAction }) => {
  const [openMenu, setOpenMenu] = useState(null);
  const [hovering, setHovering] = useState(false);
  const menuBarRef = useRef(null);

  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New File', shortcut: 'Ctrl+N', action: 'file.new' },
        { label: 'Open Folder', action: 'file.openFolder' },
        { type: 'separator' },
        { label: 'Save', shortcut: 'Ctrl+S', action: 'file.save' },
        { type: 'separator' },
        { label: 'Close Tab', shortcut: 'Ctrl+W', action: 'file.closeTab' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit.undo' },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit.redo' },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', action: 'edit.cut' },
        { label: 'Copy', shortcut: 'Ctrl+C', action: 'edit.copy' },
        { label: 'Paste', shortcut: 'Ctrl+V', action: 'edit.paste' },
        { type: 'separator' },
        { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: 'edit.findInFiles' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: 'view.explorer' },
        { label: 'Search', shortcut: 'Ctrl+Shift+F', action: 'view.search' },
        { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: 'view.git' },
        { type: 'separator' },
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: 'view.toggleSidebar' },
        { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'view.toggleTerminal' },
        { type: 'separator' },
        { label: 'Quick Open', shortcut: 'Ctrl+P', action: 'view.quickOpen' },
      ],
    },
    {
      label: 'Terminal',
      items: [
        { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: 'terminal.toggle' },
        { label: 'Send to Terminal', action: 'terminal.send' },
      ],
    },
  ];

  const handleClickOutside = useCallback((e) => {
    if (menuBarRef.current && !menuBarRef.current.contains(e.target)) {
      setOpenMenu(null);
      setHovering(false);
    }
  }, []);

  useEffect(() => {
    if (openMenu !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu, handleClickOutside]);

  const handleMenuClick = (index) => {
    if (openMenu === index) {
      setOpenMenu(null);
      setHovering(false);
    } else {
      setOpenMenu(index);
      setHovering(true);
    }
  };

  const handleMenuEnter = (index) => {
    if (hovering && openMenu !== null) {
      setOpenMenu(index);
    }
  };

  const handleItemClick = (item) => {
    if (item.action && onAction) {
      onAction(item.action);
    }
    setOpenMenu(null);
    setHovering(false);
  };

  return (
    <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' }} ref={menuBarRef}>
      {menus.map((menu, index) => {
        const isActive = openMenu === index;
        return (
          <div
            key={menu.label}
            className="group relative flex items-center h-full select-none"
            onClick={() => handleMenuClick(index)}
            onMouseEnter={() => handleMenuEnter(index)}
          >
            <span className={cn(
              "px-2.5 text-[12.5px] font-normal text-text-secondary cursor-default h-full flex items-center rounded transition-colors",
              "group-hover:text-text-primary group-hover:bg-bg-elevated",
              isActive && "text-text-primary bg-bg-elevated",
            )}>
              {menu.label}
            </span>
            {isActive && (
              <div className="absolute top-full left-0 min-w-[220px] bg-bg-elevated border border-border rounded-md py-1 z-[1000] shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)] animate-menu-fade-in">
                {menu.items.map((item, i) =>
                  item.type === 'separator' ? (
                    <div key={i} className="h-px bg-border mx-2 my-1" />
                  ) : (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 px-4 cursor-default text-[12.5px] text-text-primary transition-colors hover:bg-accent-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(item);
                      }}
                    >
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut && (
                        <span className="ml-6 text-[11px] text-text-tertiary font-sans">{item.shortcut}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MenuBar;
