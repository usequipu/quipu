import React, { useState, useEffect, useCallback } from 'react';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import FileExplorer from './components/FileExplorer';
import FolderPicker from './components/FolderPicker';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { ToastProvider } from './components/Toast';
import './App.css';

function AppContent() {
  const [editorInstance, setEditorInstance] = useState(null);
  const terminalRef = React.useRef(null);
  const { activeFile, isDirty, saveFile, setIsDirty, showFolderPicker, selectFolder, cancelFolderPicker } = useWorkspace();
  const [sidebarVisible, setSidebarVisible] = useState(true);

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
        setSidebarVisible(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editorInstance, activeFile, saveFile]);

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
      {sidebarVisible && <FileExplorer />}
      <div className="main-area">
        <div className="editor-pane">
          <div className="editor-header">
            <div className="header-left">
              <button
                className="sidebar-toggle"
                onClick={() => setSidebarVisible(prev => !prev)}
                title="Toggle sidebar (Ctrl+B)"
              >
                {sidebarVisible ? '\u2630' : '\u2630'}
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
          <Editor
            onEditorReady={handleEditorReady}
            onContentChange={handleContentChange}
            activeFile={activeFile}
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
