import React, { useState, useCallback } from 'react';
import { Popover } from 'radix-ui';
import { FolderIcon, CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react';
import { useFileSystem } from '../../context/FileSystemContext';
import { executeCommand } from '../../extensions/commandRegistry';
import { cn } from '@/lib/utils';

/**
 * Dropdown that lives at the top of the file explorer panel. Shows the
 * current workspace name on its trigger, and on click opens a popover
 * listing all known recent workspaces (active one carries an animated
 * checkmark) plus the standard `Open Folder…` / `New Window` actions.
 *
 * Phase 2 of the visual overhaul. Replaces the old folder-name +
 * refresh-icon header. The refresh affordance still lives in
 * `FileExplorer.tsx`, just to the right of this switcher.
 */
const WorkspaceSwitcher: React.FC = () => {
  const { workspacePath, recentWorkspaces, selectFolder, openFolder } = useFileSystem();
  const [isOpen, setIsOpen] = useState(false);
  // Track which workspace path the user just clicked. The animated
  // checkmark moves to this row visually before the underlying
  // `selectFolder` finishes loading the new workspace.
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const currentName = workspacePath?.split('/').pop() ?? 'No workspace';

  const handlePick = useCallback(async (path: string) => {
    if (path === workspacePath) {
      setIsOpen(false);
      return;
    }
    setPendingPath(path);
    // Close after the ~200ms checkmark animation so the user sees the
    // glide before the panel disappears.
    window.setTimeout(() => {
      setIsOpen(false);
      setPendingPath(null);
      selectFolder(path);
    }, 220);
  }, [workspacePath, selectFolder]);

  const handleOpenFolder = useCallback(() => {
    setIsOpen(false);
    openFolder();
  }, [openFolder]);

  const handleNewWindow = useCallback(() => {
    setIsOpen(false);
    executeCommand('workspace.newWindow');
  }, []);

  // Which row should currently carry the checkmark — pending click wins
  // over the persisted workspacePath so the animation glides cleanly.
  const checkedPath = pendingPath ?? workspacePath;

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 h-7 px-2 -mx-1 rounded hover:bg-bg-elevated transition-colors text-left"
          aria-label="Switch workspace"
          title="Switch workspace"
        >
          <div className="w-5 h-5 rounded bg-accent/15 flex items-center justify-center shrink-0">
            <FolderIcon size={12} className="text-accent" />
          </div>
          <span className="flex-1 min-w-0 text-[13px] font-medium text-text-primary truncate">
            {currentName}
          </span>
          <CaretDownIcon size={10} className="text-text-tertiary shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-bg-elevated border border-border rounded-md shadow-lg py-1 min-w-[240px] max-w-[360px] z-[9999]"
          align="start"
          sideOffset={6}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
            Workspaces
          </div>
          <div className="max-h-72 overflow-y-auto">
            {recentWorkspaces.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-text-tertiary italic">
                No recent workspaces
              </div>
            )}
            {recentWorkspaces.map((ws) => {
              const isChecked = ws.path === checkedPath;
              return (
                <button
                  key={ws.path}
                  type="button"
                  onClick={() => handlePick(ws.path)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-primary',
                    'hover:bg-bg-overlay cursor-pointer text-left',
                  )}
                  title={ws.path}
                >
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    <CheckIcon
                      size={12}
                      weight="bold"
                      className={cn(
                        'text-accent transition-opacity duration-200',
                        isChecked ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </div>
                  <span className="flex-1 min-w-0 truncate">{ws.name}</span>
                </button>
              );
            })}
          </div>
          <div className="h-px bg-border my-1" />
          <button
            type="button"
            onClick={handleOpenFolder}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-primary hover:bg-bg-overlay cursor-pointer text-left"
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <FolderIcon size={12} className="text-text-tertiary" />
            </div>
            <span>Open Folder…</span>
          </button>
          <button
            type="button"
            onClick={handleNewWindow}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-primary hover:bg-bg-overlay cursor-pointer text-left"
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <PlusIcon size={12} className="text-text-tertiary" />
            </div>
            <span>New Window</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default WorkspaceSwitcher;
