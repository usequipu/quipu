import React, { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import { getLanguage } from '@/utils/fileTypes';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);

const CodeViewer = ({ content, fileName, onContentChange }) => {
  const language = getLanguage(fileName);
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const gutterRef = useRef(null);
  const [editableContent, setEditableContent] = useState(content || '');
  const [gutterWidth, setGutterWidth] = useState(0);

  // Sync when file changes externally
  useEffect(() => {
    setEditableContent(content || '');
  }, [content]);

  const highlighted = useMemo(() => {
    if (!editableContent) return '';
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(editableContent, { language }).value;
    }
    return hljs.highlightAuto(editableContent).value;
  }, [editableContent, language]);

  const lineCount = useMemo(() => {
    return (editableContent || '').split('\n').length;
  }, [editableContent]);

  // Measure gutter width dynamically so textarea paddingLeft matches
  useLayoutEffect(() => {
    if (gutterRef.current) {
      setGutterWidth(gutterRef.current.offsetWidth);
    }
  }, [lineCount]);

  const handleChange = useCallback((e) => {
    const newContent = e.target.value;
    setEditableContent(newContent);
    if (onContentChange) {
      onContentChange(newContent);
    }
  }, [onContentChange]);

  const handleScroll = useCallback((e) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.target.scrollTop;
      highlightRef.current.scrollLeft = e.target.scrollLeft;
    }
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (e.shiftKey) {
        // Dedent: remove leading 2 spaces from selected lines
        const value = textarea.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = end;
        const selectedText = value.substring(lineStart, lineEnd);
        const dedented = selectedText.replace(/^  /gm, '');
        const diff = selectedText.length - dedented.length;
        const newValue = value.substring(0, lineStart) + dedented + value.substring(lineEnd);
        setEditableContent(newValue);
        if (onContentChange) onContentChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = Math.max(lineStart, start - 2);
          textarea.selectionEnd = end - diff;
        });
      } else {
        // Indent: insert 2 spaces
        const newValue = editableContent.substring(0, start) + '  ' + editableContent.substring(end);
        setEditableContent(newValue);
        if (onContentChange) onContentChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    }
  }, [editableContent, onContentChange]);

  return (
    <div className={cn(
      "flex-1 flex justify-center items-start overflow-y-auto relative",
      "py-8 px-16",
      "max-[1400px]:justify-start max-[1400px]:pl-12",
      "max-[1200px]:overflow-x-auto max-[1200px]:p-8",
      "max-[1150px]:py-6 max-[1150px]:px-4",
    )}>
      <div className={cn(
        "w-[816px] min-h-[400px] bg-page-bg rounded border border-page-border",
        "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]",
        "relative shrink-0 overflow-hidden",
        "max-[1150px]:w-full max-[1150px]:max-w-[816px]",
      )}>
        <div className="flex overflow-hidden relative">
          {/* Line numbers */}
          <div ref={gutterRef} className="shrink-0 py-4 pr-2 pl-4 text-right select-none">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="font-mono text-xs leading-6 text-text-tertiary opacity-50">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Highlight layer (behind textarea) */}
          <pre
            ref={highlightRef}
            className="flex-1 py-4 pr-4 pl-2 font-mono text-sm leading-6 overflow-hidden m-0 bg-transparent whitespace-pre pointer-events-none"
            aria-hidden="true"
          >
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
            />
          </pre>

          {/* Editable textarea (transparent, on top) */}
          <textarea
            ref={textareaRef}
            value={editableContent}
            onChange={handleChange}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className={cn(
              "absolute inset-0 py-4 pr-4 font-mono text-sm leading-6",
              "bg-transparent text-transparent caret-text-primary",
              "resize-none outline-none border-none",
              "overflow-auto whitespace-pre",
            )}
            style={{ paddingLeft: gutterWidth ? `${gutterWidth + 8}px` : '3.5rem', tabSize: 2 }}
          />
        </div>
      </div>
    </div>
  );
};

export default CodeViewer;
