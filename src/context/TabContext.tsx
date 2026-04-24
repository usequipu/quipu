import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import jsYaml from 'js-yaml';
import fs from '../services/fileSystem';
import fileWatcher from '../services/fileWatcher';
import frameService from '../services/frameService';
import storage from '../services/storageService';
import { useToast } from '../components/ui/Toast';
import { getExtensionForTab } from '../extensions/registry';
import { useFileSystem } from './FileSystemContext';
import type { Tab, ActiveFile, Frontmatter } from '../types/tab';
import type { JSONContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface ExtractedFrontmatter {
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  body: string;
}

interface SessionSnapshotEntry {
  path: string;
  scrollPosition: number;
  /** Set for synthetic tabs (e.g. 'agent', 'agent-editor', 'repo-editor'). */
  type?: string;
  /** Persisted display name — needed when a synthetic tab can't be rebuilt from its path alone. */
  name?: string;
}

interface SessionSnapshot {
  openFilePaths: Array<SessionSnapshotEntry>;
  activeFilePath: string | null;
  expandedFolders: string[];
}

/**
 * Event shape used by both the Electron directory watcher and the browser file watcher.
 * At runtime the event may carry `filename` (from the raw OS watcher callback)
 * or `path` (from the typed service interface). We handle both.
 */
interface FileChangeEvent {
  filename?: string;
  type?: string;
  path?: string;
  [key: string]: unknown;
}

const MAX_TABS = 12;

export interface TabContextValue {
  // Active file (derived)
  activeFile: ActiveFile | null;
  isDirty: boolean;

  // File operations
  openFile: (filePath: string, fileName: string) => Promise<void>;
  openAgentTab: (agentId: string, agentName: string) => void;
  openAgentEditorTab: (agentId: string, agentName: string) => void;
  openRepoEditorTab: (repoId: string, repoName: string) => void;
  /** Rename any open tab(s) whose `path` matches. Used for agent auto-renames. */
  renameTabsByPath: (path: string, newName: string) => void;
  saveFile: (editorInstance: Editor | null) => Promise<void>;
  setIsDirty: (dirty: boolean) => void;
  updateTabContent: (tabId: string, content: string | JSONContent) => void;

  // Tab state and operations
  openTabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  reorderTabs: (activeId: string, overId: string) => void;
  setTabDirty: (tabId: string, dirty: boolean) => void;
  snapshotTab: (tabId: string, tiptapJSON: JSONContent | null, scrollPosition: number) => void;
  reloadTabFromDisk: (tabId: string) => Promise<void>;

  // Conflict resolution
  resolveConflictReload: (tabId: string) => Promise<void>;
  resolveConflictKeep: (tabId: string) => void;
  resolveConflictDismiss: (tabId: string) => void;

  // Frontmatter operations
  updateFrontmatter: (tabId: string, key: string, value: unknown) => void;
  addFrontmatterProperty: (tabId: string) => void;
  removeFrontmatterProperty: (tabId: string, key: string) => void;
  renameFrontmatterKey: (tabId: string, oldKey: string, newKey: string) => void;
  toggleFrontmatterCollapsed: (tabId: string) => void;
  addFrontmatterTag: (tabId: string, key: string, tagValue: string) => void;
  removeFrontmatterTag: (tabId: string, key: string, index: number) => void;
  updateFrontmatterTag: (tabId: string, key: string, index: number, newValue: string) => void;

  // Tab-aware overrides of FileSystem CRUD
  deleteEntry: (targetPath: string) => Promise<void>;
  renameEntry: (oldPath: string, newPath: string) => Promise<void>;
}

const TabContext = createContext<TabContextValue | null>(null);

interface TabProviderProps {
  children: React.ReactNode;
}

export function TabProvider({ children }: TabProviderProps) {
  const { showToast } = useToast();
  const fileSystem = useFileSystem();
  const { workspacePath } = fileSystem;

  // --- State ---
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Ref to access current openTabs inside intervals/event listeners without stale closures
  const openTabsRef = useRef<Tab[]>(openTabs);
  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // Track recently saved paths to suppress file watcher false conflicts
  const recentSavesRef = useRef<Map<string, number>>(new Map());

  // Derived values (computed, not useState)
  const activeTab: Tab | null = openTabs.find(t => t.id === activeTabId) || null;
  const activeFile: ActiveFile | null = activeTab ? {
    path: activeTab.path,
    name: activeTab.name,
    content: activeTab.content,
    isQuipu: activeTab.isQuipu,
  } : null;
  const isDirty: boolean = activeTab?.isDirty ?? false;

  // Track previous workspacePath so we can detect workspace switches
  const prevWorkspacePathRef = useRef<string | null>(null);

  // --- Leaf callbacks (no dependencies on other callbacks) ---

  const setTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, isDirty: dirty } : t
    ));
  }, []);

  const updateTabContent = useCallback((tabId: string, content: string | JSONContent) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, content } : t
    ));
  }, []);

  const snapshotTab = useCallback((tabId: string, tiptapJSON: JSONContent | null, scrollPosition: number) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, tiptapJSON, scrollPosition } : t
    ));
  }, []);

  const extractFrontmatter = useCallback((rawContent: string): ExtractedFrontmatter => {
    const match = rawContent.match(FRONTMATTER_REGEX);
    if (!match) return { frontmatter: null, frontmatterRaw: null, body: rawContent };

    try {
      const parsed = jsYaml.load(match[1]);
      return {
        frontmatter: typeof parsed === 'object' && parsed !== null ? (parsed as Frontmatter) : null,
        frontmatterRaw: match[1],
        body: rawContent.slice(match[0].length),
      };
    } catch {
      showToast('Malformed YAML frontmatter', 'warning');
      return { frontmatter: null, frontmatterRaw: match[1], body: rawContent.slice(match[0].length) };
    }
  }, [showToast]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  // Conflict resolution: keep local changes (acknowledge the disk change)
  const resolveConflictKeep = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, hasConflict: false, conflictDiskContent: null } : t
    ));
  }, []);

  // --- Frontmatter operations ---

  const updateFrontmatter = useCallback((tabId: string, key: string, value: unknown) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...(t.frontmatter || {}), [key]: value };
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const addFrontmatterProperty = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = t.frontmatter || {};
      let keyName = 'key';
      let counter = 1;
      while (existing[keyName] !== undefined) {
        keyName = `key${counter++}`;
      }
      return { ...t, frontmatter: { ...existing, [keyName]: '' }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterProperty = useCallback((tabId: string, key: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const updated = { ...t.frontmatter };
      delete updated[key];
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const renameFrontmatterKey = useCallback((tabId: string, oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const entries = Object.entries(t.frontmatter || {});
      const updated: Frontmatter = {};
      for (const [k, v] of entries) {
        updated[k === oldKey ? newKey : k] = v;
      }
      return { ...t, frontmatter: updated, isDirty: true };
    }));
  }, []);

  const toggleFrontmatterCollapsed = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, frontmatterCollapsed: !t.frontmatterCollapsed } : t
    ));
  }, []);

  const addFrontmatterTag = useCallback((tabId: string, key: string, tagValue: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? (t.frontmatter![key] as string[]) : [];
      return { ...t, frontmatter: { ...t.frontmatter, [key]: [...existing, tagValue] }, isDirty: true };
    }));
  }, []);

  const removeFrontmatterTag = useCallback((tabId: string, key: string, index: number) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...(t.frontmatter![key] as string[])] : [];
      existing.splice(index, 1);
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  const updateFrontmatterTag = useCallback((tabId: string, key: string, index: number, newValue: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const existing = Array.isArray(t.frontmatter?.[key]) ? [...(t.frontmatter![key] as string[])] : [];
      existing[index] = newValue;
      return { ...t, frontmatter: { ...t.frontmatter, [key]: existing }, isDirty: true };
    }));
  }, []);

  // --- Dependent callbacks ---

  const restoreSession = useCallback(async (folderPath: string) => {
    const session = await storage.get(`session:${folderPath}`) as SessionSnapshot | null;
    if (!session?.openFilePaths?.length) return;

    const savedPaths = session.openFilePaths.slice(0, MAX_TABS);
    const tabsMap = new Map<string, Tab>();

    await Promise.all(savedPaths.map(async ({ path: filePath, scrollPosition, type, name: savedName }) => {
      // Synthetic tabs (agent chat, agent editor, repo editor) don't back onto
      // disk files — rebuild them in-memory instead of trying to read them.
      if (type === 'agent' || type === 'agent-editor' || type === 'repo-editor') {
        tabsMap.set(filePath, {
          id: crypto.randomUUID(),
          type,
          path: filePath,
          name: savedName ?? filePath.replace(/^[^:]+:\/\//, ''),
          content: null,
          tiptapJSON: null,
          isDirty: false,
          isQuipu: false,
          isMarkdown: false,
          scrollPosition: scrollPosition ?? 0,
          frontmatter: null,
          frontmatterRaw: null,
          diskContent: null,
          frontmatterCollapsed: true,
        });
        return;
      }

      const fileName = filePath.split(/[\\/]/).pop() || '';
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

        let parsedContent: JSONContent | null = null;
        if (isQuipu) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.type === 'quipu' && parsed.content) parsedContent = parsed.content;
          } catch { /* treat as text */ }
        }

        let frontmatter: Frontmatter | null = null;
        let frontmatterRaw: string | null = null;
        let bodyContent: string | JSONContent = content;
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

    const tabs = savedPaths.map(({ path }) => tabsMap.get(path)).filter((t): t is Tab => t != null);
    if (tabs.length === 0) return;

    setOpenTabs(tabs);
    const active = tabs.find(t => t.path === session.activeFilePath) ?? tabs[tabs.length - 1];
    setActiveTabId(active.id);

    if (session.expandedFolders?.length) {
      fileSystem.restoreExpandedFolders(session.expandedFolders);
    }
  }, [extractFrontmatter, fileSystem]);

  const reloadTabFromDisk = useCallback(async (tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const content = await fs.readFile(tab.path);
      const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');

      let bodyContent: string = content;
      let frontmatter: Frontmatter | null = tab.frontmatter;
      let frontmatterRaw: string | null = tab.frontmatterRaw;

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Failed to reload file: ' + message, 'error');
    }
  }, [openTabs, extractFrontmatter, showToast]);

  const openFile = useCallback(async (filePath: string, fileName: string) => {
    const existing = openTabs.find(t => t.path === filePath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    if (openTabs.length >= MAX_TABS) {
      showToast('Close a tab to open more files', 'warning');
      return;
    }

    const isPdf = /\.pdf$/i.test(fileName);
    const isMedia = /\.(jpe?g|png|gif|svg|webp|bmp|ico|mp4|webm|ogg|mov)$/i.test(fileName);
    if (isMedia || isPdf) {
      const newTab: Tab = {
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

      let parsedContent: JSONContent | null = null;
      if (isQuipu) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'quipu' && parsed.content) {
            parsedContent = parsed.content;
          }
        } catch { /* treat as text */ }
      }

      let frontmatter: Frontmatter | null = null;
      let frontmatterRaw: string | null = null;
      let bodyContent: string | JSONContent = content;
      if (isMarkdown && typeof content === 'string') {
        const fm = extractFrontmatter(content);
        frontmatter = fm.frontmatter;
        frontmatterRaw = fm.frontmatterRaw;
        bodyContent = fm.body;
      }

      const newTab: Tab = {
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
        diskContent: content,
        frontmatterCollapsed: true,
      };

      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to open file:', err);
      showToast('Failed to open file: ' + message, 'error');
    }
  }, [openTabs, showToast, extractFrontmatter]);

  type SyntheticTabType = 'agent' | 'agent-editor' | 'repo-editor';

  const openSyntheticTab = useCallback((tabType: SyntheticTabType, entityId: string, entityName: string) => {
    const path = `${tabType}://${entityId}`;
    const existing = openTabs.find(t => t.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    if (openTabs.length >= MAX_TABS) {
      showToast('Close a tab to open more', 'warning');
      return;
    }
    const isEditor = tabType === 'agent-editor' || tabType === 'repo-editor';
    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: tabType,
      path,
      name: isEditor ? `${entityName} — edit` : entityName,
      content: null,
      tiptapJSON: null,
      isDirty: false,
      isQuipu: false,
      isMarkdown: false,
      scrollPosition: 0,
      frontmatter: null,
      frontmatterRaw: null,
      diskContent: null,
      frontmatterCollapsed: true,
    };
    setOpenTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [openTabs, showToast]);

  const openAgentTab = useCallback((agentId: string, agentName: string) => {
    openSyntheticTab('agent', agentId, agentName);
  }, [openSyntheticTab]);

  const openAgentEditorTab = useCallback((agentId: string, agentName: string) => {
    openSyntheticTab('agent-editor', agentId, agentName);
  }, [openSyntheticTab]);

  const openRepoEditorTab = useCallback((repoId: string, repoName: string) => {
    openSyntheticTab('repo-editor', repoId, repoName);
  }, [openSyntheticTab]);

  const renameTabsByPath = useCallback((path: string, newName: string) => {
    setOpenTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.path !== path || t.name === newName) return t;
        changed = true;
        return { ...t, name: newName };
      });
      return changed ? next : prev;
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      const result = window.confirm(`Save changes to "${tab.name}" before closing?`);
      if (result) {
        // For now, just close. Full save-before-close would need editor instance.
      }
    }

    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
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

  const closeOtherTabs = useCallback((tabId: string) => {
    setOpenTabs(prev => prev.filter(t => t.id === tabId || t.isDirty));
    setActiveTabId(tabId);
  }, []);

  const reorderTabs = useCallback((activeId: string, overId: string) => {
    setOpenTabs(prev => {
      const oldIndex = prev.findIndex(t => t.id === activeId);
      const newIndex = prev.findIndex(t => t.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  const setIsDirty = useCallback((dirty: boolean) => {
    if (activeTabId) {
      setTabDirty(activeTabId, dirty);
    }
  }, [activeTabId, setTabDirty]);

  const resolveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveFile = useCallback(async (editorInstance: Editor | null) => {
    if (!activeTab) return;

    // NEVER write to binary files — they would be corrupted
    if (activeTab.isPdf || activeTab.isMedia || /\.pdf$/i.test(activeTab.name)) return;

    // Check if an extension handles saving for this file type
    const ext = getExtensionForTab(activeTab);
    if (ext?.onSave) {
      try {
        const content = await ext.onSave(activeTab, editorInstance);
        if (content === null) return;
        recentSavesRef.current.set(activeTab.path, Date.now());
        await fs.writeFile(activeTab.path, content);
        setOpenTabs(prev => prev.map(t =>
          t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content, hasConflict: false, conflictDiskContent: null } : t
        ));
        showToast('File saved', 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to save file:', err);
        showToast('Failed to save file: ' + message, 'error');
      }
      return;
    }

    if (!editorInstance) return;

    const isQuipuFile = activeTab.isQuipu || activeTab.name.endsWith('.quipu');
    let content: string;
    if (isQuipuFile) {
      content = JSON.stringify({
        type: 'quipu',
        version: 1,
        content: editorInstance.getJSON(),
        metadata: {
          savedAt: new Date().toISOString(),
        },
      }, null, 2);
    } else if (activeTab.name.endsWith('.md') || activeTab.name.endsWith('.markdown')) {
      const markdown = (editorInstance.storage as Record<string, any>).markdown.getMarkdown();
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
      setOpenTabs(prev => prev.map(t =>
        t.id === activeTab.id ? { ...t, isDirty: false, diskContent: content, hasConflict: false, conflictDiskContent: null } : t
      ));
      showToast('File saved', 'success');

      // Trigger server-side FRAME anchor re-resolution (debounced, fire-and-forget)
      if (workspacePath) {
        // Always pass the editor's plain-text corpus so the server uses the same
        // block-based newline counting as posToLineNumber/lineNumberToPos on the client.
        const doc = editorInstance.state.doc;
        const plainTextCorpus = doc.textBetween(0, doc.content.size, '\n');
        const filePath = activeTab.path;
        if (resolveDebounceRef.current) clearTimeout(resolveDebounceRef.current);
        resolveDebounceRef.current = setTimeout(() => {
          frameService.resolveAnnotations(workspacePath, filePath, plainTextCorpus)
            .catch(err => console.warn('[frame] resolve failed', err));
        }, 200);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to save file:', err);
      showToast('Failed to save file: ' + message, 'error');
    }
  }, [activeTab, showToast, workspacePath]);

  // Wrap deleteEntry to also close the tab if the deleted file was open
  const deleteEntry = useCallback(async (targetPath: string) => {
    const tab = openTabs.find(t => t.path === targetPath);
    if (tab) {
      closeTab(tab.id);
    }
    await fileSystem.deleteEntry(targetPath);
  }, [openTabs, closeTab, fileSystem]);

  // Wrap renameEntry to also update tab paths
  const renameEntry = useCallback(async (oldPath: string, newPath: string) => {
    await fileSystem.renameEntry(oldPath, newPath);
    setOpenTabs(prev => prev.map(t =>
      t.path === oldPath ? { ...t, path: newPath, name: newPath.split('/').pop() || '' } : t
    ));
  }, [fileSystem]);

  // Helper: apply a fresh file content to a tab (parse frontmatter, reset dirty)
  const applyFreshContent = useCallback((tab: Tab, fresh: string): Partial<Tab> => {
    const isMarkdown = tab.name.endsWith('.md') || tab.name.endsWith('.markdown');
    let frontmatter: Frontmatter | null = null;
    let frontmatterRaw: string | null = null;
    let bodyContent: string = fresh;
    if (isMarkdown && typeof fresh === 'string') {
      const fm = extractFrontmatter(fresh);
      frontmatter = fm.frontmatter;
      frontmatterRaw = fm.frontmatterRaw;
      bodyContent = fm.body;
    }
    return { content: bodyContent, tiptapJSON: null, isDirty: false, diskContent: fresh, frontmatter, frontmatterRaw };
  }, [extractFrontmatter]);

  // Conflict resolution: reload from disk (discard local changes)
  const resolveConflictReload = useCallback(async (tabId: string) => {
    const tab = openTabsRef.current.find(t => t.id === tabId);
    if (!tab) return;

    try {
      const fresh = (tab.conflictDiskContent as string) || await fs.readFile(tab.path);
      const updates = applyFreshContent(tab, fresh);
      setOpenTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, ...updates, hasConflict: false, conflictDiskContent: null, reloadKey: (t.reloadKey || 0) + 1 } : t
      ));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Failed to reload file: ' + message, 'error');
    }
  }, [applyFreshContent, showToast]);

  // Conflict resolution: dismiss (same as keep)
  const resolveConflictDismiss = useCallback((tabId: string) => {
    resolveConflictKeep(tabId);
  }, [resolveConflictKeep]);

  // --- Effects ---

  // When workspacePath changes (workspace switch), reset tabs and restore session
  useEffect(() => {
    const prevPath = prevWorkspacePathRef.current;
    prevWorkspacePathRef.current = workspacePath;

    // Skip when workspacePath is null
    if (!workspacePath) return;

    if (prevPath === null) {
      // First workspace load — restore session
      restoreSession(workspacePath).catch(() => {});
      return;
    }

    if (prevPath !== workspacePath) {
      // Workspace switched — reset tabs, then restore session
      setOpenTabs([]);
      setActiveTabId(null);
      restoreSession(workspacePath).catch(() => {});
    }
  }, [workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Electron: use native directory watcher
  useEffect(() => {
    if (!window.electronAPI || !workspacePath) return;

    fs.watchDirectory(workspacePath);

    const cleanup = fs.onDirectoryChanged(async (rawEvent) => {
      const event = rawEvent as FileChangeEvent;
      const filename = event.filename ?? event.path;
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        setOpenTabs(prev => prev.map(t =>
          t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
        ));
      } catch { /* file may be temporarily inaccessible */ }
    });

    return cleanup;
  }, [workspacePath, applyFreshContent]);

  // Browser: use fileWatcher WebSocket for push-based file change notifications
  useEffect(() => {
    if (window.electronAPI || !workspacePath) return;

    fileWatcher.watch(workspacePath).catch(() => {});

    const cleanup = fileWatcher.onChanged(async (rawEvent) => {
      const event = rawEvent as FileChangeEvent;
      const filename = event.filename ?? event.path;
      if (!filename) return;
      const fullPath = workspacePath + '/' + filename.replace(/\\/g, '/');

      const savedAt = recentSavesRef.current.get(fullPath);
      if (savedAt && Date.now() - savedAt < 3000) return;

      const tab = openTabsRef.current.find(t => t.path === fullPath);
      if (!tab || tab.isMedia) return;

      try {
        const fresh = await fs.readFile(fullPath);
        if (fresh === tab.diskContent) return;

        setOpenTabs(prev => prev.map(t =>
          t.id === tab.id ? { ...t, diskContent: fresh, hasConflict: true, conflictDiskContent: fresh } : t
        ));
      } catch { /* file may be temporarily inaccessible */ }
    });

    return () => {
      cleanup();
      fileWatcher.unwatch().catch(() => {});
    };
  }, [workspacePath, applyFreshContent]);

  // FRAME file watching
  const frameCleanupRef = useRef<ReturnType<typeof frameService.watchFrames> | null>(null);

  useEffect(() => {
    if (!workspacePath) return;

    const cleanup = frameService.watchFrames(workspacePath, (changedFilePath: string) => {
      const tab = openTabsRef.current.find(t => t.path === changedFilePath);
      if (!tab) return;

      setOpenTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, frameReloadKey: ((t as Tab & { frameReloadKey?: number }).frameReloadKey || 0) + 1 } : t
      ));
    });

    frameCleanupRef.current = cleanup;

    if (cleanup.registerPath) {
      for (const tab of openTabsRef.current) {
        if (!tab.isMedia) {
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
      if (!tab.isMedia) {
        cleanup.registerPath(frameService.getFramePath(workspacePath, tab.path));
      }
    }
  }, [openTabs, workspacePath]);

  const value: TabContextValue = {
    // Derived state
    activeFile,
    isDirty,
    // File operations
    openFile,
    openAgentTab,
    openAgentEditorTab,
    openRepoEditorTab,
    renameTabsByPath,
    saveFile,
    setIsDirty,
    updateTabContent,
    // Tab functions
    openTabs,
    activeTabId,
    activeTab,
    closeTab,
    switchTab,
    closeOtherTabs,
    reorderTabs,
    setTabDirty,
    snapshotTab,
    reloadTabFromDisk,
    // Conflict resolution
    resolveConflictReload,
    resolveConflictKeep,
    resolveConflictDismiss,
    // Frontmatter functions
    updateFrontmatter,
    addFrontmatterProperty,
    removeFrontmatterProperty,
    renameFrontmatterKey,
    toggleFrontmatterCollapsed,
    addFrontmatterTag,
    removeFrontmatterTag,
    updateFrontmatterTag,
    // Tab-aware overrides
    deleteEntry,
    renameEntry,
  };

  return (
    <TabContext.Provider value={value}>
      {children}
    </TabContext.Provider>
  );
}

export function useTab(): TabContextValue {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTab must be used within a TabProvider');
  }
  return context;
}
