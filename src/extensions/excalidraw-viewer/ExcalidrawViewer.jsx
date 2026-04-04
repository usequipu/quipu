import { useState, useCallback, useRef, useEffect } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const ExcalidrawViewer = ({ tab, activeFile, onContentChange }) => {
  const { content } = activeFile;
  const filePath = tab.path;
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const initialDataRef = useRef(null);
  const ignoreChangesRef = useRef(true);
  const debounceRef = useRef(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Parse initial data from file content (only once per file)
  if (!initialDataRef.current && content) {
    try {
      const parsed = JSON.parse(content);
      initialDataRef.current = {
        elements: parsed.elements || [],
        appState: {
          ...parsed.appState,
          collaborators: [],
        },
        files: parsed.files || undefined,
      };
    } catch {
      initialDataRef.current = { elements: [], appState: {} };
    }
  }

  const handleChange = useCallback((elements, appState, files) => {
    // Ignore onChange during initialization window to prevent false dirty state
    if (ignoreChangesRef.current) return;

    // Debounce to avoid excessive state updates
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const json = serializeAsJSON(elements, appState, files, 'local');
      onContentChangeRef.current?.(json);
    }, 300);
  }, []);

  // Reset initialization window when file changes
  useEffect(() => {
    initialDataRef.current = null;
    ignoreChangesRef.current = true;
    const timer = setTimeout(() => { ignoreChangesRef.current = false; }, 800);
    return () => clearTimeout(timer);
  }, [filePath]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Intercept Ctrl+S before Excalidraw captures it
  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();
      // App-level Ctrl+S handler will fire from the window keydown listener
    }
  }, []);

  return (
    <div className="h-full w-full" onKeyDownCapture={handleKeyDown}>
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={initialDataRef.current}
        onChange={handleChange}
        theme="dark"
        UIOptions={{
          canvasActions: {
            saveAsImage: false,
            export: false,
          },
        }}
      />
    </div>
  );
};

export default ExcalidrawViewer;
