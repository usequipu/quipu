import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { menus } from '../data/commands';
import { useWorkspace } from '../context/WorkspaceContext';

const MenuBar = ({ onAction }) => {
  const { recentWorkspaces, selectFolder, clearRecentWorkspaces } = useWorkspace();
  const [openMenu, setOpenMenu] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const menuBarRef = useRef(null);
  const submenuTimerRef = useRef(null);

  const handleClickOutside = useCallback((e) => {
    if (menuBarRef.current && !menuBarRef.current.contains(e.target)) {
      setOpenMenu(null);
      setHovering(false);
      setOpenSubmenu(null);
    }
  }, []);

  useEffect(() => {
    if (openMenu !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu, handleClickOutside]);

  useEffect(() => {
    setOpenSubmenu(null);
  }, [openMenu]);

  useEffect(() => {
    return () => clearTimeout(submenuTimerRef.current);
  }, []);

  const closeAll = useCallback(() => {
    clearTimeout(submenuTimerRef.current);
    setOpenMenu(null);
    setHovering(false);
    setOpenSubmenu(null);
  }, []);

  const handleMenuClick = (index) => {
    if (openMenu === index) {
      closeAll();
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
    closeAll();
  };

  const handleSubmenuEnter = (i) => {
    clearTimeout(submenuTimerRef.current);
    setOpenSubmenu(i);
  };

  const handleSubmenuLeave = () => {
    submenuTimerRef.current = setTimeout(() => setOpenSubmenu(null), 150);
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
                  ) : item.type === 'openRecent' ? (
                    <div
                      key={i}
                      className="relative flex items-center justify-between py-1.5 px-4 cursor-default text-[12.5px] text-text-primary transition-colors hover:bg-accent-muted"
                      onMouseEnter={() => handleSubmenuEnter(i)}
                      onMouseLeave={handleSubmenuLeave}
                    >
                      <span>Open Recent</span>
                      <CaretRight size={10} className="ml-6 text-text-tertiary" />
                      {openSubmenu === i && (
                        <div
                          className="absolute left-full top-0 min-w-[280px] bg-bg-elevated border border-border rounded-md py-1 z-[1001] shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)]"
                          onMouseEnter={() => handleSubmenuEnter(i)}
                          onMouseLeave={handleSubmenuLeave}
                        >
                          {recentWorkspaces.length === 0 ? (
                            <div className="py-1.5 px-4 text-[12.5px] text-text-tertiary cursor-default">No recent workspaces</div>
                          ) : (
                            recentWorkspaces.map(ws => (
                              <div
                                key={ws.path}
                                className="flex flex-col py-1.5 px-4 cursor-default hover:bg-accent-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectFolder(ws.path);
                                  closeAll();
                                }}
                              >
                                <span className="text-[12.5px] text-text-primary">{ws.name}</span>
                                <span className="text-[11px] text-text-tertiary truncate max-w-[260px]">{ws.path}</span>
                              </div>
                            ))
                          )}
                          <div className="h-px bg-border mx-2 my-1" />
                          <div
                            className="py-1.5 px-4 cursor-default text-[12.5px] text-text-primary hover:bg-accent-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearRecentWorkspaces();
                              closeAll();
                            }}
                          >
                            Clear Recent
                          </div>
                        </div>
                      )}
                    </div>
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
