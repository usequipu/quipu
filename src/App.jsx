import React, { useState, useEffect, useCallback } from 'react';
import { IconContext } from '@phosphor-icons/react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import Editor from './components/Editor';
import MediaViewer from './components/MediaViewer';
import Terminal from './components/Terminal';
import FileExplorer from './components/FileExplorer';
import FolderPicker from './components/FolderPicker';
import TabBar from './components/TabBar';
import ActivityBar from './components/ActivityBar';
import SearchPanel from './components/SearchPanel';
import SourceControlPanel from './components/SourceControlPanel';
import QuickOpen from './components/QuickOpen';
import TitleBar from './components/TitleBar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { ToastProvider, useToast } from './components/Toast';
import frameService from './services/frameService.js';

function AppContent() {
  const [editorInstance, setEditorInstance] = useState(null);
  const terminalRef = React.useRef(null);
  const {
    activeFile, saveFile, setIsDirty, showFolderPicker, selectFolder, cancelFolderPicker,
    activeTabId, activeTab, snapshotTab, openTabs, closeTab, switchTab,
    updateFrontmatter, addFrontmatterProperty, removeFrontmatterProperty,
    renameFrontmatterKey, toggleFrontmatterCollapsed, workspacePath,
  } = useWorkspace();
  const { showToast } = useToast();
  const [activePanel, setActivePanel] = useState('explorer');
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [quickOpenInitialValue, setQuickOpenInitialValue] = useState('');
  const [isClaudeRunning, setIsClaudeRunning] = useState(false);

  // Reset Claude running state when workspace changes (terminal restarts)
  useEffect(() => {
    setIsClaudeRunning(false);
  }, [workspacePath]);

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

  const handleSendToTerminal = useCallback(() => {
    if (!editorInstance) return;

    const json = editorInstance.getJSON();
    let output = '';

    const serializeNode = (node) => {
      if (node.type === 'text') {
        const commentMark = node.marks?.find(m => m.type === 'comment');
        if (commentMark) {
          return `<commented>${node.text}</commented><comment>${commentMark.attrs.comment}</comment>`;
        }
        return node.text;
      }

      if (node.content) {
        return node.content.map(serializeNode).join('');
      }

      if (node.type === 'paragraph') {
        return (node.content ? node.content.map(serializeNode).join('') : '') + '\n';
      }

      return '';
    };

    if (json.content) {
      output = json.content.map(serializeNode).join('');
    }

    if (terminalRef.current) {
      terminalRef.current.focus();
      if (isClaudeRunning) {
        terminalRef.current.write(output + "\r");
      } else {
        terminalRef.current.write("claude\r");
        setIsClaudeRunning(true);
        setTimeout(() => {
          terminalRef.current.write(output + "\r");
        }, 1000);
      }
    }
  }, [editorInstance, isClaudeRunning]);

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

    // Build context with file path and FRAME summary
    const relativePath = activeFile.path.replace(workspacePath + '/', '');
    let prompt = `Review and work with: ${relativePath}`;

    // Try to load FRAME context
    try {
      const frame = await frameService.readFrame(workspacePath, activeFile.path);
      if (frame) {
        if (frame.instructions) {
          prompt += `\n\nFile context: ${frame.instructions}`;
        }
        if (frame.annotations?.length > 0) {
          const notes = frame.annotations.map(a => `  - Line ${a.line}: [${a.type}] ${a.text}`).join('\n');
          prompt += `\n\nAnnotations:\n${notes}`;
        }
      }
    } catch {
      // FRAME read failed — proceed without it
    }

    terminalRef.current.focus();

    if (isClaudeRunning) {
      // Claude is already running — send prompt directly
      terminalRef.current.write(prompt + "\r");
    } else {
      // Launch Claude then send prompt
      terminalRef.current.write("claude\r");
      setIsClaudeRunning(true);
      setTimeout(() => {
        terminalRef.current.write(prompt + "\r");
      }, 1000);
    }
  }, [activeFile, workspacePath, editorInstance, activeTab, saveFile, terminalPanelRef, isClaudeRunning, showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (editorInstance && activeFile) {
          saveFile(editorInstance);
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
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        handleToggleTerminal();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (terminalPanelRef.current?.isCollapsed()) {
          terminalPanelRef.current.expand();
        }
        handleSendToTerminal();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        handleSendToClaude();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editorInstance, activeFile, saveFile, activeTabId, openTabs, closeTab, switchTab, handleToggleSidebar, handleToggleTerminal, handleSendToTerminal, handleSendToClaude, sidePanelRef, terminalPanelRef]);

  const handleEditorReady = useCallback((editor) => {
    setEditorInstance(editor);
  }, []);

  const handleContentChange = useCallback(() => {
    if (activeFile) {
      setIsDirty(true);
    }
  }, [activeFile, setIsDirty]);

  const handleMenuAction = useCallback((action) => {
    switch (action) {
      case 'file.save':
        if (editorInstance && activeFile) saveFile(editorInstance);
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
    }
  }, [editorInstance, activeFile, saveFile, activeTabId, closeTab, sidePanelRef, handlePanelToggle, handleToggleSidebar, handleToggleTerminal, toggleTheme, handleSendToClaude]);

  // Build title
  let title = 'Quipu';
  if (activeFile) {
    title = activeFile.name;
  }

  return (
    <div className="flex flex-col h-screen w-screen">
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
          <div className="h-full overflow-hidden flex flex-col bg-bg-surface">
            {activePanel === 'explorer' && <FileExplorer />}
            {activePanel === 'search' && <SearchPanel activePanel={activePanel} />}
            {activePanel === 'git' && <SourceControlPanel />}
          </div>
        </Panel>
        <Separator className="shrink-0 w-0 cursor-col-resize bg-transparent" style={{ WebkitAppRegion: 'no-drag' }} />
        <Panel>
          <Group orientation="vertical" style={{ height: '100%' }}>
            <Panel minSize={100}>
              <div className="h-full flex flex-col overflow-hidden relative">
                <TabBar />
                {activeFile ? (
                  activeTab?.isMedia ? (
                    <MediaViewer filePath={activeTab.path} fileName={activeTab.name} />
                  ) : (
                  <Editor
                    onEditorReady={handleEditorReady}
                    onContentChange={handleContentChange}
                    activeFile={activeFile}
                    activeTabId={activeTabId}
                    activeTab={activeTab}
                    snapshotTab={snapshotTab}
                    workspacePath={workspacePath}
                    updateFrontmatter={updateFrontmatter}
                    addFrontmatterProperty={addFrontmatterProperty}
                    removeFrontmatterProperty={removeFrontmatterProperty}
                    renameFrontmatterKey={renameFrontmatterKey}
                    toggleFrontmatterCollapsed={toggleFrontmatterCollapsed}
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
