import { useMemo } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PlayIcon } from '@phosphor-icons/react';
import CellOutput from './CellOutput';

function joinSource(source) {
  if (Array.isArray(source)) return source.join('');
  return String(source ?? '');
}

function ExecutionCount({ count, running }) {
  const label = running ? '[*]' : count == null ? '[ ]' : `[${count}]`;
  return (
    <div className="w-12 shrink-0 text-right text-text-tertiary text-xs font-mono pt-1 select-none pr-2">
      {label}
    </div>
  );
}

function MarkdownCell({ source }) {
  const html = useMemo(() => {
    const raw = marked.parse(source, { async: false });
    return DOMPurify.sanitize(raw);
  }, [source]);

  return (
    <div
      className="prose prose-sm max-w-none px-4 py-2 text-text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CodeCellSource({ source, language }) {
  if (!source.trim()) return null;
  return (
    <MonacoEditor
      value={source}
      language={language ?? 'python'}
      height={Math.min(Math.max(source.split('\n').length * 19 + 8, 40), 400)}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        renderLineHighlight: 'none',
        scrollbar: { vertical: 'hidden', horizontal: 'auto' },
        wordWrap: 'on',
        fontSize: 13,
        padding: { top: 4, bottom: 4 },
      }}
      theme="vs-dark"
    />
  );
}

function inferLanguage(notebook) {
  return notebook?.metadata?.kernelspec?.language
    ?? notebook?.metadata?.language_info?.name
    ?? 'python';
}

const NotebookCell = ({ cell, language, cellState, onRun }) => {
  const source = joinSource(cell.source);

  if (cell.cell_type === 'markdown') {
    return (
      <div className="border-b border-border last:border-b-0">
        <MarkdownCell source={source} />
      </div>
    );
  }

  if (cell.cell_type === 'raw') {
    return (
      <div className="border-b border-border last:border-b-0 px-4 py-2">
        <pre className="text-text-tertiary text-sm font-mono whitespace-pre-wrap">{source}</pre>
      </div>
    );
  }

  // code cell
  const isRunning = cellState?.running ?? false;
  const outputs = cellState?.outputs ?? (cell.outputs ?? []);
  const executionCount = cellState?.executionCount ?? cell.execution_count ?? null;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Source row */}
      <div className="flex items-start bg-bg-base group">
        <ExecutionCount count={executionCount} running={isRunning} />
        <div className="flex-1 min-w-0 border border-border rounded my-1 overflow-hidden">
          <CodeCellSource source={source} language={language} />
        </div>
        {onRun && (
          <button
            onClick={() => onRun(source)}
            disabled={isRunning || !source.trim()}
            className="mt-1 mx-1 flex items-center justify-center h-6 w-6 shrink-0 rounded text-text-tertiary hover:text-accent hover:bg-white/[0.06] disabled:opacity-30 transition-colors opacity-0 group-hover:opacity-100"
            title="Run cell"
          >
            <PlayIcon size={13} />
          </button>
        )}
      </div>

      {/* Outputs */}
      {outputs.length > 0 && (
        <div className="flex items-start pl-12 pr-2 pb-2 bg-bg-surface">
          <div className="flex-1 min-w-0 space-y-1">
            {outputs.map((output, i) => (
              <CellOutput key={i} output={output} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { inferLanguage, joinSource };
export default NotebookCell;
