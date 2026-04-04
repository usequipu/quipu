import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getLanguage } from '@/utils/fileTypes';
import Editor from '@monaco-editor/react';

// Map hljs language names (from getLanguage) to Monaco language IDs
const MONACO_LANG_MAP = {
  javascript: 'javascript',
  typescript: 'typescript',
  json: 'json',
  css: 'css',
  xml: 'xml',
  html: 'html',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  bash: 'shell',
  yaml: 'yaml',
  sql: 'sql',
  ruby: 'ruby',
  php: 'php',
  ini: 'ini',
  scss: 'scss',
  less: 'less',
};

const getMonacoLanguage = (fileName) => {
  const lang = getLanguage(fileName);
  return MONACO_LANG_MAP[lang] || 'plaintext';
};

const CodeViewer = ({ activeFile, onContentChange }) => {
  const { content, name: fileName } = activeFile;
  const monacoLanguage = getMonacoLanguage(fileName);
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('quipu-code-font-size');
    return saved ? parseInt(saved, 10) : 14;
  });
  const editorRef = useRef(null);

  // Persist font size
  useEffect(() => {
    localStorage.setItem('quipu-code-font-size', String(fontSize));
  }, [fontSize]);

  const handleEditorDidMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const handleChange = useCallback((value) => {
    if (onContentChange) {
      onContentChange(value || '');
    }
  }, [onContentChange]);

  // Ctrl+scroll zoom for font size
  const codeContainerRef = useRef(null);
  useEffect(() => {
    const el = codeContainerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setFontSize(prev => {
        const delta = e.deltaY > 0 ? -1 : 1;
        return Math.min(32, Math.max(8, prev + delta));
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div
      ref={codeContainerRef}
      className={cn(
        "flex-1 flex justify-center items-start overflow-y-auto relative",
        "py-8 px-16",
        "max-[1400px]:justify-start max-[1400px]:pl-12",
        "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
        "max-[1150px]:py-6 max-[1150px]:px-4",
      )}
    >
      <div className={cn(
        "w-[816px] min-h-[400px] bg-page-bg rounded border border-page-border",
        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]",
        "relative shrink-0 overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
      )}>
        <Editor
          height="calc(100vh - 120px)"
          language={monacoLanguage}
          value={content || ''}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            fontSize,
            minimap: { enabled: false },
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: true,
            renderWhitespace: 'selection',
            tabSize: 2,
            padding: { top: 16, bottom: 16 },
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            automaticLayout: true,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
          loading={
            <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
              Loading editor...
            </div>
          }
        />
      </div>
    </div>
  );
};

export default CodeViewer;
