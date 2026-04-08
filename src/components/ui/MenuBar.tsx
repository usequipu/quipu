import React, { useCallback } from 'react';
import { Menubar } from 'radix-ui';
import { CaretRightIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { menus } from '../../data/commands';
import type { MenuItem } from '../../data/commands';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { RecentWorkspace } from '../../types/workspace';

interface MenuBarProps {
  onAction: (action: string) => void;
}

const MenuBar = ({ onAction }: MenuBarProps) => {
  const { recentWorkspaces, selectFolder, clearRecentWorkspaces } = useWorkspace();

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item && 'action' in item && item.action && onAction) {
      onAction(item.action);
    }
  }, [onAction]);

  return (
    <Menubar.Root
      className="flex items-center h-full"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {menus.map((menu) => (
        <Menubar.Menu key={menu.label}>
          <Menubar.Trigger
            className={cn(
              "px-2.5 text-[12.5px] font-normal text-text-secondary cursor-default h-full flex items-center rounded transition-colors",
              "hover:text-text-primary hover:bg-bg-elevated",
              "data-[state=open]:text-text-primary data-[state=open]:bg-bg-elevated",
              "outline-none select-none",
            )}
          >
            {menu.label}
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className="min-w-[220px] bg-bg-elevated border border-border rounded-md py-1 z-[1000] shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)] animate-menu-fade-in"
              align="start"
              sideOffset={0}
              alignOffset={0}
            >
              {menu.items.map((item: MenuItem, i: number) => {
                if (!item) return null;

                if (item.type === 'separator') {
                  return <Menubar.Separator key={i} className="h-px bg-border mx-2 my-1" />;
                }

                if (item.type === 'openRecent') {
                  return (
                    <Menubar.Sub key={i}>
                      <Menubar.SubTrigger className="flex items-center justify-between py-1.5 px-4 cursor-default text-[12.5px] text-text-primary transition-colors hover:bg-accent-muted outline-none data-[state=open]:bg-accent-muted">
                        <span>Open Recent</span>
                        <CaretRightIcon size={10} className="ml-6 text-text-tertiary" />
                      </Menubar.SubTrigger>
                      <Menubar.Portal>
                        <Menubar.SubContent
                          className="min-w-[280px] bg-bg-elevated border border-border rounded-md py-1 z-[1001] shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)]"
                          sideOffset={2}
                          alignOffset={-5}
                        >
                          {recentWorkspaces.length === 0 ? (
                            <Menubar.Item
                              disabled
                              className="py-1.5 px-4 text-[12.5px] text-text-tertiary cursor-default outline-none"
                            >
                              No recent workspaces
                            </Menubar.Item>
                          ) : (
                            recentWorkspaces.map((ws: RecentWorkspace) => (
                              <Menubar.Item
                                key={ws.path}
                                className="flex flex-col py-1.5 px-4 cursor-default hover:bg-accent-muted outline-none data-[highlighted]:bg-accent-muted"
                                onSelect={() => selectFolder(ws.path)}
                              >
                                <span className="text-[12.5px] text-text-primary">{ws.name}</span>
                                <span className="text-[11px] text-text-tertiary truncate max-w-[260px]">{ws.path}</span>
                              </Menubar.Item>
                            ))
                          )}
                          <Menubar.Separator className="h-px bg-border mx-2 my-1" />
                          <Menubar.Item
                            className="py-1.5 px-4 cursor-default text-[12.5px] text-text-primary hover:bg-accent-muted outline-none data-[highlighted]:bg-accent-muted"
                            onSelect={() => clearRecentWorkspaces()}
                          >
                            Clear Recent
                          </Menubar.Item>
                        </Menubar.SubContent>
                      </Menubar.Portal>
                    </Menubar.Sub>
                  );
                }

                // Regular command item
                return (
                  <Menubar.Item
                    key={i}
                    className="flex items-center justify-between py-1.5 px-4 cursor-default text-[12.5px] text-text-primary transition-colors hover:bg-accent-muted outline-none data-[highlighted]:bg-accent-muted"
                    onSelect={() => handleItemClick(item)}
                  >
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <span className="ml-6 text-[11px] text-text-tertiary font-sans">{item.shortcut}</span>
                    )}
                  </Menubar.Item>
                );
              })}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
};

export default MenuBar;
