import React, { useState, useEffect, useCallback } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Editor } from '@tiptap/react';
import Editor_ from './components/editor/Editor';
import Terminal from './components/ui/Terminal';
import { Dialog } from 'radix-ui';
import TabBar from './components/ui/TabBar';
import ActivityBar from './components/ui/ActivityBar';
import QuickOpen from './components/ui/QuickOpen';
import TitleBar from './components/ui/TitleBar';
import ContextMenu from './components/ui/ContextMenu';
import FolderPicker from './components/ui/FolderPicker';
import FileConflictBar from './components/ui/FileConflictBar';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { useFileSystem } from './context/FileSystemContext';
import { useTab } from './context/TabContext';
import { useTerminal } from './context/TerminalContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import frameService from './services/frameService';
import fs from './services/fileSystem';
import gitServiceInstance from './services/gitService';
import kernelServiceInstance from './services/kernelService';
import terminalServiceInstance from './services/terminalService';
import claudeInstaller from './services/claudeInstaller';
import DiffViewer from './extensions/diff-viewer/DiffViewer';
import { resolveViewer, registerExtension, getExtensionForTab, getCommandsForTab } from './extensions/registry';
import { getRegisteredPanels, registerPanel } from './extensions/panelRegistry';
import { registerCommand, executeCommand } from './extensions/commandRegistry';
import { registerKeybinding, resolveKeybinding } from './extensions/keybindingRegistry';
import pluginLoader, { createPluginApi } from './services/pluginLoader';
import type { PluginApi } from './types/plugin-types';
import { builtinKeybindings } from './data/builtinKeybindings';
import FirstRunWizard from './components/ui/FirstRunWizard';
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
  // Incremented after plugins finish loading so resolveViewer re-runs for already-open tabs.
  const [, setPluginRevision] = useState(0);
  const toggleEditorModeRef = React.useRef<(() => void) | null>(null);
  const toggleFindRef = React.useRef<(() => void) | null>(null);
  const {
    workspacePath, showFolderPicker, selectFolder, cancelFolderPicker, revealFolder, openFolder,
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
  const [activePanel, setActivePanel] = useState<string | null>('explorer');
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
  const [showWizard, setShowWizard] = useState(false);

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

  // Plugin loader startup — runs once after mount.
  // Registers built-in commands (via appActionsRef) and keybindings, then loads plugins.
  useEffect(() => {
    // --- Diff overlay commands ---
    registerCommand('diff.open', (...args: unknown[]) => {
      const payload = args[0] as { filePath: string; diffText: string; isStaged: boolean };
      setActiveDiff({
        filePath: payload.filePath,
        diffText: payload.diffText ?? '',
        isStaged: payload.isStaged ?? false,
      });
    }, { label: 'Open Diff View', category: 'View' });
    registerCommand('diff.close', () => { setActiveDiff(null); }, { label: 'Close Diff View', category: 'View' });

    // --- Built-in app commands (delegate to appActionsRef so they always use current state) ---
    registerCommand('file.save',           () => appActionsRef.current.save(),               { label: 'Save File',        category: 'File' });
    registerCommand('view.toggleSidebar',  () => appActionsRef.current.toggleSidebar(),      { label: 'Toggle Sidebar',   category: 'View' });
    registerCommand('file.closeTab',       () => appActionsRef.current.closeTab(),           { label: 'Close Tab',        category: 'File' });
    registerCommand('tab.next',            () => appActionsRef.current.nextTab(),            { label: 'Next Tab',         category: 'View' });
    registerCommand('tab.prev',            () => appActionsRef.current.prevTab(),            { label: 'Previous Tab',     category: 'View' });
    registerCommand('view.search',         () => appActionsRef.current.openSearch(),         { label: 'Search',           category: 'View' });
    registerCommand('view.commandPalette', () => appActionsRef.current.openCommandPalette(), { label: 'Command Palette',  category: 'View' });
    registerCommand('view.quickOpen',      () => appActionsRef.current.openQuickOpen(),      { label: 'Quick Open',       category: 'View' });
    registerCommand('terminal.new',        () => appActionsRef.current.newTerminal(),        { label: 'New Terminal',     category: 'Terminal' });
    registerCommand('terminal.toggle',     () => appActionsRef.current.toggleTerminal(),     { label: 'Toggle Terminal',  category: 'Terminal' });
    registerCommand('terminal.send',       () => appActionsRef.current.sendToTerminal(),     { label: 'Send to Terminal', category: 'Terminal' });
    registerCommand('terminal.claude',     () => appActionsRef.current.sendToClaude(),       { label: 'Send to Claude',   category: 'Terminal' });
    registerCommand('file.reloadFromDisk', () => appActionsRef.current.reloadFromDisk(),    { label: 'Reload from Disk', category: 'File' });
    registerCommand('editor.find',         () => appActionsRef.current.find(),               { label: 'Find',             category: 'Editor' });

    // --- Built-in keybindings (registered before plugins so they always win conflicts) ---
    builtinKeybindings.forEach(registerKeybinding);

    // --- Load installed plugins ---
    const api = createPluginApi({
      register: registerExtension,
      registerPanel,
      registerCommand,
      executeCommand,
      services: {
        fileSystem: fs,
        gitService: gitServiceInstance,
        kernelService: kernelServiceInstance,
        terminalService: terminalServiceInstance,
      } as unknown as PluginApi['services'],
    });

    pluginLoader.loadAll(api, { registerKeybinding }).then((result) => {
      if (result.firstRun) setShowWizard(true);
      result.errors.forEach((err) => {
        showToast(`Plugin "${err.id}" failed to load: ${err.reason}`, 'warning');
      });
      setPluginRevision(r => r + 1);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sidePanelRef = usePanelRef();
  const terminalPanelRef = usePanelRef();

  const handlePanelToggle = useCallback((panelId: string) => {
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

  // Single ref holding all app actions that keyboard commands need.
  // Updated synchronously on every render so command handlers always see the
  // latest state without stale-closure issues.
  const appActionsRef = React.useRef<{
    save: () => void;
    toggleSidebar: () => void;
    closeTab: () => void;
    nextTab: () => void;
    prevTab: () => void;
    openSearch: () => void;
    openCommandPalette: () => void;
    openQuickOpen: () => void;
    newTerminal: () => void;
    toggleTerminal: () => void;
    sendToTerminal: () => Promise<void>;
    sendToClaude: () => Promise<void>;
    reloadFromDisk: () => void;
    find: () => void;
  }>(null!);
  appActionsRef.current = {
    save: () => {
      if (activeFile && activeTab) {
        const ext = getExtensionForTab(activeTab);
        saveFile((ext !== null || editorRawMode) ? null : editorInstance);
      }
    },
    toggleSidebar: handleToggleSidebar,
    closeTab: () => { if (activeTabId) closeTab(activeTabId); },
    nextTab: () => {
      if (openTabs.length > 1) {
        const idx = openTabs.findIndex(t => t.id === activeTabId);
        switchTab(openTabs[(idx + 1) % openTabs.length].id);
      }
    },
    prevTab: () => {
      if (openTabs.length > 1) {
        const idx = openTabs.findIndex(t => t.id === activeTabId);
        switchTab(openTabs[(idx - 1 + openTabs.length) % openTabs.length].id);
      }
    },
    openSearch: () => {
      setActivePanel('search');
      if (sidePanelRef.current?.isCollapsed()) sidePanelRef.current?.expand();
    },
    openCommandPalette: () => { setQuickOpenInitialValue('> '); setIsQuickOpenVisible(true); },
    openQuickOpen: () => { setQuickOpenInitialValue(''); setIsQuickOpenVisible(prev => !prev); },
    newTerminal: () => {
      createTerminalTab();
      if (terminalPanelRef.current?.isCollapsed()) terminalPanelRef.current.expand();
    },
    toggleTerminal: handleToggleTerminal,
    sendToTerminal: handleSendToTerminal,
    sendToClaude: handleSendToClaude,
    reloadFromDisk: () => { if (activeTabId) reloadTabFromDisk(activeTabId); },
    find: () => { toggleFindRef.current?.(); },
  };

  // Keyboard shortcuts — all shortcuts are driven by the keybinding registry.
  // Built-in keybindings are registered in the startup effect above; plugins add
  // their own after loadAll(). resolveKeybinding() calls e.preventDefault() and
  // executeCommand() for any match, so no hardcoded checks belong here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { resolveKeybinding(e); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

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
      case 'file.openFolder':
        openFolder();
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
      {showWizard && <FirstRunWizard onComplete={() => setShowWizard(false)} />}
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
        />
      )}
      {showFolderPicker && (
        <FolderPicker onSelect={selectFolder} onCancel={cancelFolderPicker} />
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
      <div className="flex flex-row flex-1 overflow-hidden">
        <ActivityBar activePanel={activePanel} onPanelToggle={handlePanelToggle} />
        <div className="flex flex-col flex-1 overflow-hidden">
        <TitleBar title={title} onAction={handleMenuAction} />
        <Group orientation="horizontal" style={{ flex: 1, overflow: 'hidden' }}>
        <Panel
          panelRef={sidePanelRef}
          collapsible
          collapsedSize={0}
          minSize={200}
          maxSize={400}
          defaultSize={250}
        >
          <div className="h-full overflow-hidden flex flex-col bg-bg-surface relative z-10" data-context="explorer">
            {(() => {
              if (!activePanel) return null;
              const panel = getRegisteredPanels().find((p) => p.id === activePanel);
              if (!panel) return null;
              // Extra props for built-in panels that require them; plugin panels receive nothing.
              const panelPropsMap: Record<string, Record<string, unknown>> = {
                search: { activePanel },
              };
              const PanelComp = panel.component as React.ComponentType<Record<string, unknown>>;
              return <PanelComp {...(panelPropsMap[activePanel] ?? {})} />;
            })()}
          </div>
        </Panel>
        <Separator className="shrink-0 w-px cursor-col-resize bg-border" style={{ WebkitAppRegion: 'no-drag', boxShadow: 'var(--sidebar-shadow)' } as React.CSSProperties} />
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
                      <Viewer tab={activeTab} activeFile={activeFile} onContentChange={handleContentChange} isActive workspacePath={workspacePath ?? ''} showToast={showToast} />
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
