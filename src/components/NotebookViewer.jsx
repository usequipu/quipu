import { useMemo } from 'react';
import { useToast } from './Toast';
import NotebookCell, { inferLanguage } from './notebook/NotebookCell';

function parseNotebook(content) {
  const notebook = JSON.parse(content);

  // nbformat 3 used worksheets[0].cells — not supported
  if (notebook.nbformat === 3 || notebook.worksheets) {
    throw new Error('nbformat 3 not supported — open in Jupyter and save as nbformat 4');
  }

  return notebook;
}

const NotebookViewer = ({ filePath, fileName, content }) => {
  const { showToast } = useToast();

  const { notebook, error } = useMemo(() => {
    if (!content) return { notebook: null, error: 'No content' };
    try {
      return { notebook: parseNotebook(content), error: null };
    } catch (err) {
      return { notebook: null, error: err.message };
    }
  }, [content]);

  // Surface parse errors as toasts (once per content change via useMemo)
  useMemo(() => {
    if (error) showToast(error, 'error');
  }, [error, showToast]);

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bg-surface">
        <div className="text-text-tertiary text-sm text-center px-8">
          <div className="font-medium text-text-secondary mb-1">Cannot display notebook</div>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bg-surface">
        <div className="text-text-tertiary text-sm">Loading…</div>
      </div>
    );
  }

  const cells = notebook.cells ?? [];
  const language = inferLanguage(notebook);

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-surface">
      {/* Notebook header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-text-secondary text-sm font-medium truncate">{fileName}</span>
        <span className="text-text-tertiary text-xs shrink-0 ml-4">
          {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
        </span>
      </div>

      {/* Cells */}
      <div className="max-w-5xl mx-auto py-4">
        {cells.length === 0 ? (
          <div className="text-text-tertiary text-sm text-center py-12">
            Empty notebook
          </div>
        ) : (
          cells.map((cell, i) => (
            <NotebookCell key={i} cell={cell} language={language} />
          ))
        )}
      </div>
    </div>
  );
};

export default NotebookViewer;
export { parseNotebook };
