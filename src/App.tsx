import React, { useState, useEffect, useCallback } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Editor } from '@tiptap/react';
import Editor_ from './components/editor/Editor';
import Terminal from './components/ui/Terminal';
import FileExplorer from './components/ui/FileExplorer';
import { Dialog } from 'radix-ui';
import TabBar from './components/ui/TabBar';
import ActivityBar from './components/ui/ActivityBar';
import SearchPanel from './components/ui/SearchPanel';
import SourceControlPanel from './components/ui/SourceControlPanel';
import QuickOpen from './components/ui/QuickOpen';
import TitleBar from './components/ui/TitleBar';
import ContextMenu from './components/ui/ContextMenu';
import FileConflictBar from './components/ui/FileConflictBar';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { useFileSystem } from './context/FileSystemContext';
import { useTab } from './context/TabContext';
import { useTerminal } from './context/TerminalContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import frameService from './services/frameService';
import fs from './services/fileSystem';
import claudeInstaller from './services/claudeInstaller';
import DiffViewer from './extensions/diff-viewer/DiffViewer';
import { resolveViewer, getExtensionForTab, getCommandsForTab } from './extensions/registry';
import './extensions'; // register all viewer extensions

interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  danger?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ActiveDiff {
  filePath: string;
  diffText: string;
  isStaged: boolean;
}

function AppContent() {
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [editorRawMode, setEditorRawMode] = useState<boolean>(false);
  const toggleEditorModeRef = React.useRef<(() => void) | null>(null);
  const toggleFindRef = React.useRef<(() => void) | null>(null);
  const {
    workspacePath, showFolderPicker, selectFolder, cancelFolderPicker, revealFolder,
  } = useFileSystem();
  const {
    activeFile, saveFile, setIsDirty, updateTabContent, openFile,
    activeTabId, activeTab, snapshotTab, openTabs, closeTab, switchTab,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
    addFrontmatterTag, removeFrontmatterTag, updateFrontmatterTag,
    resolveConflictReload, resolveConflictKeep, resolveConflictDismiss,
    reloadTabFromDisk,
  } = useTab();
  const {
    terminalTabs, activeTerminalId, createTerminalTab, setTerminalClaudeRunning,
    sendToTerminal, clearTerminal, getTerminalSelection, hasTerminalSelection,
    pasteToTerminal, focusTerminal,
  } = useTerminal();
  const { showToast } = useToast();
  type PanelId = 'explorer' | 'search' | 'git';
  const [activePanel, setActivePanel] = useState<PanelId | null>('explorer');
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState<boolean>(false);
  const [quickOpenInitialValue, setQuickOpenInitialValue] = useState<string>('');
  // Input dialog state (replaces window.prompt which doesn't work in Electron)
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    placeholder: string;
    defaultValue: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const [inputDialogValue, setInputDialogValue] = useState('');
  const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null);

  // Derive isClaudeRunning from the active terminal tab
  const activeTerminalTab = terminalTabs.find(t => t.id === activeTerminalId);
  const isClaudeRunning = activeTerminalTab?.isClaudeRunning ?? false;

  // Snapshot the TipTap editor content before switching away to a non-Editor viewer (e.g., PDF)
  // Uses a ref + callback approach instead of useEffect to avoid race conditions
  // where Editor.jsx's content loading effect might run first
  const prevActiveTabIdRef = React.useRef<string | null>(activeTabId);
  // Track tab changes — snapshot only when switching TO a non-Editor viewer
  useEffect(() => {
    const prevId = prevActiveTabIdRef.current;
    prevActiveTabIdRef.current = activeTabId;

    if (prevId && prevId !== activeTabId) {
      // Check if the NEW active tab will NOT use the Editor component
      const newTab = openTabs.find(t => t.id === activeTabId);
      const isNewTabNonEditor = newTab && getExtensionForTab(newTab) !== null;

      // Only snapshot here if Editor is about to unmount (non-Editor tab)
      // For Editor-to-Editor switches, Editor.jsx handles the snapshot internally
      if (isNewTabNonEditor && editorInstance && !editorInstance.isDestroyed) {
        snapshotTab(prevId, editorInstance.getJSON(), 0);
      }
    }
  }, [activeTabId, editorInstance, snapshotTab, openTabs]);

  // Clear diff view when user switches to a different tab
  useEffect(() => {
    setActiveDiff(null);
  }, [activeTabId]);

  const handleOpenDiff = useCallback((filePath: string | null, diffText?: string, isStaged?: boolean) => {
    if (filePath === null) {
      setActiveDiff(null);
      return;
    }
    setActiveDiff({ filePath, diffText: diffText ?? '', isStaged: isStaged ?? false });
  }, []);

  const sidePanelRef = usePanelRef();
  const terminalPanelRef = usePanelRef();

  const handlePanelToggle = useCallback((panelId: PanelId) => {
    const isCollapsed = sidePanelRef.current?.isCollapsed();
    if (isCollapsed) {
      setActivePanel(panelId);
      sidePanelRef.current?.expand();
    } else if (activePanel === panelId) {
      setActivePanel(null);
      sidePanelRef.current?.collapse();
    } else {
      setActivePanel(panelId);
    }
  }, [activePanel, sidePanelRef]);

  const handleToggleSidebar = useCallback(() => {
    const isCollapsed = sidePanelRef.current?.isCollapsed();
    if (isCollapsed) {
      sidePanelRef.current?.expand();
      setActivePanel(prev => prev || 'explorer');
    } else {
      sidePanelRef.current?.collapse();
      setActivePanel(null);
    }
  }, [sidePanelRef]);

  const handleToggleTerminal = useCallback(() => {
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    } else {
      terminalPanelRef.current?.collapse();
    }
  }, [terminalPanelRef]);

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const current = localStorage.getItem('quipu-theme') || 'light';
    const cycle: Record<string, string> = { light: 'tinted', tinted: 'dark', dark: 'light' };
    const next = cycle[current] || 'light';
    root.classList.remove('dark', 'tinted');
    if (next !== 'light') root.classList.add(next);
    localStorage.setItem('quipu-theme', next);
  }, []);

  const handleSendToTerminal = useCallback(async () => {
    if (!activeFile || !workspacePath) {
      showToast('No file open to send to Claude', 'warning');
      return;
    }

    // Auto-save if dirty
    if (editorInstance && activeTab?.isDirty) {
      await saveFile(editorInstance);
    }

    // Ensure .claude skills/commands are installed in the workspace
    try {
      await claudeInstaller.installFrameSkills(workspacePath);
    } catch {
      // Non-blocking — proceed even if install fails
    }

    // Expand terminal if collapsed
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    }

    const relativePath = activeFile.path.replace(workspacePath + '/', '');
    const command = `/frame ${relativePath}`;

    focusTerminal();

    if (isClaudeRunning) {
      sendToTerminal(command + "\n");
    } else {
      sendToTerminal("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        sendToTerminal(command + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast, focusTerminal, sendToTerminal]);

  const handleSendToClaude = useCallback(async () => {
    if (!activeFile || !workspacePath) {
      showToast('No file open to send to Claude', 'warning');
      return;
    }

    // Auto-save if dirty
    if (editorInstance && activeTab?.isDirty) {
      await saveFile(editorInstance);
    }

    // Expand terminal if collapsed
    if (terminalPanelRef.current?.isCollapsed()) {
      terminalPanelRef.current.expand();
    }

    // Build prompt referencing FRAME skill, file path, and FRAME path
    const relativePath = activeFile.path.replace(workspacePath + '/', '');
    const framePath = `.quipu/meta/${relativePath}.frame.json`;
    let prompt = `Use the /frame skill. Read the file at ${relativePath} and its FRAME at ${framePath}. Review the code and address any annotations.`;

    // Append brief context if FRAME exists
    try {
      const frame = await frameService.readFrame(workspacePath, activeFile.path);
      if (frame) {
        if (frame.annotations?.length > 0) {
          prompt += ` There are ${frame.annotations.length} annotation(s) to address.`;
        }
        if (frame.instructions) {
          prompt += ` Context: ${frame.instructions}`;
        }
      }
    } catch {
      // FRAME read failed — proceed without it
    }

    focusTerminal();

    if (isClaudeRunning) {
      sendToTerminal(prompt + "\n");
    } else {
      sendToTerminal("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        sendToTerminal(prompt + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast, focusTerminal, sendToTerminal]);

  // Refs to hold latest callback values — avoids TDZ errors caused by
  // esbuild reordering const declarations in the production bundle.
  const sendToTerminalRef = React.useRef<() => Promise<void>>(handleSendToTerminal);
  sendToTerminalRef.current = handleSendToTerminal;
  const sendToClaudeRef = React.useRef<() => Promise<void>>(handleSendToClaude);
  sendToClaudeRef.current = handleSendToClaude;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile && activeTab) {
          const ext = getExtensionForTab(activeTab);
          const isNonTipTap = ext !== null || editorRawMode;
          saveFile(isNonTipTap ? null : editorInstance);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        if (openTabs.length > 1) {
          const currentIdx = openTabs.findIndex(t => t.id === activeTabId);
          let nextIdx: number;
          if (e.shiftKey) {
            nextIdx = (currentIdx - 1 + openTabs.length) % openTabs.length;
          } else {
            nextIdx = (currentIdx + 1) % openTabs.length;
          }
          switchTab(openTabs[nextIdx].id);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setActivePanel('search');
        if (sidePanelRef.current?.isCollapsed()) {
          sidePanelRef.current?.expand();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setQuickOpenInitialValue('> ');
        setIsQuickOpenVisible(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setQuickOpenInitialValue('');
        setIsQuickOpenVisible(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '`') {
        e.preventDefault();
        createTerminalTab();
        if (terminalPanelRef.current?.isCollapsed()) {
          terminalPanelRef.current.expand();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        handleToggleTerminal();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (terminalPanelRef.current?.isCollapsed()) {
          terminalPanelRef.current.expand();
        }
        sendToTerminalRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        sendToClaudeRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (activeTabId) reloadTabFromDisk(activeTabId);
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleFindRef.current?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editorInstance, activeFile, saveFile, activeTabId, openTabs, closeTab, switchTab, handleToggleSidebar, handleToggleTerminal, createTerminalTab, sidePanelRef, terminalPanelRef, reloadTabFromDisk]);

  // --- Global Context Menu ---
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();

      // If the right-click originated inside the FileExplorer's own context menu
      // items or its inline rename/create inputs, let its local handler win
      const target = e.target as HTMLElement;
      const fileTreeItem = target.closest('[data-context="file-tree-item"]');
      if (fileTreeItem) return;

      const x = e.clientX;
      const y = e.clientY;
      const items: ContextMenuItem[] = [];

      // --- Detect context by walking up the DOM ---
      const isEditor = !!target.closest('.ProseMirror');
      const isTerminal = !!target.closest('.xterm');
      const isTabBar = !!target.closest('[data-context="tab-bar"]');
      const isExplorer = !!target.closest('[data-context="explorer"]');

      // Check for text selection
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim().length > 0;

      // Check for terminal selection
      const hasTermSel = isTerminal && hasTerminalSelection();

      // --- Copy when text is selected (always first) ---
      if (hasSelection && !isTerminal) {
        const selectedText = selection!.toString();
        items.push({
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onClick: () => {
            navigator.clipboard.writeText(selectedText);
          },
        });
      }

      if (hasTermSel) {
        const terminalText = getTerminalSelection();
        items.push({
          label: 'Copy',
          shortcut: 'Ctrl+Shift+C',
          onClick: () => {
            navigator.clipboard.writeText(terminalText);
          },
        });
      }

      // --- Editor context ---
      if (isEditor && editorInstance) {
        const hasEditorSelection = !editorInstance.state.selection.empty;

        if (hasEditorSelection && items.length === 0) {
          // Selection exists but wasn't caught above (e.g., node selection)
          items.push({
            label: 'Copy',
            shortcut: 'Ctrl+C',
            onClick: () => document.execCommand('copy'),
          });
        }

        if (hasEditorSelection) {
          items.push({
            label: 'Cut',
            shortcut: 'Ctrl+X',
            onClick: () => document.execCommand('cut'),
          });
        }

        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              editorInstance.commands.insertContent(text);
            }).catch(() => {
              document.execCommand('paste');
            });
          },
        });

        items.push({
          label: 'Select All',
          shortcut: 'Ctrl+A',
          onClick: () => editorInstance.commands.selectAll(),
        });

        items.push({ separator: true });

        items.push({
          label: 'Bold',
          shortcut: 'Ctrl+B',
          onClick: () => editorInstance.chain().focus().toggleBold().run(),
        });
        items.push({
          label: 'Italic',
          shortcut: 'Ctrl+I',
          onClick: () => editorInstance.chain().focus().toggleItalic().run(),
        });
        items.push({
          label: 'Strikethrough',
          onClick: () => editorInstance.chain().focus().toggleStrike().run(),
        });

        // Table context items (if cursor is inside a table)
        if (editorInstance.isActive('table')) {
          items.push({ separator: true });
          items.push({
            label: 'Add Row Below',
            onClick: () => editorInstance.chain().focus().addRowAfter().run(),
          });
          items.push({
            label: 'Add Column After',
            onClick: () => editorInstance.chain().focus().addColumnAfter().run(),
          });
          items.push({
            label: 'Delete Row',
            onClick: () => editorInstance.chain().focus().deleteRow().run(),
            danger: true,
          });
          items.push({
            label: 'Delete Column',
            onClick: () => editorInstance.chain().focus().deleteColumn().run(),
            danger: true,
          });
        }
      }

      // --- Terminal context ---
      else if (isTerminal) {
        if (!hasTermSel) {
          // No selection — still offer paste
        }

        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+Shift+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              if (window.electronAPI) {
                (window.electronAPI as unknown as { writeTerminal: (data: string) => void }).writeTerminal(text);
              } else {
                pasteToTerminal(text);
              }
            }).catch(() => {});
          },
        });

        items.push({ separator: true });

        items.push({
          label: 'Clear Terminal',
          onClick: () => {
            clearTerminal();
          },
        });
      }

      // --- Tab bar context ---
      else if (isTabBar) {
        const tabEl = target.closest('[data-tab-id]') as HTMLElement | null;
        const tabId = tabEl?.dataset.tabId;

        if (tabId) {
          items.push({
            label: 'Close Tab',
            shortcut: 'Ctrl+W',
            onClick: () => closeTab(tabId),
          });
          items.push({
            label: 'Close Other Tabs',
            onClick: () => {
              openTabs.forEach((tab) => {
                if (tab.id !== tabId) closeTab(tab.id);
              });
            },
          });
          items.push({
            label: 'Close All Tabs',
            onClick: () => {
              openTabs.forEach((tab) => closeTab(tab.id));
            },
            danger: true,
          });
        }
      }

      // --- File Explorer context (fallback — tree items handle their own) ---
      else if (isExplorer) {
        // General explorer area right-click — nothing specific to offer
        // beyond paste if clipboard has content
      }

      // --- General / empty area fallback ---
      if (items.length === 0) {
        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              if (editorInstance) {
                editorInstance.commands.insertContent(text);
              }
            }).catch(() => {});
          },
        });
      }

      setContextMenu({ x, y, items });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [editorInstance, closeTab, openTabs]);

  const handleEditorReady = useCallback((editor: Editor) => {
    setEditorInstance(editor);
  }, []);

  const handleContentChange = useCallback((content?: string) => {
    if (activeFile) {
      setIsDirty(true);
      // For non-TipTap editors (e.g., Excalidraw), store updated content on the tab
      if (typeof content === 'string') {
        updateTabContent(activeTabId!, content);
      }
    }
  }, [activeFile, activeTabId, setIsDirty, updateTabContent]);

  const handleMenuAction = useCallback((action: string) => {
    switch (action) {
      case 'file.save':
        if (activeFile && activeTab) {
          const ext = getExtensionForTab(activeTab);
          const isNonTipTap = ext !== null || editorRawMode;
          saveFile(isNonTipTap ? null : editorInstance);
        }
        break;
      case 'file.closeTab':
        if (activeTabId) closeTab(activeTabId);
        break;
      case 'edit.undo':
        editorInstance?.commands.undo();
        break;
      case 'edit.redo':
        editorInstance?.commands.redo();
        break;
      case 'edit.findInFiles':
      case 'view.search':
        setActivePanel('search');
        if (sidePanelRef.current?.isCollapsed()) sidePanelRef.current?.expand();
        break;
      case 'view.explorer':
        handlePanelToggle('explorer');
        break;
      case 'view.git':
        handlePanelToggle('git');
        break;
      case 'view.toggleSidebar':
        handleToggleSidebar();
        break;
      case 'view.toggleTerminal':
      case 'terminal.toggle':
        handleToggleTerminal();
        break;
      case 'terminal.new':
        createTerminalTab();
        if (terminalPanelRef.current?.isCollapsed()) terminalPanelRef.current.expand();
        break;
      case 'view.quickOpen':
        setQuickOpenInitialValue('');
        setIsQuickOpenVisible(true);
        break;
      case 'view.commandPalette':
        setQuickOpenInitialValue('> ');
        setIsQuickOpenVisible(true);
        break;
      case 'edit.cut':
        document.execCommand('cut');
        break;
      case 'edit.copy':
        document.execCommand('copy');
        break;
      case 'edit.paste':
        document.execCommand('paste');
        break;
      case 'theme.toggle':
        toggleTheme();
        break;
      case 'terminal.send':
        handleSendToTerminal();
        break;
      case 'terminal.claude':
        handleSendToClaude();
        break;
      case 'editor.toggleMode':
        toggleEditorModeRef.current?.();
        break;
      default: {
        // Delegate to extension commands (e.g., kernel.runAll, kernel.interrupt, kernel.restart)
        if (activeTab) {
          const cmds = getCommandsForTab(activeTab);
          const cmd = cmds.find(c => c.id === action);
          if (cmd) cmd.handler();
        }
        break;
      }
    }
  }, [editorInstance, editorRawMode, activeFile, activeTab, saveFile, activeTabId, closeTab, sidePanelRef, terminalPanelRef, handlePanelToggle, handleToggleSidebar, handleToggleTerminal, createTerminalTab, toggleTheme, handleSendToTerminal, handleSendToClaude]);

  // Handle database pick/create events from slash commands and context menus
  useEffect(() => {
    const handlePickDatabase = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback) return;

      try {
        const filePath = await fs.openFileDialog({
          filters: [{ name: 'Quipu Database', extensions: ['quipudb.jsonl'] }],
        });

        if (filePath) {
          const relativePath = workspacePath && filePath.startsWith(workspacePath)
            ? filePath.slice(workspacePath.length + 1)
            : filePath;
          callback(relativePath);
        }
      } catch {
        // File dialog not available (browser mode or Electron handler not registered)
        // Fall back to asking for a path
        setInputDialogValue('');
        setInputDialog({
          title: 'Link Database',
          placeholder: 'Path to .quipudb.jsonl file',
          defaultValue: '',
          onSubmit: (path: string) => {
            if (path.trim()) callback(path.trim());
          },
        });
      }
    };

    const handleCreateDatabase = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const callback = detail?.callback as ((path: string) => void) | undefined;
      if (!callback || !activeFile || !workspacePath) return;

      const currentDir = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));

      setInputDialogValue('untitled');
      setInputDialog({
        title: 'Create Database',
        placeholder: 'Database name',
        defaultValue: 'untitled',
        onSubmit: async (name: string) => {
          if (!name.trim()) return;
          const fileName = `${name.trim()}.quipudb.jsonl`;
          const filePath = `${currentDir}/${fileName}`;

          try {
            const { createEmptyDatabase } = await import('./extensions/database-viewer/utils/jsonl');
            const initialContent = createEmptyDatabase(name.charAt(0).toUpperCase() + name.slice(1));
            await fs.createFile(filePath);
            await fs.writeFile(filePath, initialContent);

            const relativePath = filePath.startsWith(workspacePath!)
              ? filePath.slice(workspacePath!.length + 1)
              : filePath;
            callback(relativePath);
          } catch (err) {
            showToast('Failed to create database: ' + (err as Error).message, 'error');
          }
        },
      });
    };

    const handleOpenEmbeddedDatabase = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const src = detail?.src as string;
      if (!src || !workspacePath) return;
      const fullPath = src.startsWith('/') ? src : `${workspacePath}/${src}`;
      const fileName = src.split('/').pop() || src;
      openFile(fullPath, fileName);
    };

    window.addEventListener('quipu:pick-database', handlePickDatabase);
    window.addEventListener('quipu:create-database', handleCreateDatabase);
    window.addEventListener('quipu:open-embedded-database', handleOpenEmbeddedDatabase);
    return () => {
      window.removeEventListener('quipu:pick-database', handlePickDatabase);
      window.removeEventListener('quipu:create-database', handleCreateDatabase);
      window.removeEventListener('quipu:open-embedded-database', handleOpenEmbeddedDatabase);
    };
  }, [workspacePath, activeFile, openFile]);

  // Build title
  let title = 'Quipu';
  if (activeFile) {
    title = activeFile.name;
  }

  return (
    <div className="flex flex-col h-screen w-screen" data-workspace-path={workspacePath ?? ''}>
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
        />
      )}
      {showFolderPicker && (
        <Dialog.Root open onOpenChange={(open) => { if (!open) cancelFolderPicker(); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/35 z-[9998]" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-lg p-5 w-[400px] z-[9999]">
              <Dialog.Title className="text-sm font-medium text-text-primary mb-3">Open Folder</Dialog.Title>
              <form onSubmit={(e) => { e.preventDefault(); const input = (e.target as HTMLFormElement).elements.namedItem('path') as HTMLInputElement; if (input.value.trim()) selectFolder(input.value.trim()); }}>
                <input
                  name="path"
                  autoFocus
                  placeholder="Enter folder path..."
                  className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent mb-3"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={cancelFolderPicker} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                  <button type="submit" className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover">Open</button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {/* Input dialog (replaces window.prompt) */}
      {inputDialog && (
        <Dialog.Root open onOpenChange={(open) => { if (!open) setInputDialog(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/35 z-[9998]" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border rounded-lg shadow-lg p-5 w-[380px] z-[9999]">
              <Dialog.Title className="text-sm font-medium text-text-primary mb-3">{inputDialog.title}</Dialog.Title>
              <form onSubmit={(e) => {
                e.preventDefault();
                inputDialog.onSubmit(inputDialogValue);
                setInputDialog(null);
              }}>
                <input
                  autoFocus
                  value={inputDialogValue}
                  onChange={(e) => setInputDialogValue(e.target.value)}
                  placeholder={inputDialog.placeholder}
                  className="w-full px-3 py-2 text-sm bg-bg-surface border border-border rounded-md text-text-primary outline-none focus:border-accent mb-3"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setInputDialog(null)} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                  <button type="submit" className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent-hover">OK</button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <QuickOpen
        isOpen={isQuickOpenVisible}
        onClose={() => { setIsQuickOpenVisible(false); setQuickOpenInitialValue(''); }}
        onAction={handleMenuAction}
        initialValue={quickOpenInitialValue}
      />
      <TitleBar title={title} onAction={handleMenuAction} />
      <div className="flex flex-row flex-1 overflow-hidden">
        <ActivityBar activePanel={activePanel} onPanelToggle={handlePanelToggle} />
        <Group orientation="horizontal" style={{ flex: 1, overflow: 'hidden' }}>
        <Panel
          panelRef={sidePanelRef}
          collapsible
          collapsedSize={0}
          minSize={200}
          maxSize={400}
          defaultSize={250}
        >
          <div className="h-full overflow-hidden flex flex-col bg-bg-surface" data-context="explorer">
            {activePanel === 'explorer' && <FileExplorer />}
            {activePanel === 'search' && <SearchPanel activePanel={activePanel} />}
            {activePanel === 'git' && <SourceControlPanel onOpenDiff={handleOpenDiff} />}
          </div>
        </Panel>
        <Separator className="shrink-0 w-0 cursor-col-resize bg-transparent" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        <Panel>
          <Group orientation="vertical" style={{ height: '100%' }}>
            <Panel minSize={100}>
              <div className="h-full flex flex-col overflow-hidden relative">
                <div data-context="tab-bar">
                  <TabBar />
                </div>
                {activeTab?.hasConflict && (
                  <FileConflictBar
                    fileName={activeTab.name}
                    onReload={() => resolveConflictReload(activeTab.id)}
                    onKeep={() => resolveConflictKeep(activeTab.id)}
                    onDismiss={() => resolveConflictDismiss(activeTab.id)}
                  />
                )}
                {activeDiff ? (
                  <DiffViewer
                    filePath={activeDiff.filePath}
                    diffText={activeDiff.diffText}
                    isStaged={activeDiff.isStaged}
                    onClose={() => setActiveDiff(null)}
                  />
                ) : activeFile && activeTab ? (
                  (() => {
                    const Viewer = resolveViewer(activeTab, activeFile);
                    return Viewer ? (
                      <Viewer tab={activeTab} activeFile={activeFile} onContentChange={handleContentChange} isActive />
                    ) : (
                      <Editor_
                        onEditorReady={handleEditorReady}
                        onContentChange={handleContentChange}
                        onRawModeChange={setEditorRawMode}
                        onToggleEditorModeRef={toggleEditorModeRef}
                        onToggleFindRef={toggleFindRef}
                        activeFile={activeFile}
                        activeTabId={activeTabId}
                        activeTab={activeTab}
                        snapshotTab={snapshotTab}
                        workspacePath={workspacePath}
                        openFile={openFile}
                        revealFolder={revealFolder}
                        updateFrontmatter={updateFrontmatter}
                        addFrontmatterProperty={addFrontmatterProperty}
                        removeFrontmatterProperty={removeFrontmatterProperty}
                        renameFrontmatterKey={renameFrontmatterKey}
                        toggleFrontmatterCollapsed={toggleFrontmatterCollapsed}
                        addFrontmatterTag={addFrontmatterTag}
                        removeFrontmatterTag={removeFrontmatterTag}
                        updateFrontmatterTag={updateFrontmatterTag}
                      />
                    );
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center h-full w-full bg-bg-surface">
                    <div className="text-xl text-text-primary opacity-50 mb-2">Open a file to start editing</div>
                    <div className="text-sm text-text-primary opacity-35 italic">Use the Explorer or press Ctrl+P</div>
                  </div>
                )}
              </div>
            </Panel>
            <Separator className="shrink-0 h-px cursor-row-resize bg-border transition-colors hover:bg-accent/50 active:bg-accent" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
            <Panel
              panelRef={terminalPanelRef}
              collapsible
              collapsedSize={0}
              minSize={100}
              defaultSize={300}
            >
              <div className="h-full bg-bg-surface">
                <Terminal workspacePath={workspacePath} />
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
      </div>
    </div>
  );
}

function App() {
  return (
    <IconContext.Provider value={{ color: "currentColor", weight: "regular", size: 16 }}>
      <ToastProvider>
        <WorkspaceProvider>
          <AppContent />
        </WorkspaceProvider>
      </ToastProvider>
    </IconContext.Provider>
  );
}

export default App;
