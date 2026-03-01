import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import jsYaml from 'js-yaml';
import fs from '../services/fileSystem';
import claudeInstaller from '../services/claudeInstaller';
import { useToast } from '../components/Toast';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const WorkspaceContext = createContext(null);

const MAX_TABS = 12;

export function WorkspaceProvider({ children }) {
  const { showToast } = useToast();
  const [workspacePath, setWorkspacePath] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [gitChangeCount, setGitChangeCount] = useState(0);

  const updateGitChangeCount = useCallback((count) => {
    setGitChangeCount(count);
  }, []);

  // Ref to access current openTabs inside intervals/event listeners without stale closures
  const openTabsRef = useRef(openTabs);
  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // Derived values (computed, not useState)
  const activeTab = openTabs.find(t => t.id === activeTabId) || null;
  const activeFile = activeTab ? {
    path: activeTab.path,
    name: activeTab.name,
    content: activeTab.content,
    isQuipu: activeTab.isQuipu,
  } : null;
  const isDirty = activeTab?.isDirty ?? false;

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
    setOpenTabs([]);
    setActiveTabId(null);
    setExpandedFolders(new Set());
    try {
      const entries = await fs.readDirectory(folderPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to read directory:', err);
      showToast('Failed to read directory: ' + err.message, 'error');
    }

    // Auto-install FRAME skills for Claude Code (fire-and-forget)
    claudeInstaller.installFrameSkills(folderPath).catch((err) => {
      console.warn('Claude skills install failed:', err);
    });
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

  const setTabDirty = useCallback((tabId, dirty) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isDirty: dirty } : t
    ));
  }, []);

  // Function to snapshot editor state for current tab before switching
  const snapshotTab = useCallback((tabId, tiptapJSON, scrollPosition) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, tiptapJSON, scrollPosition } : t
    ));
  }, []);

  // Frontmatter operations
  const updateFrontmatter = useCallback((tabId, key, value) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...(t.frontmatter || {}), [key]: value };
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const addFrontmatterProperty = useCallback((tabId) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = t.frontmatter || {};
      // Find a unique key name
      let keyName = 'key';
      let counter = 1;
      while (existing[keyName] !== undefined) {
        keyName = `key${counter++}`;
      }
      return { ...t, frontmatter: { ...existing, [keyName]: '' }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterProperty = useCallback((tabId, key) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...t.frontmatter };
      delete updated[key];
      // If no properties left, keep frontmatter as empty object (not null)
      // so the properties section still shows
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const renameFrontmatterKey = useCallback((tabId, oldKey, newKey) => {
    if (oldKey === newKey) return;
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const entries = Object.entries(t.frontmatter || {});
      const updated = {};
      for (const [k, v] of entries) {
        updated[k === oldKey ? newKey : k] = v;
      }
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const toggleFrontmatterCollapsed = useCallback((tabId) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, frontmatterCollapsed: !t.frontmatterCollapsed } : t
    ));
  }, []);

  const addFrontmatterTag = useCallback((tabId, key, tagValue) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? t.frontmatter[key] : [];
      return { ...t, frontmatter: { ...t.frontmatter, [key]: [...existing, tagValue] }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterTag = useCallback((tabId, key, index) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...t.frontmatter[key]] : [];
      existing.splice(index, 1);
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  const updateFrontmatterTag = useCallback((tabId, key, index, newValue) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...t.frontmatter[key]] : [];
      existing[index] = newValue;
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  const extractFrontmatter = useCallback((rawContent) => {
    const match = rawContent.match(FRONTMATTER_REGEX);
    if (!match) return { frontmatter: null, frontmatterRaw: null, body: rawContent };

    try {
      const parsed = jsYaml.load(match[1]);
      return {
        frontmatter: typeof parsed === 'object' && parsed !== null ? parsed : null,
        frontmatterRaw: match[1],
        body: rawContent.slice(match[0].length),
      };
    } catch {
      showToast('Malformed YAML frontmatter', 'warning');
      return { frontmatter: null, frontmatterRaw: match[1], body: rawContent.slice(match[0].length) };
    }
  }, [showToast]);

  const openFile = useCallback(async (filePath, fileName) => {
    // Check if already open
    const existing = openTabs.find(t => t.path === filePath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    // Check tab cap
    if (openTabs.length >= MAX_TABS) {
      showToast('Close a tab to open more files', 'warning');
      return;
    }

    const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);
    if (isMedia) {
      const newTab = {
        id: crypto.randomUUID(),
        path: filePath,
        name: fileName,
        content: null,
        tiptapJSON: null,
        isDirty: false,
        isQuipu: false,
        isMarkdown: false,
        isMedia: true,
        scrollPosition: 0,
        frontmatter: null,
        frontmatterRaw: null,
        diskContent: null,
        frontmatterCollapsed: true,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return;
    }

    try {
      const content = await fs.readFile(filePath);
      const isQuipu = fileName.endsWith('.quipu');
      const isMarkdown = fileName.endsWith('.md') || fileName.endsWith('.markdown');

      let parsedContent = null;
      if (isQuipu) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'quipu' && parsed.content) {
            parsedContent = parsed.content;
          }
        } catch { /* treat as text */ }
      }

      // Parse frontmatter for markdown files
      let frontmatter = null;
      let frontmatterRaw = null;
      let bodyContent = content;
      if (isMarkdown && typeof content === 'string') {
        const fm = extractFrontmatter(content);
        frontmatter = fm.frontmatter;
        frontmatterRaw = fm.frontmatterRaw;
        bodyContent = fm.body;
      }

      const newTab = {
        id: crypto.randomUUID(),
        path: filePath,
        name: fileName,
        content: isQuipu && parsedContent ? parsedContent : bodyContent,
        tiptapJSON: null,
        isDirty: false,
        isQuipu: isQuipu && !!parsedContent,
        isMarkdown,
        scrollPosition: 0,
        frontmatter,
        frontmatterRaw,
        diskContent: content, // Raw content as read from disk, for change detection
        frontmatterCollapsed: true,
      };

      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err) {
      console.error('Failed to open file:', err);
      showToast('Failed to open file: ' + err.message, 'error');
    }
  }, [openTabs, showToast, extractFrontmatter]);

  const closeTab = useCallback((tabId) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      const result = window.confirm(`Save changes to "${tab.name}" before closing?`);
      if (result) {
        // For now, just close. Full save-before-close would need editor instance.
        // The save flow is complex because we need the editor - we'll handle this by just warning.
      }
    }

    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // If closing the active tab, switch to adjacent
      if (activeTabId === tabId && filtered.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newIdx = Math.min(idx, filtered.length - 1);
        setActiveTabId(filtered[newIdx].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  }, [openTabs, activeTabId]);

  const switchTab = useCallback((tabId) => {
    setActiveTabId(tabId);
  }, []);

  const closeOtherTabs = useCallback((tabId) => {
    setOpenTabs(prev => prev.filter(t => t.id === tabId || t.isDirty));
    setActiveTabId(tabId);
  }, []);

  const setIsDirty = useCallback((dirty) => {
    if (activeTabId) {
      setTabDirty(activeTabId, dirty);
    }
  }, [activeTabId, setTabDirty]);

  const saveFile = useCallback(async (editorInstance) => {
    if (!activeTab || !editorInstance) return;

    let content;
    if (activeTab.isQuipu || activeTab.name.endsWith('.quipu')) {
      content = JSON.stringify({
        type: 'quipu',
        version: 1,
        content: editorInstance.getJSON(),
        metadata: {
          savedAt: new Date().toISOString(),
        },
      }, null, 2);
    } else if (activeTab.name.endsWith('.md') || activeTab.name.endsWith('.markdown')) {
      const markdown = editorInstance.storage.markdown.getMarkdown();
      if (activeTab.frontmatter || activeTab.frontmatterRaw) {
        const yaml = activeTab.frontmatter
          ? jsYaml.dump(activeTab.frontmatter, { sortKeys: false, lineWidth: -1 })
          : activeTab.frontmatterRaw + '\n';
        content = `---\n${yaml}---\n\n${markdown}`;
      } else {
        content = markdown;
      }
    } else {
      content = editorInstance.getText();
    }

    try {
      await fs.writeFile(activeTab.path, content);
      // Update diskContent so file watcher doesn't trigger on our own save
      setOpenTabs(prev => prev.map(t =>
        t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content } : t
      ));
      showToast('File saved', 'success');
    } catch (err) {
      console.error('Failed to save file:', err);
      showToast('Failed to save file: ' + err.message, 'error');
    }
  }, [activeTab, showToast]);

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
      // Close tab if file was open
      const tab = openTabs.find(t => t.path === targetPath);
      if (tab) {
        closeTab(tab.id);
      }
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to delete:', err);
      showToast('Failed to delete: ' + err.message, 'error');
    }
  }, [workspacePath, openTabs, closeTab, refreshDirectory, showToast]);

  const renameEntry = useCallback(async (oldPath, newPath) => {
    try {
      await fs.renamePath(oldPath, newPath);
      // Update tab if file was open
      setOpenTabs(prev => prev.map(t =>
        t.path === oldPath ? { ...t, path: newPath, name: newPath.split('/').pop() } : t
      ));
      if (workspacePath) await refreshDirectory(workspacePath);
    } catch (err) {
      console.error('Failed to rename:', err);
      showToast('Failed to rename: ' + err.message, 'error');
    }
  }, [workspacePath, refreshDirectory, showToast]);

  // Helper: apply a fresh file content to a tab (parse frontmatter, reset dirty)
  const applyFreshContent = useCallback((tab, fresh) => {
    const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');
    let frontmatter = null, frontmatterRaw = null, bodyContent = fresh;
    if (isMarkdown && typeof fresh === 'string') {
      const fm = extractFrontmatter(fresh);
      frontmatter = fm.frontmatter;
      frontmatterRaw = fm.frontmatterRaw;
      bodyContent = fm.body;
    }
    return { content: bodyContent, tiptapJSON: null, isDirty: false, diskContent: fresh, frontmatter, frontmatterRaw };
  }, [extractFrontmatter]);

  // Electron: use native directory watcher
  useEffect(() => {
    if (!window.electronAPI || !workspacePath) return;

    fs.watchDirectory(workspacePath);

    const cleanup = fs.onDirectoryChanged(async ({ filename }) => {
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');
      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        if (tab.isDirty) {
          showToast(`"${tab.name}" changed on disk (unsaved changes preserved)`, 'warning');
          setOpenTabs(prev => prev.map(t => t.id === tab.id ? { ...t, diskContent: fresh } : t));
        } else {
          const updates = applyFreshContent(tab, fresh);
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
          ));
        }
      } catch { /* file may be temporarily inaccessible */ }
    });

    return cleanup;
  }, [workspacePath, showToast, applyFreshContent]);

  // Browser: poll open files every 5 seconds for external changes
  useEffect(() => {
    if (window.electronAPI || !workspacePath) return;

    const id = setInterval(async () => {
      const tabs = openTabsRef.current;
      const reloads = [];
      const warnings = [];

      for (const tab of tabs) {
        if (tab.isMedia || !tab.diskContent) continue;
        try {
          const fresh = await fs.readFile(tab.path);
          if (fresh === tab.diskContent) continue;

          if (tab.isDirty) {
            warnings.push({ id: tab.id, name: tab.name, diskContent: fresh });
          } else {
            reloads.push({ tab, fresh });
          }
        } catch { /* ignore read errors */ }
      }

      if (reloads.length > 0 || warnings.length > 0) {
        setOpenTabs(prev => prev.map(t => {
          const reload = reloads.find(r => r.tab.id === t.id);
          if (reload) return { ...t, ...applyFreshContent(reload.tab, reload.fresh), reloadKey: (t.reloadKey || 0) + 1 };
          const warn = warnings.find(w => w.id === t.id);
          if (warn) return { ...t, diskContent: warn.diskContent };
          return t;
        }));
        warnings.forEach(w => showToast(`"${w.name}" changed on disk (unsaved changes preserved)`, 'warning'));
      }
    }, 5000);

    return () => clearInterval(id);
  }, [workspacePath, showToast, applyFreshContent]);

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
    // Tab functions
    openTabs,
    activeTabId,
    activeTab,
    closeTab,
    switchTab,
    closeOtherTabs,
    setTabDirty,
    snapshotTab,
    // Git status
    gitChangeCount,
    updateGitChangeCount,
    // Frontmatter functions
    updateFrontmatter,
    addFrontmatterProperty,
    removeFrontmatterProperty,
    renameFrontmatterKey,
    toggleFrontmatterCollapsed,
    addFrontmatterTag,
    removeFrontmatterTag,
    updateFrontmatterTag,
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
