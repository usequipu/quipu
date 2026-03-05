import { useState, useCallback, useRef, useEffect } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const ExcalidrawViewer = ({ content, filePath, onContentChange }) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const initialDataRef = useRef(null);
  const isInitializedRef = useRef(false);

  // Parse initial data from file content
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
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }
    if (!excalidrawAPI || !onContentChange) return;

    const json = serializeAsJSON(elements, appState, files, 'local');
    onContentChange(json);
  }, [excalidrawAPI, onContentChange]);

  // Reset when file changes
  useEffect(() => {
    initialDataRef.current = null;
    isInitializedRef.current = false;
  }, [filePath]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={initialDataRef.current}
        onChange={handleChange}
        theme="dark"
      />
    </div>
  );
};

export default ExcalidrawViewer;
