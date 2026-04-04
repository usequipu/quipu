import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
});

let renderCounter = 0;

const MermaidViewer = ({ activeFile, onContentChange }) => {
  const { content, name: fileName } = activeFile;
  const [editableContent, setEditableContent] = useState(content || '');
  const [svgOutput, setSvgOutput] = useState('');
  const [error, setError] = useState(null);
  const previewRef = useRef(null);

  // Sync when file changes externally
  useEffect(() => {
    setEditableContent(content || '');
  }, [content]);

  // Render mermaid diagram
  useEffect(() => {
    if (!editableContent.trim()) {
      setSvgOutput('');
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const id = `mermaid-${++renderCounter}`;
        const { svg } = await mermaid.render(id, editableContent.trim());
        setSvgOutput(svg);
        setError(null);
      } catch (err) {
        setError(err.message || 'Invalid mermaid syntax');
        setSvgOutput('');
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [editableContent]);

  const handleChange = useCallback((e) => {
    const newContent = e.target.value;
    setEditableContent(newContent);
    if (onContentChange) {
      onContentChange(newContent);
    }
  }, [onContentChange]);

  const lineCount = useMemo(() => {
    return (editableContent || '').split('\n').length;
  }, [editableContent]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = editableContent.substring(0, start) + '  ' + editableContent.substring(end);
      setEditableContent(newValue);
      if (onContentChange) onContentChange(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }, [editableContent, onContentChange]);

  return (
    <div className={cn(
      "flex-1 flex overflow-hidden",
      "max-[1150px]:flex-col",
    )}>
      {/* Editor pane */}
      <div className={cn(
        "w-1/2 flex flex-col border-r border-border overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:h-1/2 max-[1150px]:border-r-0 max-[1150px]:border-b",
      )}>
        <div className="flex items-center px-4 py-2 bg-bg-elevated border-b border-border">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Source</span>
          <span className="ml-2 text-xs text-text-tertiary">{fileName}</span>
        </div>
        <div className="flex-1 flex overflow-auto">
          {/* Line numbers */}
          <div className="shrink-0 py-3 pr-2 pl-3 text-right select-none bg-bg-surface">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="font-mono text-xs leading-6 text-text-tertiary opacity-50">
                {i + 1}
              </div>
            ))}
          </div>
          {/* Textarea */}
          <textarea
            value={editableContent}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className={cn(
              "flex-1 py-3 px-2 font-mono text-sm leading-6",
              "bg-bg-surface text-text-primary",
              "resize-none outline-none border-none",
              "overflow-auto whitespace-pre",
            )}
            style={{ tabSize: 2 }}
          />
        </div>
      </div>

      {/* Preview pane */}
      <div className={cn(
        "w-1/2 flex flex-col overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:h-1/2",
      )}>
        <div className="flex items-center px-4 py-2 bg-bg-elevated border-b border-border">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Preview</span>
        </div>
        <div
          ref={previewRef}
          className={cn(
            "flex-1 flex items-center justify-center overflow-auto p-6",
            "bg-bg-surface",
          )}
        >
          {error ? (
            <div className="text-sm text-error font-mono whitespace-pre-wrap max-w-lg p-4 rounded bg-error/10">
              {error}
            </div>
          ) : svgOutput ? (
            <div
              className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svgOutput }}
            />
          ) : (
            <div className="text-text-tertiary text-sm italic">
              Enter mermaid syntax to see a preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MermaidViewer;
