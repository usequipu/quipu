import React, { useMemo } from 'react';
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

const CodeViewer = ({ content, fileName }) => {
  const language = getLanguage(fileName);

  const highlighted = useMemo(() => {
    if (!content) return '';
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    return hljs.highlightAuto(content).value;
  }, [content, language]);

  const lineCount = useMemo(() => {
    return (content || '').split('\n').length;
  }, [content]);

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
        <div className="flex overflow-x-auto">
          <div className="shrink-0 py-4 pr-2 pl-4 text-right select-none">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="font-mono text-xs leading-6 text-text-tertiary opacity-50">
                {i + 1}
              </div>
            ))}
          </div>
          <pre className="flex-1 py-4 pr-4 pl-2 font-mono text-sm leading-6 overflow-x-auto m-0 bg-transparent">
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CodeViewer;
