import React, { createContext, useContext, useState, useCallback } from 'react';
import fs from '../services/fileSystem';
import { useToast } from '../components/Toast';

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { showToast } = useToast();
  const [workspacePath, setWorkspacePath] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const openFolder = useCallback(async () => {
    // Try native dialog first (Electron)
    const folderPath = await fs.openFolderDialog();
    if (folderPath) {
      selectFolder(folderPath);
    } else {
      // Native dialog failed or unavailable — show in-app picker
      setShowFolderPicker(true);
    }
  }, []);

  const selectFolder = useCallback(async (folderPath) => {
    setShowFolderPicker(false);
    setWorkspacePath(folderPath);
    setActiveFile(null);
    setIsDirty(false);
    setExpandedFolders(new Set());
    try {
      const entries = await fs.readDirectory(folderPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to read directory:', err);
      showToast('Failed to read directory: ' + err.message, 'error');
    }
  }, [showToast]);

  const cancelFolderPicker = useCallback(() => {
    setShowFolderPicker(false);
  }, []);

  const refreshDirectory = useCallback(async (dirPath) => {
    if (!dirPath) return;
    try {
      const entries = await fs.readDirectory(dirPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to refresh directory:', err);
      showToast('Failed to refresh directory: ' + err.message, 'error');
    }
  }, [showToast]);

  const loadSubDirectory = useCallback(async (dirPath) => {
    try {
      return await fs.readDirectory(dirPath);
    } catch (err) {
      console.error('Failed to load subdirectory:', err);
      showToast('Failed to load subdirectory: ' + err.message, 'error');
      return [];
    }
  }, [showToast]);

  const toggleFolder = useCallback((folderPath) => {
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

  const openFile = useCallback(async (filePath, fileName) => {
    try {
      const content = await fs.readFile(filePath);
      const isQuipu = fileName.endsWith('.quipu');

      let parsedContent = null;
      if (isQuipu) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'quipu' && parsed.content) {
            parsedContent = parsed.content;
          }
        } catch {
          // Not valid quipu JSON, treat as text
        }
      }

      setActiveFile({
        path: filePath,
        name: fileName,
        content: isQuipu && parsedContent ? parsedContent : content,
        isQuipu: isQuipu && !!parsedContent,
      });
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to open file:', err);
      showToast('Failed to open file: ' + err.message, 'error');
    }
  }, [showToast]);

  const saveFile = useCallback(async (editorInstance) => {
    if (!activeFile || !editorInstance) return;

    let content;
    if (activeFile.isQuipu || activeFile.name.endsWith('.quipu')) {
      content = JSON.stringify({
        type: 'quipu',
        version: 1,
        content: editorInstance.getJSON(),
        metadata: {
          savedAt: new Date().toISOString(),
        },
      }, null, 2);
    } else {
      content = editorInstance.getText();
    }

    try {
      await fs.writeFile(activeFile.path, content);
      setIsDirty(false);
      showToast('File saved', 'success');
    } catch (err) {
      console.error('Failed to save file:', err);
      showToast('Failed to save file: ' + err.message, 'error');
    }
  }, [activeFile, showToast]);

  const createNewFile = useCallback(async (parentPath, name) => {
    const filePath = parentPath + '/' + name;
    try {
      await fs.createFile(filePath);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to create file:', err);
      showToast('Failed to create file: ' + err.message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const createNewFolder = useCallback(async (parentPath, name) => {
    const folderPath = parentPath + '/' + name;
    try {
      await fs.createFolder(folderPath);
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to create folder:', err);
      showToast('Failed to create folder: ' + err.message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  const deleteEntry = useCallback(async (targetPath) => {
    try {
      await fs.deletePath(targetPath);
      if (activeFile && activeFile.path === targetPath) {
        setActiveFile(null);
        setIsDirty(false);
      }
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to delete:', err);
      showToast('Failed to delete: ' + err.message, 'error');
    }
  }, [workspacePath, activeFile, refreshDirectory, showToast]);

  const renameEntry = useCallback(async (oldPath, newPath) => {
    try {
      await fs.renamePath(oldPath, newPath);
      if (activeFile && activeFile.path === oldPath) {
        setActiveFile(prev => ({ ...prev, path: newPath, name: newPath.split('/').pop() }));
      }
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to rename:', err);
      showToast('Failed to rename: ' + err.message, 'error');
    }
  }, [workspacePath, activeFile, refreshDirectory, showToast]);

  const value = {
    workspacePath,
    fileTree,
    activeFile,
    isDirty,
    expandedFolders,
    showFolderPicker,
    openFolder,
    selectFolder,
    cancelFolderPicker,
    openFile,
    saveFile,
    setIsDirty,
    toggleFolder,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    refreshDirectory,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
