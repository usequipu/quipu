import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CaretRightIcon, CaretDownIcon, FileIcon as PhFileIcon, FolderIcon, FolderOpenIcon,
  NotebookIcon, FileJsIcon, FileJsxIcon, FileCssIcon, FileHtmlIcon,
  FileCodeIcon, FileMdIcon, FileTextIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';
import ContextMenu from './ContextMenu';

function getFileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
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

function FileIconComponent({ name, isDirectory, isExpanded, isDirty }) {
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

function FileTreeItem({ entry, depth = 0 }) {
  const {
    activeFile,
    expandedFolders,
    toggleFolder,
    openFile,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    openTabs,
    directoryVersion,
  } = useWorkspace();

  const [children, setChildren] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isCreating, setIsCreating] = useState(null); // 'file' | 'folder' | null
  const [createValue, setCreateValue] = useState('');
  const renameRef = useRef(null);
  const createRef = useRef(null);

  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFile && activeFile.path === entry.path;
  const isDirtyFile = !entry.isDirectory && openTabs.some(t => t.path === entry.path && t.isDirty);

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

  const handleContextMenu = useCallback((e) => {
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

  const handleCreateSubmit = useCallback(async () => {
    if (createValue) {
      if (isCreating === 'file') {
        await createNewFile(entry.path, createValue);
      } else {
        await createNewFolder(entry.path, createValue);
      }
    }
    setIsCreating(null);
    setCreateValue('');
  }, [createValue, isCreating, entry.path, createNewFile, createNewFolder]);

  // Build context menu items for this entry
  const contextMenuItems = useCallback(() => {
    const items = [];

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
  }, [entry, handleNewFile, handleNewFolder, handleRenameStart, handleDelete]);

  return (
    <div className="relative" data-context="file-tree-item">
      <div
        className={cn(
          "flex items-center h-[22px] cursor-pointer gap-1 whitespace-nowrap overflow-hidden",
          "hover:bg-white/[0.06]",
          isActive && "bg-white/10",
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
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
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
              {isCreating === 'folder' ? <FolderIcon size={16} className="shrink-0" /> : <PhFileIcon size={16} className="shrink-0" />}
              <input
                ref={createRef}
                className="bg-bg-elevated border border-accent text-text-primary text-[13px] font-[inherit] px-1 h-[18px] flex-1 outline-none rounded-none"
                value={createValue}
                placeholder={isCreating === 'file' ? 'filename' : 'folder name'}
                onChange={(e) => setCreateValue(e.target.value)}
                onBlur={handleCreateSubmit}
                onKeyDown={(e) => {
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
  const { workspacePath, fileTree, openFolder, refreshDirectory } = useWorkspace();

  const handleRefresh = useCallback(() => {
    if (workspacePath) {
      refreshDirectory(workspacePath);
    }
  }, [workspacePath, refreshDirectory]);

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
          <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25">
            {fileTree.map((entry) => (
              <FileTreeItem key={entry.path} entry={entry} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
