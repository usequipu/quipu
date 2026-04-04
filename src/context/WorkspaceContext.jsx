import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import jsYaml from 'js-yaml';
import fs from '../services/fileSystem';
import fileWatcher from '../services/fileWatcher';
import frameService from '../services/frameService';
import claudeInstaller from '../services/claudeInstaller';
import storage from '../services/storageService';
import { useToast } from '../components/Toast';
import { isCodeFile, isMermaidFile, isNotebookFile } from '../utils/fileTypes';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const WorkspaceContext = createContext(null);

const MAX_TABS = 12;
const MAX_TERMINALS = 5;

export function WorkspaceProvider({ children }) {
  const { showToast } = useToast();
  const [workspacePath, setWorkspacePath] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState([]);
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [directoryVersion, setDirectoryVersion] = useState(0);

  const updateGitChangeCount = useCallback((count) => {
    setGitChangeCount(count);
  }, []);

  // Terminal tab state
  const [terminalTabs, setTerminalTabs] = useState([]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const terminalCounterRef = useRef(0);

  const createTerminalTab = useCallback(() => {
    if (terminalTabs.length >= MAX_TERMINALS) {
      showToast('Maximum of 5 terminals reached', 'warning');
      return null;
    }
    terminalCounterRef.current += 1;
    const tab = {
      id: crypto.randomUUID(),
      label: `Terminal ${terminalCounterRef.current}`,
      isClaudeRunning: false,
    };
    setTerminalTabs(prev => [...prev, tab]);
    setActiveTerminalId(tab.id);
    return tab;
  }, [terminalTabs.length, showToast]);

  const closeTerminalTab = useCallback((tabId) => {
    setTerminalTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // If closing the active terminal, switch to an adjacent one
      if (activeTerminalId === tabId && filtered.length > 0) {
        const idx = prev.findIndex(t => t.id === tabId);
        const newIdx = Math.min(idx, filtered.length - 1);
        setActiveTerminalId(filtered[newIdx].id);
      } else if (filtered.length === 0) {
        setActiveTerminalId(null);
      }
      return filtered;
    });
  }, [activeTerminalId]);

  const switchTerminalTab = useCallback((tabId) => {
    setActiveTerminalId(tabId);
  }, []);

  const setTerminalClaudeRunning = useCallback((tabId, isRunning) => {
    setTerminalTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isClaudeRunning: isRunning } : t
    ));
  }, []);

  const clearAllTerminals = useCallback(() => {
    setTerminalTabs([]);
    setActiveTerminalId(null);
  }, []);

  // Ref to access current openTabs inside intervals/event listeners without stale closures
  const openTabsRef = useRef(openTabs);
  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // Track recently saved paths to suppress file watcher false conflicts
  const recentSavesRef = useRef(new Map()); // path -> timestamp

  // Derived values (computed, not useState)
  const activeTab = openTabs.find(t => t.id === activeTabId) || null;
  const activeFile = activeTab ? {
    path: activeTab.path,
    name: activeTab.name,
    content: activeTab.content,
    isQuipu: activeTab.isQuipu,
  } : null;
  const isDirty = activeTab?.isDirty ?? false;

  // Load workspace history on mount; auto-open last workspace in Electron
  useEffect(() => {
    (async () => {
      const recent = await storage.get('recentWorkspaces') || [];
      setRecentWorkspaces(recent);

      if (recent.length > 0) {
        const last = recent[0];
        try {
          const entries = await fs.readDirectory(last.path);
          setWorkspacePath(last.path);
          setFileTree(entries);
          claudeInstaller.installFrameSkills(last.path).catch(() => {});
          restoreSession(last.path).catch(() => {});
        } catch {
          showToast(`Last workspace not found: ${last.name || last.path}`, 'warning');
        }
      }

      // Asynchronously validate all recent workspace paths and prune stale entries
      validateAndPruneWorkspaces(recent).catch(() => {});
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRecentWorkspaces = useCallback(async (folderPath) => {
    const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
    const entry = { path: folderPath, name, lastOpened: new Date().toISOString() };
    const recent = await storage.get('recentWorkspaces') || [];
    const deduped = recent.filter(r => r.path !== folderPath);
    const updated = [entry, ...deduped].slice(0, 10);
    await storage.set('recentWorkspaces', updated);
    setRecentWorkspaces(updated);
  }, []);

  const clearRecentWorkspaces = useCallback(async () => {
    await storage.set('recentWorkspaces', []);
    setRecentWorkspaces([]);
  }, []);

  // Validate workspace paths and prune stale entries that no longer exist on disk
  const validateAndPruneWorkspaces = useCallback(async (workspaces) => {
    if (!workspaces || workspaces.length === 0) return workspaces;

    const validated = [];
    for (const ws of workspaces) {
      try {
        await fs.readDirectory(ws.path);
        validated.push(ws);
      } catch {
        // Path no longer exists or is inaccessible — skip it
      }
    }

    // If any entries were pruned, persist the cleaned list
    if (validated.length < workspaces.length) {
      await storage.set('recentWorkspaces', validated);
      setRecentWorkspaces(validated);
    }

    return validated;
  }, []);

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

  const removeFromRecentWorkspaces = useCallback(async (folderPath) => {
    const recent = await storage.get('recentWorkspaces') || [];
    const filtered = recent.filter(r => r.path !== folderPath);
    if (filtered.length < recent.length) {
      await storage.set('recentWorkspaces', filtered);
      setRecentWorkspaces(filtered);
    }
  }, []);

  const selectFolder = useCallback(async (folderPath) => {
    setShowFolderPicker(false);

    // Validate directory exists before resetting state
    let entries;
    try {
      entries = await fs.readDirectory(folderPath);
    } catch (err) {
      console.error('Failed to read directory:', err);
      showToast('Failed to open workspace: ' + err.message, 'error');
      // Prune the stale path from recent workspaces (fire-and-forget)
      removeFromRecentWorkspaces(folderPath).catch(() => {});
      return;
    }

    // Directory read succeeded — now reset state and apply
    setWorkspacePath(folderPath);
    setOpenTabs([]);
    setActiveTabId(null);
    setExpandedFolders(new Set());
    clearAllTerminals();
    try {
      const entries = await fs.readDirectory(folderPath);
      setFileTree(entries);
    } catch (err) {
      console.error('Failed to read directory:', err);
      showToast('Failed to read directory: ' + err.message, 'error');
    }

    // Save to workspace history (fire-and-forget)
    updateRecentWorkspaces(folderPath).catch(() => {});

    // Restore last session for this workspace (fire-and-forget)
    restoreSession(folderPath).catch(() => {});

    // Auto-install FRAME skills for Claude Code (fire-and-forget)
    claudeInstaller.installFrameSkills(folderPath).catch((err) => {
      console.warn('Claude skills install failed:', err);
    });
  }, [showToast, updateRecentWorkspaces, removeFromRecentWorkspaces, clearAllTerminals]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelFolderPicker = useCallback(() => {
    setShowFolderPicker(false);
  }, []);

  const refreshDirectory = useCallback(async (dirPath) => {
    if (!dirPath) return;
    try {
      const entries = await fs.readDirectory(dirPath);
      setFileTree(entries);
      setDirectoryVersion(v => v + 1);
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

  // Expand all ancestor folders of a path, then toggle the target
  const revealFolder = useCallback((folderPath) => {
    if (!workspacePath || !folderPath.startsWith(workspacePath)) return;
    setExpandedFolders(prev => {
      const next = new Set(prev);
      // Expand every ancestor from workspace root to the target
      const relative = folderPath.substring(workspacePath.length + 1);
      const segments = relative.split('/');
      let current = workspacePath;
      for (const seg of segments) {
        current += '/' + seg;
        if (current === folderPath) {
          // Toggle the target itself
          if (next.has(current)) next.delete(current);
          else next.add(current);
        } else {
          // Always expand ancestors
          next.add(current);
        }
      }
      return next;
    });
  }, [workspacePath]);

  const setTabDirty = useCallback((tabId, dirty) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isDirty: dirty } : t
    ));
  }, []);

  const updateTabContent = useCallback((tabId, content) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, content } : t
    ));
  }, []);

  // Function to snapshot editor state for current tab before switching
  const snapshotTab = useCallback((tabId, tiptapJSON, scrollPosition) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, tiptapJSON, scrollPosition } : t
    ));
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

  const restoreSession = useCallback(async (folderPath) => {
    const session = await storage.get(`session:${folderPath}`);
    if (!session?.openFilePaths?.length) return;

    const savedPaths = session.openFilePaths.slice(0, MAX_TABS);
    const tabsMap = new Map();

    await Promise.all(savedPaths.map(async ({ path: filePath, scrollPosition }) => {
      const fileName = filePath.split(/[\\/]/).pop();
      const isPdf = /\.pdf$/i.test(fileName);
      const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);

      if (isPdf || isMedia) {
        tabsMap.set(filePath, {
          id: crypto.randomUUID(),
          path: filePath,
          name: fileName,
          content: null,
          tiptapJSON: null,
          isDirty: false,
          isQuipu: false,
          isMarkdown: false,
          isMedia,
          isPdf,
          isNotebook: false,
          scrollPosition: scrollPosition ?? 0,
          frontmatter: null,
          frontmatterRaw: null,
          diskContent: null,
          frontmatterCollapsed: true,
        });
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
            if (parsed.type === 'quipu' && parsed.content) parsedContent = parsed.content;
          } catch { /* treat as text */ }
        }

        let frontmatter = null, frontmatterRaw = null, bodyContent = content;
        if (isMarkdown && typeof content === 'string') {
          const fm = extractFrontmatter(content);
          frontmatter = fm.frontmatter;
          frontmatterRaw = fm.frontmatterRaw;
          bodyContent = fm.body;
        }

        tabsMap.set(filePath, {
          id: crypto.randomUUID(),
          path: filePath,
          name: fileName,
          content: isQuipu && parsedContent ? parsedContent : bodyContent,
          tiptapJSON: null,
          isDirty: false,
          isQuipu: isQuipu && !!parsedContent,
          isMarkdown,
          isNotebook: isNotebookFile(fileName),
          scrollPosition: scrollPosition ?? 0,
          frontmatter,
          frontmatterRaw,
          diskContent: content,
          frontmatterCollapsed: true,
        });
      } catch {
        // File no longer exists — skip silently
      }
    }));

    const tabs = savedPaths.map(({ path }) => tabsMap.get(path)).filter(Boolean);
    if (tabs.length === 0) return;

    setOpenTabs(tabs);
    const active = tabs.find(t => t.path === session.activeFilePath) ?? tabs[tabs.length - 1];
    setActiveTabId(active.id);

    if (session.expandedFolders?.length) {
      setExpandedFolders(new Set(session.expandedFolders));
    }
  }, [extractFrontmatter]);

  const reloadTabFromDisk = useCallback(async (tabId) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const content = await fs.readFile(tab.path);
      const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');

      let bodyContent = content;
      let frontmatter = tab.frontmatter;
      let frontmatterRaw = tab.frontmatterRaw;

      if (isMarkdown && typeof content === 'string') {
        const fm = extractFrontmatter(content);
        frontmatter = fm.frontmatter;
        frontmatterRaw = fm.frontmatterRaw;
        bodyContent = fm.body;
      }

      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? {
          ...t,
          content: bodyContent,
          tiptapJSON: null,
          isDirty: false,
          diskContent: content,
          frontmatter,
          frontmatterRaw,
          hasConflict: false,
          conflictDiskContent: null,
          reloadKey: (t.reloadKey || 0) + 1,
        } : t
      ));
    } catch (err) {
      showToast('Failed to reload file: ' + err.message, 'error');
    }
  }, [openTabs, extractFrontmatter, showToast]);

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

    const isPdf = /\.pdf$/i.test(fileName);
    const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);
    if (isMedia || isPdf) {
      const newTab = {
        id: crypto.randomUUID(),
        path: filePath,
        name: fileName,
        content: null,
        tiptapJSON: null,
        isDirty: false,
        isQuipu: false,
        isMarkdown: false,
        isMedia: isMedia,
        isPdf: isPdf,
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
        isNotebook: isNotebookFile(fileName),
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
    if (!activeTab) return;

    // NEVER write to binary files — they would be corrupted
    if (activeTab.isPdf || activeTab.isMedia || /\.pdf$/i.test(activeTab.name)) return;

    // For non-TipTap files (e.g., excalidraw), save tab content directly
    const isNonTipTapFile = activeTab.name.endsWith('.excalidraw') || activeTab.isMedia || isCodeFile(activeTab.name) || isMermaidFile(activeTab.name);
    if ((isNonTipTapFile || !editorInstance) && activeTab.content) {
      try {
        recentSavesRef.current.set(activeTab.path, Date.now());
        await fs.writeFile(activeTab.path, activeTab.content);
        setOpenTabs(prev => prev.map(t =>
          t.id === activeTab.id ? { ...t, isDirty: false, diskContent: activeTab.content, hasConflict: false, conflictDiskContent: null } : t
        ));
        showToast('File saved', 'success');
      } catch (err) {
        console.error('Failed to save file:', err);
        showToast('Failed to save file: ' + err.message, 'error');
      }
      return;
    }

    if (!editorInstance) return;

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
      recentSavesRef.current.set(activeTab.path, Date.now());
      await fs.writeFile(activeTab.path, content);
      // Update diskContent so file watcher doesn't trigger on our own save
      // Also clear any conflict state since saving resolves it
      setOpenTabs(prev => prev.map(t =>
        t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content, hasConflict: false, conflictDiskContent: null } : t
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
      setDirectoryVersion(v => v + 1);
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
      setDirectoryVersion(v => v + 1);
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
      setDirectoryVersion(v => v + 1);
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
      setDirectoryVersion(v => v + 1);
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

  // Conflict resolution: reload from disk (discard local changes)
  const resolveConflictReload = useCallback(async (tabId) => {
    const tab = openTabsRef.current.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const fresh = tab.conflictDiskContent || await fs.readFile(tab.path);
      const updates = applyFreshContent(tab, fresh);
      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, ...updates, hasConflict: false, conflictDiskContent: null, reloadKey: (t.reloadKey || 0) + 1 } : t
      ));
    } catch (err) {
      showToast('Failed to reload file: ' + err.message, 'error');
    }
  }, [applyFreshContent, showToast]);

  // Conflict resolution: keep local changes (acknowledge the disk change)
  const resolveConflictKeep = useCallback((tabId) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, hasConflict: false, conflictDiskContent: null } : t
    ));
  }, []);

  // Conflict resolution: dismiss (same as keep)
  const resolveConflictDismiss = useCallback((tabId) => {
    resolveConflictKeep(tabId);
  }, [resolveConflictKeep]);

  // Electron: use native directory watcher
  useEffect(() => {
    if (!window.electronAPI || !workspacePath) return;

    fs.watchDirectory(workspacePath);

    const cleanup = fs.onDirectoryChanged(async ({ filename }) => {
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      // Skip if this file was saved by us recently (within 3s) — don't delete entry,
      // OS may fire multiple events for a single write
      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        if (tab.isDirty) {
          // Show conflict bar instead of just a toast
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
          ));
        } else {
          const updates = applyFreshContent(tab, fresh);
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
          ));
        }
      } catch { /* file may be temporarily inaccessible */ }
    });

    return cleanup;
  }, [workspacePath, applyFreshContent]);

  // Browser: use fileWatcher WebSocket for push-based file change notifications
  useEffect(() => {
    if (window.electronAPI || !workspacePath) return;

    fileWatcher.watch(workspacePath).catch(() => {});

    const cleanup = fileWatcher.onChanged(async ({ filename }) => {
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      // Skip if this file was saved by us recently (within 3s) — don't delete entry,
      // OS may fire multiple events for a single write
      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        if (tab.isDirty) {
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
          ));
        } else {
          const updates = applyFreshContent(tab, fresh);
          setOpenTabs(prev => prev.map(t =>
            t.id === tab.id ? { ...t, ...updates, reloadKey: (t.reloadKey || 0) + 1 } : t
          ));
        }
      } catch { /* file may be temporarily inaccessible */ }
    });

    return () => {
      cleanup();
      fileWatcher.unwatch().catch(() => {});
    };
  }, [workspacePath, applyFreshContent]);

  // FRAME file watching: detect external changes to .frame.json files
  // and increment frameReloadKey on affected tabs so Editor re-loads annotations
  const frameCleanupRef = useRef(null);

  useEffect(() => {
    if (!workspacePath) return;

    const cleanup = frameService.watchFrames(workspacePath, (changedFilePath) => {
      const tab = openTabsRef.current.find(t => t.path === changedFilePath);
      if (!tab) return;

      setOpenTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, frameReloadKey: (t.frameReloadKey || 0) + 1 } : t
      ));
    });

    frameCleanupRef.current = cleanup;

    if (cleanup.registerPath) {
      for (const tab of openTabsRef.current) {
        if (!tab.isMedia && !tab.isQuipu) {
          cleanup.registerPath(frameService.getFramePath(workspacePath, tab.path));
        }
      }
    }

    return cleanup;
  }, [workspacePath, showToast]);

  useEffect(() => {
    const cleanup = frameCleanupRef.current;
    if (!cleanup?.registerPath || !workspacePath) return;

    for (const tab of openTabs) {
      if (!tab.isMedia && !tab.isQuipu) {
        cleanup.registerPath(frameService.getFramePath(workspacePath, tab.path));
      }
    }
  }, [openTabs, workspacePath]);

  // Persist open tabs + expanded folders per workspace (debounced 500ms)
  useEffect(() => {
    if (!workspacePath) return;
    const timer = setTimeout(() => {
      const snapshot = {
        openFilePaths: openTabs
          .filter(t => t.path)
          .map(t => ({ path: t.path, scrollPosition: t.scrollPosition ?? 0 })),
        activeFilePath: openTabs.find(t => t.id === activeTabId)?.path ?? null,
        expandedFolders: [...expandedFolders],
      };
      storage.set(`session:${workspacePath}`, snapshot).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [openTabs, activeTabId, expandedFolders, workspacePath]);

  const value = {
    workspacePath,
    fileTree,
    activeFile,
    isDirty,
    expandedFolders,
    showFolderPicker,
    recentWorkspaces,
    openFolder,
    selectFolder,
    cancelFolderPicker,
    clearRecentWorkspaces,
    openFile,
    saveFile,
    setIsDirty,
    updateTabContent,
    toggleFolder,
    revealFolder,
    loadSubDirectory,
    createNewFile,
    createNewFolder,
    deleteEntry,
    renameEntry,
    refreshDirectory,
    directoryVersion,
    // Tab functions
    openTabs,
    activeTabId,
    activeTab,
    closeTab,
    switchTab,
    closeOtherTabs,
    setTabDirty,
    snapshotTab,
    reloadTabFromDisk,
    // Terminal tabs
    terminalTabs,
    activeTerminalId,
    createTerminalTab,
    closeTerminalTab,
    switchTerminalTab,
    setTerminalClaudeRunning,
    clearAllTerminals,
    // Conflict resolution
    resolveConflictReload,
    resolveConflictKeep,
    resolveConflictDismiss,
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
