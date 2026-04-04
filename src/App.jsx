import React, { useState, useEffect, useCallback } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import Editor from './components/Editor';
import MediaViewer from './components/MediaViewer';
import CodeViewer from './components/CodeViewer';
import Terminal from './components/Terminal';
import FileExplorer from './components/FileExplorer';
import FolderPicker from './components/FolderPicker';
import TabBar from './components/TabBar';
import ActivityBar from './components/ActivityBar';
import SearchPanel from './components/SearchPanel';
import SourceControlPanel from './components/SourceControlPanel';
import DiffViewer from './components/DiffViewer';
import QuickOpen from './components/QuickOpen';
import TitleBar from './components/TitleBar';
import ContextMenu from './components/ContextMenu';
import FileConflictBar from './components/FileConflictBar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { ToastProvider, useToast } from './components/Toast';
import frameService from './services/frameService.js';
import claudeInstaller from './services/claudeInstaller';
import { isCodeFile, isExcalidrawFile, isMermaidFile, isNotebookFile } from './utils/fileTypes';
import ExcalidrawViewer from './components/ExcalidrawViewer';
import MermaidViewer from './components/MermaidViewer';
import PdfViewer from './components/PdfViewer';
import NotebookViewer from './extensions/notebook/NotebookViewer';

function AppContent() {
  const [editorInstance, setEditorInstance] = useState(null);
  const terminalRef = React.useRef(null);
  const {
    activeFile, saveFile, setIsDirty, updateTabContent, showFolderPicker, selectFolder, cancelFolderPicker, openFile,
    activeTabId, activeTab, snapshotTab, openTabs, closeTab, switchTab,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed,
    addFrontmatterTag, removeFrontmatterTag, updateFrontmatterTag,
    workspacePath, revealFolder,
    terminalTabs, activeTerminalId, createTerminalTab, setTerminalClaudeRunning,
    resolveConflictReload, resolveConflictKeep, resolveConflictDismiss,
    reloadTabFromDisk,
  } = useWorkspace();
  const { showToast } = useToast();
  const [activePanel, setActivePanel] = useState('explorer');
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [quickOpenInitialValue, setQuickOpenInitialValue] = useState('');
  const [activeDiff, setActiveDiff] = useState(null); // { filePath, diffText, isStaged }

  // Derive isClaudeRunning from the active terminal tab
  const activeTerminalTab = terminalTabs.find(t => t.id === activeTerminalId);
  const isClaudeRunning = activeTerminalTab?.isClaudeRunning ?? false;

  // Expose terminal ref globally for context menu access
  useEffect(() => {
    window.__quipuTerminalRef = terminalRef;
    return () => { delete window.__quipuTerminalRef; };
  }, []);

  // Snapshot the TipTap editor content before switching away to a non-Editor viewer (e.g., PDF)
  // Uses a ref + callback approach instead of useEffect to avoid race conditions
  // where Editor.jsx's content loading effect might run first
  const prevActiveTabIdRef = React.useRef(activeTabId);
  // Track tab changes — snapshot only when switching TO a non-Editor viewer
  useEffect(() => {
    const prevId = prevActiveTabIdRef.current;
    prevActiveTabIdRef.current = activeTabId;

    if (prevId && prevId !== activeTabId) {
      // Check if the NEW active tab will NOT use the Editor component
      const newTab = openTabs.find(t => t.id === activeTabId);
      const isNewTabNonEditor = newTab && (
        newTab.isPdf || newTab.isMedia || newTab.isNotebook ||
        isExcalidrawFile(newTab.name) || isMermaidFile(newTab.name) ||
        (isCodeFile(newTab.name) && !newTab.isQuipu)
      );

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

  const handleOpenDiff = useCallback((filePath, diffText, isStaged) => {
    if (filePath === null) {
      setActiveDiff(null);
      return;
    }
    setActiveDiff({ filePath, diffText, isStaged });
  }, []);

  const sidePanelRef = usePanelRef();
  const terminalPanelRef = usePanelRef();

  const handlePanelToggle = useCallback((panelId) => {
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
    const cycle = { light: 'tinted', tinted: 'dark', dark: 'light' };
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
    if (!terminalRef.current) {
      showToast('Terminal not connected', 'error');
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

    terminalRef.current.focus();

    if (isClaudeRunning) {
      terminalRef.current.write(command + "\n");
    } else {
      terminalRef.current.write("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        terminalRef.current.write(command + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast]);

  const handleSendToClaude = useCallback(async () => {
    if (!activeFile || !workspacePath) {
      showToast('No file open to send to Claude', 'warning');
      return;
    }
    if (!terminalRef.current) {
      showToast('Terminal not connected', 'error');
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

    terminalRef.current.focus();

    if (isClaudeRunning) {
      terminalRef.current.write(prompt + "\n");
    } else {
      terminalRef.current.write("claude\n");
      if (activeTerminalId) setTerminalClaudeRunning(activeTerminalId, true);
      setTimeout(() => {
        terminalRef.current.write(prompt + "\n");
      }, 2000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, activeTerminalId, setTerminalClaudeRunning, showToast]);

  // Refs to hold latest callback values — avoids TDZ errors caused by
  // esbuild reordering const declarations in the production bundle.
  const sendToTerminalRef = React.useRef(handleSendToTerminal);
  sendToTerminalRef.current = handleSendToTerminal;
  const sendToClaudeRef = React.useRef(handleSendToClaude);
  sendToClaudeRef.current = handleSendToClaude;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile) {
          const isNonTipTap = isExcalidrawFile(activeFile.name) || isCodeFile(activeFile.name) || isMermaidFile(activeFile.name) || isNotebookFile(activeFile.name) || window.__quipuEditorRawMode;
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
          let nextIdx;
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
        window.__quipuToggleFind?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editorInstance, activeFile, saveFile, activeTabId, openTabs, closeTab, switchTab, handleToggleSidebar, handleToggleTerminal, createTerminalTab, sidePanelRef, terminalPanelRef, reloadTabFromDisk]);

  // --- Global Context Menu ---
  const [contextMenu, setContextMenu] = useState(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();

      // If the right-click originated inside the FileExplorer's own context menu
      // items or its inline rename/create inputs, let its local handler win
      const fileTreeItem = e.target.closest('[data-context="file-tree-item"]');
      if (fileTreeItem) return;

      const x = e.clientX;
      const y = e.clientY;
      const items = [];

      // --- Detect context by walking up the DOM ---
      const isEditor = !!e.target.closest('.ProseMirror');
      const isTerminal = !!e.target.closest('.xterm');
      const isTabBar = !!e.target.closest('[data-context="tab-bar"]');
      const isExplorer = !!e.target.closest('[data-context="explorer"]');

      // Check for text selection
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim().length > 0;

      // Check for terminal selection
      const termRef = window.__quipuTerminalRef;
      const hasTerminalSelection = isTerminal && termRef?.current && typeof termRef.current.hasSelection === 'function' && termRef.current.hasSelection();

      // --- Copy when text is selected (always first) ---
      if (hasSelection && !isTerminal) {
        const selectedText = selection.toString();
        items.push({
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onClick: () => {
            navigator.clipboard.writeText(selectedText);
          },
        });
      }

      if (hasTerminalSelection) {
        const terminalText = termRef.current.getSelection();
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
        if (!hasTerminalSelection) {
          // No selection — still offer paste
        }

        items.push({
          label: 'Paste',
          shortcut: 'Ctrl+Shift+V',
          onClick: () => {
            navigator.clipboard.readText().then((text) => {
              if (window.electronAPI) {
                window.electronAPI.writeTerminal(text);
              } else if (termRef?.current) {
                termRef.current.paste(text);
              }
            }).catch(() => {});
          },
        });

        items.push({ separator: true });

        items.push({
          label: 'Clear Terminal',
          onClick: () => {
            const term = window.__quipuXtermInstance;
            if (term) term.clear();
          },
        });
      }

      // --- Tab bar context ---
      else if (isTabBar) {
        const tabEl = e.target.closest('[data-tab-id]');
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

  const handleEditorReady = useCallback((editor) => {
    setEditorInstance(editor);
  }, []);

  const handleContentChange = useCallback((content) => {
    if (activeFile) {
      setIsDirty(true);
      // For non-TipTap editors (e.g., Excalidraw), store updated content on the tab
      if (typeof content === 'string') {
        updateTabContent(activeTabId, content);
      }
    }
  }, [activeFile, activeTabId, setIsDirty, updateTabContent]);

  const handleMenuAction = useCallback((action) => {
    switch (action) {
      case 'file.save':
        if (activeFile) {
          const isNonTipTap = isExcalidrawFile(activeFile.name) || isCodeFile(activeFile.name) || isMermaidFile(activeFile.name) || isNotebookFile(activeFile.name) || window.__quipuEditorRawMode;
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
        window.__quipuToggleEditorMode?.();
        break;
      case 'kernel.runAll':
      case 'kernel.interrupt':
      case 'kernel.restart':
        window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: action }));
        break;
    }
  }, [editorInstance, activeFile, saveFile, activeTabId, closeTab, sidePanelRef, terminalPanelRef, handlePanelToggle, handleToggleSidebar, handleToggleTerminal, createTerminalTab, toggleTheme, handleSendToTerminal, handleSendToClaude]);

  // Build title
  let title = 'Quipu';
  if (activeFile) {
    title = activeFile.name;
  }

  return (
    <div className="flex flex-col h-screen w-screen">
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
        <Separator className="shrink-0 w-0 cursor-col-resize bg-transparent" style={{ WebkitAppRegion: 'no-drag' }} />
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
                ) : activeFile ? (
                  activeTab?.isPdf ? (
                    <PdfViewer filePath={activeTab.path} fileName={activeTab.name} />
                  ) : activeTab?.isMedia ? (
                    <MediaViewer filePath={activeTab.path} fileName={activeTab.name} />
                  ) : isExcalidrawFile(activeFile.name) ? (
                    <ExcalidrawViewer
                      content={activeFile.content}
                      filePath={activeTab.path}
                      onContentChange={handleContentChange}
                    />
                  ) : isMermaidFile(activeFile.name) ? (
                    <MermaidViewer content={activeFile.content} fileName={activeFile.name} onContentChange={handleContentChange} />
                  ) : isNotebookFile(activeFile.name) ? (
                    <NotebookViewer filePath={activeTab.path} fileName={activeFile.name} content={activeFile.content} />
                  ) : isCodeFile(activeFile.name) && !activeFile.isQuipu ? (
                    <CodeViewer content={activeFile.content} fileName={activeFile.name} onContentChange={handleContentChange} />
                  ) : (
                    <Editor
                      onEditorReady={handleEditorReady}
                      onContentChange={handleContentChange}
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
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full w-full bg-bg-surface">
                    <div className="text-xl text-text-primary opacity-50 mb-2">Open a file to start editing</div>
                    <div className="text-sm text-text-primary opacity-35 italic">Use the Explorer or press Ctrl+P</div>
                  </div>
                )}
              </div>
            </Panel>
            <Separator className="shrink-0 h-px cursor-row-resize bg-border transition-colors hover:bg-accent/50 active:bg-accent" style={{ WebkitAppRegion: 'no-drag' }} />
            <Panel
              panelRef={terminalPanelRef}
              collapsible
              collapsedSize={0}
              minSize={100}
              defaultSize={300}
            >
              <div className="h-full bg-bg-surface">
                <Terminal ref={terminalRef} workspacePath={workspacePath} />
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
