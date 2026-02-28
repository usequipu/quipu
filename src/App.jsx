import React, { useState, useEffect, useCallback } from 'react';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import FileExplorer from './components/FileExplorer';
import FolderPicker from './components/FolderPicker';
import TabBar from './components/TabBar';
import ActivityBar from './components/ActivityBar';
import SearchPanel from './components/SearchPanel';
import SourceControlPanel from './components/SourceControlPanel';
import QuickOpen from './components/QuickOpen';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { ToastProvider } from './components/Toast';
import './App.css';

function AppContent() {
  const [editorInstance, setEditorInstance] = useState(null);
  const terminalRef = React.useRef(null);
  const {
    activeFile, isDirty, saveFile, setIsDirty, showFolderPicker, selectFolder, cancelFolderPicker,
    activeTabId, activeTab, snapshotTab, openTabs, closeTab, switchTab,
  } = useWorkspace();
  const [activePanel, setActivePanel] = useState('explorer');
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);

  const handlePanelToggle = useCallback((panelId) => {
    setActivePanel(prev => prev === panelId ? null : panelId);
  }, []);

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
        setActivePanel(prev => prev ? null : 'explorer');
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
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setIsQuickOpenVisible(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editorInstance, activeFile, saveFile, activeTabId, openTabs, closeTab, switchTab]);

  const handleSendToTerminal = () => {
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
      terminalRef.current.write("claude\r");
      setTimeout(() => {
        terminalRef.current.write(output + "\r");
      }, 1000);
    }
  };

  const handleEditorReady = useCallback((editor) => {
    setEditorInstance(editor);
  }, []);

  const handleContentChange = useCallback(() => {
    if (activeFile) {
      setIsDirty(true);
    }
  }, [activeFile, setIsDirty]);

  // Build title
  let title = 'Quipu Simple';
  if (activeFile) {
    title = activeFile.name + (isDirty ? ' \u2022' : '');
  }

  return (
    <div className="app-container">
      {showFolderPicker && (
        <FolderPicker onSelect={selectFolder} onCancel={cancelFolderPicker} />
      )}
      <QuickOpen isOpen={isQuickOpenVisible} onClose={() => setIsQuickOpenVisible(false)} />
      <ActivityBar activePanel={activePanel} onPanelToggle={handlePanelToggle} />
      {activePanel && (
        <div className="side-panel">
          {activePanel === 'explorer' && <FileExplorer />}
          {activePanel === 'search' && <SearchPanel />}
          {activePanel === 'git' && <SourceControlPanel />}
        </div>
      )}
      <div className="main-area">
        <div className="editor-pane">
          <div className="editor-header">
            <div className="header-left">
              <button
                className="sidebar-toggle"
                onClick={() => setActivePanel(prev => prev ? null : 'explorer')}
                title="Toggle sidebar (Ctrl+B)"
              >
                {'\u2630'}
              </button>
              <span className="window-title">{title}</span>
            </div>
            <div className="header-right">
              {activeFile && isDirty && (
                <button className="save-btn" onClick={() => saveFile(editorInstance)}>
                  Save
                </button>
              )}
              <button className="send-btn" onClick={handleSendToTerminal}>Send to Terminal</button>
            </div>
          </div>
          <TabBar />
          <Editor
            onEditorReady={handleEditorReady}
            onContentChange={handleContentChange}
            activeFile={activeFile}
            activeTabId={activeTabId}
            activeTab={activeTab}
            snapshotTab={snapshotTab}
          />
        </div>
        <div className="terminal-pane">
          <Terminal ref={terminalRef} />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <AppContent />
      </WorkspaceProvider>
    </ToastProvider>
  );
}

export default App;
