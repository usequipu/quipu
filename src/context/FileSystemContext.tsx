import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import fs from '../services/fileSystem';
import claudeInstaller from '../services/claudeInstaller';
import storage from '../services/storageService';
import { useToast } from '../components/ui/Toast';
import type { FileTreeEntry, RecentWorkspace } from '../types/workspace';

export interface FileSystemContextValue {
  // Workspace state
  workspacePath: string | null;
  fileTree: FileTreeEntry[];
  expandedFolders: Set<string>;
  showFolderPicker: boolean;
  recentWorkspaces: RecentWorkspace[];
  gitChangeCount: number;
  directoryVersion: number;

  // Workspace actions
  updateGitChangeCount: (count: number) => void;
  selectFolder: (folderPath: string) => Promise<void>;
  openFolder: () => Promise<void>;
  cancelFolderPicker: () => void;

  // File CRUD
  createNewFile: (parentPath: string, name: string) => Promise<void>;
  createNewFolder: (parentPath: string, name: string) => Promise<void>;
  deleteEntry: (targetPath: string) => Promise<void>;
  renameEntry: (oldPath: string, newPath: string) => Promise<void>;

  // Directory operations
  refreshDirectory: (dirPath: string) => Promise<void>;
  loadSubDirectory: (dirPath: string) => Promise<FileTreeEntry[]>;
  toggleFolder: (folderPath: string) => void;
  revealFolder: (folderPath: string) => void;

  // Expanded folders (bulk restore for session recovery)
  restoreExpandedFolders: (folders: string[]) => void;

  // Recent workspaces
  updateRecentWorkspaces: (folderPath: string) => Promise<void>;
  clearRecentWorkspaces: () => Promise<void>;
  removeFromRecentWorkspaces: (folderPath: string) => Promise<void>;
  validateAndPruneWorkspaces: (workspaces: RecentWorkspace[]) => Promise<RecentWorkspace[]>;
}

const FileSystemContext = createContext<FileSystemContextValue | null>(null);

interface FileSystemProviderProps {
  children: React.ReactNode;
}

export function FileSystemProvider({ children }: FileSystemProviderProps) {
  const { showToast } = useToast();

  // --- State ---
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState<boolean>(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [gitChangeCount, setGitChangeCount] = useState<number>(0);
  const [directoryVersion, setDirectoryVersion] = useState<number>(0);

  // --- Leaf callbacks (no dependencies on other callbacks) ---

  const updateGitChangeCount = useCallback((count: number) => {
    setGitChangeCount(count);
  }, []);

  const cancelFolderPicker = useCallback(() => {
    setShowFolderPicker(false);
  }, []);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const revealFolder = useCallback((folderPath: string) => {
    if (!workspacePath || !folderPath.startsWith(workspacePath)) return;
    setExpandedFolders(prev => {
      const next = new Set(prev);
      const relative = folderPath.substring(workspacePath.length + 1);
      const segments = relative.split('/');
      let current = workspacePath;
      for (const seg of segments) {
        current += '/' + seg;
        if (current === folderPath) {
          if (next.has(current)) next.delete(current);
          else next.add(current);
        } else {
          next.add(current);
        }
      }
      return next;
    });
  }, [workspacePath]);

  const restoreExpandedFolders = useCallback((folders: string[]) => {
    setExpandedFolders(new Set(folders));
  }, []);

  const refreshDirectory = useCallback(async (dirPath: string) => {
    if (!dirPath) return;
    try {
      const entries = await fs.readDirectory(dirPath) as FileTreeEntry[];
      setFileTree(entries);
      setDirectoryVersion(v => v + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to refresh directory:', err);
      showToast('Failed to refresh directory: ' + message, 'error');
    }
  }, [showToast]);

  const loadSubDirectory = useCallback(async (dirPath: string): Promise<FileTreeEntry[]> => {
    try {
      return await fs.readDirectory(dirPath) as FileTreeEntry[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to load subdirectory:', err);
      showToast('Failed to load subdirectory: ' + message, 'error');
      return [];
    }
  }, [showToast]);

  // --- Recent workspace management ---
  //
  // Per-window contract: the `recentWorkspaces` storage key is shared across
  // windows, but each window only READS from it once on mount (see the load
  // effect below). After mount, mutations operate on the in-memory React
  // state via the functional setState pattern and write the new array back
  // to storage. They never re-read from storage to merge other windows'
  // changes. This means each window's recent list reflects only what THAT
  // window has opened since launch (plus whatever was in storage at startup).
  //
  // Why: cross-window read-merge reintroduces the last-writer-wins race we
  // fixed for agents/repos. The user explicitly chose "per-window" over
  // "global with synchronization", so do NOT reintroduce a storage read in
  // these mutation callbacks.

  const updateRecentWorkspaces = useCallback(async (folderPath: string) => {
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
    const entry: RecentWorkspace = { path: folderPath, name, lastOpened: new Date().toISOString() };
    setRecentWorkspaces(prev => {
      const deduped = prev.filter(r => r.path !== folderPath);
      const next = [entry, ...deduped].slice(0, 10);
      storage.set('recentWorkspaces', next).catch(() => {});
      return next;
    });
  }, []);

  // Per-window: clears only this window's local view + storage. Other
  // windows retain their own in-memory list until they remount.
  const clearRecentWorkspaces = useCallback(async () => {
    setRecentWorkspaces(() => {
      storage.set('recentWorkspaces', []).catch(() => {});
      return [];
    });
  }, []);

  // Per-window: operates on the local state only. No-op if the path isn't
  // present locally (avoids spurious storage writes).
  const removeFromRecentWorkspaces = useCallback(async (folderPath: string) => {
    setRecentWorkspaces(prev => {
      const filtered = prev.filter(r => r.path !== folderPath);
      if (filtered.length === prev.length) return prev;
      storage.set('recentWorkspaces', filtered).catch(() => {});
      return filtered;
    });
  }, []);

  // Called once from the mount effect with the just-loaded recents. Prunes
  // entries whose paths no longer exist on disk and writes the cleaned list
  // back to storage (a one-time-per-window-mount cleanup). Does NOT re-read
  // from storage internally — operates on the argument array.
  const validateAndPruneWorkspaces = useCallback(async (workspaces: RecentWorkspace[]): Promise<RecentWorkspace[]> => {
    if (!workspaces || workspaces.length === 0) return workspaces;

    const validated: RecentWorkspace[] = [];
    for (const ws of workspaces) {
      try {
        await fs.readDirectory(ws.path);
        validated.push(ws);
      } catch {
        // Path no longer exists or is inaccessible — skip it
      }
    }

    if (validated.length < workspaces.length) {
      await storage.set('recentWorkspaces', validated);
      setRecentWorkspaces(validated);
    }

    return validated;
  }, []);

  // --- Dependent callbacks ---

  const selectFolder = useCallback(async (folderPath: string) => {
    setShowFolderPicker(false);

    // Validate directory exists before resetting state
    let entries: FileTreeEntry[];
    try {
      entries = await fs.readDirectory(folderPath) as FileTreeEntry[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to read directory:', err);
      showToast('Failed to open workspace: ' + message, 'error');
      removeFromRecentWorkspaces(folderPath).catch(() => {});
      return;
    }

    // Directory read succeeded — now reset state and apply
    setWorkspacePath(folderPath);
    setExpandedFolders(new Set());
    setFileTree(entries);

    // Save to workspace history (fire-and-forget)
    updateRecentWorkspaces(folderPath).catch(() => {});

    // Session restore handled by TabContext watching workspacePath changes

    // Auto-install FRAME skills for Claude Code (fire-and-forget)
    claudeInstaller.installFrameSkills(folderPath).catch((err: unknown) => {
      console.warn('Claude skills install failed:', err);
    });
  }, [showToast, updateRecentWorkspaces, removeFromRecentWorkspaces]);

  const openFolder = useCallback(async () => {
    const folderPath = await fs.openFolderDialog();
    if (folderPath) {
      selectFolder(folderPath);
    } else {
      setShowFolderPicker(true);
    }
  }, [selectFolder]);

  const createNewFile = useCallback(async (parentPath: string, name: string) => {
    const filePath = parentPath + '/' + name;
    try {
      await fs.createFile(filePath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to create file:', err);
      showToast('Failed to create file: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const createNewFolder = useCallback(async (parentPath: string, name: string) => {
    const folderPath = parentPath + '/' + name;
    try {
      await fs.createFolder(folderPath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to create folder:', err);
      showToast('Failed to create folder: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const deleteEntry = useCallback(async (targetPath: string) => {
    try {
      await fs.deletePath(targetPath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to delete:', err);
      showToast('Failed to delete: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const renameEntry = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renamePath(oldPath, newPath);
      setDirectoryVersion(v => v + 1);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to rename:', err);
      showToast('Failed to rename: ' + message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  // --- Effects ---

  // Load workspace history on mount; auto-open last workspace
  useEffect(() => {
    (async () => {
      const recent = (await storage.get('recentWorkspaces') as RecentWorkspace[] | null) || [];
      setRecentWorkspaces(recent);

      if (recent.length > 0) {
        const last = recent[0];
        try {
          const entries = await fs.readDirectory(last.path);
          setWorkspacePath(last.path);
          setFileTree(entries as FileTreeEntry[]);
          claudeInstaller.installFrameSkills(last.path).catch(() => {});
          // Session restore handled by TabContext watching workspacePath changes
        } catch {
          showToast(`Last workspace not found: ${last.name || last.path}`, 'warning');
        }
      }

      validateAndPruneWorkspaces(recent).catch(() => {});
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: FileSystemContextValue = {
    workspacePath,
    fileTree,
    expandedFolders,
    showFolderPicker,
    recentWorkspaces,
    gitChangeCount,
    directoryVersion,
    updateGitChangeCount,
    selectFolder,
    openFolder,
    cancelFolderPicker,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    refreshDirectory,
    loadSubDirectory,
    toggleFolder,
    revealFolder,
    restoreExpandedFolders,
    updateRecentWorkspaces,
    clearRecentWorkspaces,
    removeFromRecentWorkspaces,
    validateAndPruneWorkspaces,
  };

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  );
}

export function useFileSystem(): FileSystemContextValue {
  const context = useContext(FileSystemContext);
  if (!context) {
    throw new Error('useFileSystem must be used within a FileSystemProvider');
  }
  return context;
}
