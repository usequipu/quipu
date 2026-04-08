import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CaretRightIcon, CaretDownIcon, FileIcon as PhFileIcon, FolderIcon, FolderOpenIcon,
  NotebookIcon, FileJsIcon, FileJsxIcon, FileCssIcon, FileHtmlIcon,
  FileCodeIcon, FileMdIcon, FileTextIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useFileSystem } from '../../context/FileSystemContext';
import { useTab } from '../../context/TabContext';
import ContextMenu from './ContextMenu';
import type { FileTreeEntry } from '../../types/workspace';

type PhosphorIconComponent = typeof PhFileIcon;

interface ContextMenuPosition {
  x: number;
  y: number;
}

type CreatingType = 'file' | 'folder' | 'database' | null;

interface FileIconComponentProps {
  name: string;
  isDirectory: boolean;
  isExpanded: boolean;
  isDirty: boolean;
}

interface FileTreeItemProps {
  entry: FileTreeEntry;
  depth?: number;
}

function getFileIcon(name: string): PhosphorIconComponent {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  switch (ext) {
    case 'js': return FileJsIcon;
    case 'jsx': return FileJsxIcon;
    case 'css': return FileCssIcon;
    case 'html': return FileHtmlIcon;
    case 'json': case 'go': case 'ts': case 'tsx': return FileCodeIcon;
    case 'md': case 'markdown': return FileMdIcon;
    case 'quipu': return NotebookIcon;
    case 'txt': return FileTextIcon;
    default: return PhFileIcon;
  }
}

function FileIconComponent({ name, isDirectory, isExpanded, isDirty }: FileIconComponentProps) {
  if (isDirectory) {
    return isExpanded
      ? <FolderOpenIcon size={16} className="shrink-0" />
      : <FolderIcon size={16} className="shrink-0" />;
  }
  const Icon = getFileIcon(name);
  return (
    <div className="relative shrink-0 w-4 h-4 flex items-center justify-center">
      <Icon size={16} />
      {isDirty && (
        <span className="absolute -top-0.5 -right-0.5 w-[6px] h-[6px] rounded-full bg-accent" />
      )}
    </div>
  );
}

function FileTreeItem({ entry, depth = 0 }: FileTreeItemProps) {
  const {
    expandedFolders,
    toggleFolder,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    directoryVersion,
  } = useFileSystem();
  const {
    activeFile,
    openFile,
    openTabs,
  } = useTab();

  const [children, setChildren] = useState<FileTreeEntry[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [renameValue, setRenameValue] = useState<string>('');
  const [isCreating, setIsCreating] = useState<CreatingType>(null);
  const [createValue, setCreateValue] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);

  // Listen for drag-end cleanup event to clear stuck highlights
  useEffect(() => {
    const handleDragCleanup = () => setIsDragOver(false);
    document.addEventListener('quipu-drag-end', handleDragCleanup);
    return () => document.removeEventListener('quipu-drag-end', handleDragCleanup);
  }, []);

  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFile && activeFile.path === entry.path;
  const isDirtyFile = !entry.isDirectory && openTabs.some((t: { path: string; isDirty: boolean }) => t.path === entry.path && t.isDirty);

  useEffect(() => {
    if (entry.isDirectory && isExpanded) {
      loadSubDirectory(entry.path).then(setChildren);
    }
  }, [entry.path, entry.isDirectory, isExpanded, loadSubDirectory, directoryVersion]);

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (isCreating && createRef.current) {
      createRef.current.focus();
    }
  }, [isCreating]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      toggleFolder(entry.path);
    } else {
      openFile(entry.path, entry.name);
    }
  }, [entry, toggleFolder, openFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRenameStart = useCallback(() => {
    setRenameValue(entry.name);
    setIsRenaming(true);
    closeContextMenu();
  }, [entry.name, closeContextMenu]);

  const handleRenameSubmit = useCallback(() => {
    if (renameValue && renameValue !== entry.name) {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      renameEntry(entry.path, parentPath + '/' + renameValue);
    }
    setIsRenaming(false);
  }, [renameValue, entry, renameEntry]);

  const handleDelete = useCallback(() => {
    closeContextMenu();
    if (window.confirm(`Delete "${entry.name}"?`)) {
      deleteEntry(entry.path);
    }
  }, [entry, deleteEntry, closeContextMenu]);

  const handleNewFile = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('file');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleNewFolder = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('folder');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleNewDatabase = useCallback(() => {
    closeContextMenu();
    if (entry.isDirectory) {
      if (!isExpanded) toggleFolder(entry.path);
      setIsCreating('database');
      setCreateValue('untitled.quipudb.jsonl');
    }
  }, [entry, isExpanded, toggleFolder, closeContextMenu]);

  const handleCreateSubmit = useCallback(async () => {
    if (createValue) {
      if (isCreating === 'database') {
        // Create file with initial database schema
        await createNewFile(entry.path, createValue);
        const filePath = entry.path + '/' + createValue;
        // Write initial database content
        const { createEmptyDatabase } = await import('../../extensions/database-viewer/utils/jsonl');
        const name = createValue.replace('.quipudb.jsonl', '') || 'Untitled Database';
        const initialContent = createEmptyDatabase(name.charAt(0).toUpperCase() + name.slice(1));
        const fs = (await import('../../services/fileSystem')).default;
        await fs.writeFile(filePath, initialContent);
        openFile(filePath, createValue);
      } else if (isCreating === 'file') {
        await createNewFile(entry.path, createValue);
      } else {
        await createNewFolder(entry.path, createValue);
      }
    }
    setIsCreating(null);
    setCreateValue('');
  }, [createValue, isCreating, entry.path, createNewFile, createNewFolder, openFile]);

  // Build context menu items for this entry
  const contextMenuItems = useCallback(() => {
    const items: Array<{ label?: string; onClick?: () => void; separator?: boolean; danger?: boolean }> = [];

    // Copy name to clipboard
    items.push({
      label: 'Copy Name',
      onClick: () => {
        navigator.clipboard.writeText(entry.name);
      },
    });

    items.push({
      label: 'Copy Path',
      onClick: () => {
        navigator.clipboard.writeText(entry.path);
      },
    });

    items.push({ separator: true });

    if (entry.isDirectory) {
      items.push({
        label: 'New File',
        onClick: handleNewFile,
      });
      items.push({
        label: 'New Folder',
        onClick: handleNewFolder,
      });
      items.push({
        label: 'New Database',
        onClick: handleNewDatabase,
      });
      items.push({ separator: true });
    }

    items.push({
      label: 'Rename',
      onClick: handleRenameStart,
    });
    items.push({
      label: 'Delete',
      onClick: handleDelete,
      danger: true,
    });

    return items;
  }, [entry, handleNewFile, handleNewFolder, handleNewDatabase, handleRenameStart, handleDelete]);

  // --- Drag and drop ---
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'move';
  }, [entry.path]);

  const handleDragEnd = useCallback(() => {
    setIsDragOver(false);
    document.dispatchEvent(new CustomEvent('quipu-drag-end'));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!entry.isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }, [entry.isDirectory]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!entry.isDirectory) return;

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath || sourcePath === entry.path) return;

    // Don't drop into own subtree
    if (entry.path.startsWith(sourcePath + '/')) return;

    const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
    const newPath = entry.path + '/' + fileName;
    if (newPath === sourcePath) return;

    renameEntry(sourcePath, newPath);
  }, [entry.path, entry.isDirectory, renameEntry]);

  return (
    <div className="relative" data-context="file-tree-item">
      <div
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden",
          "hover:bg-white/[0.06]",
          isActive && "bg-white/10",
          isDragOver && "bg-accent/20 outline outline-1 outline-accent/50",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {entry.isDirectory ? (
          isExpanded
            ? <CaretDownIcon size={14} className="shrink-0 text-text-tertiary" />
            : <CaretRightIcon size={14} className="shrink-0 text-text-tertiary" />
        ) : (
          <span className="shrink-0 w-[14px]" />
        )}
        <FileIconComponent name={entry.name} isDirectory={entry.isDirectory} isExpanded={isExpanded} isDirty={isDirtyFile} />
        {isRenaming ? (
          <input
            ref={renameRef}
            className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
            value={renameValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        ) : (
          <span className="overflow-hidden text-ellipsis flex-1 leading-[22px]">{entry.name}</span>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          items={contextMenuItems()}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
        />
      )}

      {entry.isDirectory && isExpanded && (
        <div>
          {isCreating && (
            <div className="flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>
              <span className="shrink-0 w-[14px]" />
              {isCreating === 'folder' ? <FolderIcon size={16} className="shrink-0" /> : <PhFileIcon size={16} className="shrink-0" />}
              <input
                ref={createRef}
                className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
                value={createValue}
                placeholder={isCreating === 'file' ? 'filename' : 'folder name'}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateValue(e.target.value)}
                onBlur={handleCreateSubmit}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') handleCreateSubmit();
                  if (e.key === 'Escape') { setIsCreating(null); setCreateValue(''); }
                }}
              />
            </div>
          )}
          {(children || []).map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer() {
  const { workspacePath, fileTree, openFolder, refreshDirectory, renameEntry, createNewFile, createNewFolder } = useFileSystem();
  const { openFile } = useTab();
  const [isRootDragOver, setIsRootDragOver] = useState<boolean>(false);
  const [rootContextMenu, setRootContextMenu] = useState<ContextMenuPosition | null>(null);
  const [isRootCreating, setIsRootCreating] = useState<CreatingType>(null);
  const [rootCreateValue, setRootCreateValue] = useState<string>('');
  const rootCreateRef = useRef<HTMLInputElement | null>(null);

  // Document-level dragend listener to clear all stuck drag highlights
  useEffect(() => {
    const handleDragEnd = () => {
      setIsRootDragOver(false);
      document.dispatchEvent(new CustomEvent('quipu-drag-end'));
    };
    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);

  useEffect(() => {
    if (isRootCreating && rootCreateRef.current) {
      rootCreateRef.current.focus();
    }
  }, [isRootCreating]);

  const handleRefresh = useCallback(() => {
    if (workspacePath) {
      refreshDirectory(workspacePath);
    }
  }, [workspacePath, refreshDirectory]);

  const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
    if (!workspacePath) return;
    // Only show if clicking on empty space (not on a file tree item)
    if ((e.target as HTMLElement).closest('[data-context="file-tree-item"]')) return;
    e.preventDefault();
    setRootContextMenu({ x: e.clientX, y: e.clientY });
  }, [workspacePath]);

  const handleRootNewFile = useCallback(() => {
    setRootContextMenu(null);
    setIsRootCreating('file');
  }, []);

  const handleRootNewFolder = useCallback(() => {
    setRootContextMenu(null);
    setIsRootCreating('folder');
  }, []);

  const handleRootNewDatabase = useCallback(() => {
    setRootContextMenu(null);
    setIsRootCreating('database');
    setRootCreateValue('untitled.quipudb.jsonl');
  }, []);

  const handleRootCreateSubmit = useCallback(async () => {
    if (rootCreateValue && workspacePath) {
      if (isRootCreating === 'database') {
        await createNewFile(workspacePath, rootCreateValue);
        const filePath = workspacePath + '/' + rootCreateValue;
        const { createEmptyDatabase } = await import('../../extensions/database-viewer/utils/jsonl');
        const name = rootCreateValue.replace('.quipudb.jsonl', '') || 'Untitled Database';
        const initialContent = createEmptyDatabase(name.charAt(0).toUpperCase() + name.slice(1));
        const fs = (await import('../../services/fileSystem')).default;
        await fs.writeFile(filePath, initialContent);
        openFile(filePath, rootCreateValue);
      } else if (isRootCreating === 'file') {
        await createNewFile(workspacePath, rootCreateValue);
      } else {
        await createNewFolder(workspacePath, rootCreateValue);
      }
    }
    setIsRootCreating(null);
    setRootCreateValue('');
  }, [rootCreateValue, isRootCreating, workspacePath, createNewFile, createNewFolder, openFile]);

  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsRootDragOver(true);
  }, []);

  const handleRootDragLeave = useCallback(() => {
    setIsRootDragOver(false);
  }, []);

  const handleRootDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDragOver(false);
    if (!workspacePath) return;

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath) return;

    const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
    const newPath = workspacePath + '/' + fileName;
    if (newPath === sourcePath) return;

    renameEntry(sourcePath, newPath);
  }, [workspacePath, renameEntry]);

  return (
    <div className="bg-bg-surface text-text-primary flex flex-col select-none text-[13px] font-sans flex-1 overflow-hidden">
      <div className="h-[35px] flex items-center px-5 text-[11px] font-semibold tracking-wider text-text-tertiary uppercase border-b border-border shrink-0">
        <span className="flex-1">EXPLORER</span>
        {workspacePath && (
          <button
            className="bg-transparent border-none text-text-tertiary cursor-pointer p-0.5 rounded-sm opacity-60 hover:opacity-100 hover:bg-white/[0.08] transition-opacity"
            onClick={handleRefresh}
            aria-label="Refresh file explorer"
            title="Refresh"
          >
            <ArrowClockwiseIcon size={14} />
          </button>
        )}
      </div>

      {!workspacePath ? (
        <div className="flex flex-col items-center justify-center p-5 flex-1 gap-3">
          <p className="text-text-tertiary text-[13px] m-0">No folder opened</p>
          <button
            className="bg-accent text-white border-none py-1.5 px-4 rounded-sm text-[13px] cursor-pointer hover:bg-accent-hover"
            onClick={openFolder}
          >
            Open Folder
          </button>
        </div>
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div
            className="h-[22px] flex items-center px-3 text-[11px] font-bold tracking-wide text-text-tertiary uppercase cursor-pointer shrink-0 hover:bg-white/[0.06]"
            onClick={openFolder}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{workspacePath.split('/').pop()}</span>
          </div>
          <div
            className={cn(
              "flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25",
              isRootDragOver && "bg-accent/10",
            )}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            onContextMenu={handleRootContextMenu}
          >
            {isRootCreating && (
              <div className="flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden" style={{ paddingLeft: '12px' }}>
                {isRootCreating === 'folder' ? <FolderIcon size={16} className="shrink-0" /> : <PhFileIcon size={16} className="shrink-0" />}
                <input
                  ref={rootCreateRef}
                  className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
                  value={rootCreateValue}
                  placeholder={isRootCreating === 'file' ? 'filename' : 'folder name'}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRootCreateValue(e.target.value)}
                  onBlur={handleRootCreateSubmit}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') handleRootCreateSubmit();
                    if (e.key === 'Escape') { setIsRootCreating(null); setRootCreateValue(''); }
                  }}
                />
              </div>
            )}
            {fileTree.map((entry: FileTreeEntry) => (
              <FileTreeItem key={entry.path} entry={entry} depth={0} />
            ))}

            {rootContextMenu && (
              <ContextMenu
                items={[
                  { label: 'New File', onClick: handleRootNewFile },
                  { label: 'New Folder', onClick: handleRootNewFolder },
                  { label: 'New Database', onClick: handleRootNewDatabase },
                ]}
                position={{ x: rootContextMenu.x, y: rootContextMenu.y }}
                onClose={() => setRootContextMenu(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
