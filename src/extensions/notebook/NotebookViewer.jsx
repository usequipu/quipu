import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpenIcon, CircleIcon, WarningIcon } from '@phosphor-icons/react';
import { useToast } from '../../components/Toast';
import kernelService, { isElectron } from '../../services/kernelService';
import NotebookCell, { inferLanguage } from './NotebookCell';

function normalizeV3Cell(cell) {
  // nbformat 3 uses `input` for source and `prompt_number` for execution_count
  return {
    ...cell,
    source: cell.source ?? cell.input ?? [],
    execution_count: cell.execution_count ?? cell.prompt_number ?? null,
  };
}

function parseNotebook(content) {
  const notebook = JSON.parse(content);

  if (notebook.nbformat === 3) {
    // Normalize nbformat 3 → 4 shape so the rest of the renderer works unchanged
    const cells = (notebook.worksheets?.[0]?.cells ?? []).map(normalizeV3Cell);
    return { ...notebook, cells, nbformat: 4 };
  }

  return notebook;
}

// ---------------------------------------------------------------------------
// VenvSelector — shown in the toolbar when no venv is configured
// ---------------------------------------------------------------------------
function VenvSelector({ venvPath, onSelect, validating, invalid }) {
  const inputRef = useRef(null);

  const handleBrowse = useCallback(async () => {
    if (isElectron()) {
      const result = await window.electronAPI.openFolderDialog();
      if (result) onSelect(result);
    } else {
      inputRef.current?.focus();
    }
  }, [onSelect]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') onSelect(e.target.value.trim());
  }, [onSelect]);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        defaultValue={venvPath ?? ''}
        placeholder="/path/to/.venv"
        onKeyDown={handleKeyDown}
        className="h-6 px-2 text-xs bg-bg-base border border-border rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent w-48"
      />
      <button
        onClick={handleBrowse}
        className="flex items-center gap-1 h-6 px-2 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
        title="Browse for .venv folder"
      >
        <FolderOpenIcon size={12} />
        Browse
      </button>
      {validating && <span className="text-text-tertiary text-xs">Validating…</span>}
      {invalid && (
        <span className="flex items-center gap-1 text-xs text-warning">
          <WarningIcon size={12} />
          jupyter not found in venv
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KernelStatus dot
// ---------------------------------------------------------------------------
function KernelStatusDot({ status }) {
  const colors = {
    idle: 'text-success',
    busy: 'text-warning',
    starting: 'text-accent',
    dead: 'text-error',
    disconnected: 'text-text-tertiary',
  };
  return (
    <span className={`flex items-center gap-1 text-xs ${colors[status] ?? 'text-text-tertiary'}`}>
      <CircleIcon size={8} weight="fill" />
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NotebookViewer
// ---------------------------------------------------------------------------
const NotebookViewer = ({ filePath, fileName, content }) => {
  const { showToast } = useToast();

  // --- notebook parse ---
  const { notebook, error } = useMemo(() => {
    if (!content || !content.trim()) return { notebook: { cells: [] }, error: null };
    try {
      return { notebook: parseNotebook(content), error: null };
    } catch (err) {
      return { notebook: null, error: err.message };
    }
  }, [content]);

  useEffect(() => {
    if (error) showToast(error, 'error');
  }, [error, showToast]);

  // --- venv state ---
  const [venvPath, setVenvPath] = useState(null);
  const [validating, setValidating] = useState(false);
  const [venvInvalid, setVenvInvalid] = useState(false);
  const [venvReady, setVenvReady] = useState(false);

  // Load persisted venv on mount
  useEffect(() => {
    kernelService.getVenvPath().then((saved) => {
      if (saved) setVenvPath(saved);
    });
  }, []);

  const handleSelectVenv = useCallback(async (path) => {
    if (!path) return;
    setValidating(true);
    setVenvInvalid(false);
    setVenvReady(false);
    try {
      const result = await kernelService.validateVenv(path);
      if (result?.valid) {
        await kernelService.setVenvPath(path);
        setVenvPath(path);
        setVenvReady(true);
        showToast('Environment ready', 'success');
      } else {
        setVenvInvalid(true);
        setVenvPath(path);
        showToast(result?.error ?? 'jupyter not found in selected environment', 'error');
      }
    } catch (err) {
      setVenvInvalid(true);
      showToast(err.message, 'error');
    } finally {
      setValidating(false);
    }
  }, [showToast]);

  // Validate the saved venv on first load
  useEffect(() => {
    if (!venvPath || venvReady) return;
    kernelService.validateVenv(venvPath).then((result) => {
      if (result?.valid) setVenvReady(true);
      else setVenvInvalid(true);
    }).catch(() => setVenvInvalid(true));
  }, [venvPath, venvReady]);

  // --- render ---
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

  if (!notebook) return null;

  const cells = notebook.cells ?? [];
  const language = inferLanguage(notebook);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-bg-surface">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-text-secondary text-sm font-medium truncate mr-auto">{fileName}</span>
        <span className="text-text-tertiary text-xs shrink-0">
          {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
        </span>

        {/* Venv selector */}
        <div className="shrink-0 flex items-center gap-2 border-l border-border pl-3">
          {venvReady ? (
            <>
              <KernelStatusDot status="disconnected" />
              <span className="text-text-tertiary text-xs truncate max-w-32" title={venvPath}>
                {venvPath?.split('/').pop() ?? venvPath}
              </span>
              <button
                onClick={() => { setVenvReady(false); setVenvInvalid(false); }}
                className="text-text-tertiary text-xs hover:text-text-primary"
                title="Change environment"
              >
                Change
              </button>
            </>
          ) : (
            <VenvSelector
              venvPath={venvPath}
              onSelect={handleSelectVenv}
              validating={validating}
              invalid={venvInvalid}
            />
          )}
        </div>
      </div>

      {/* Cells */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto py-4">
          {cells.length === 0 ? (
            <div className="text-text-tertiary text-sm text-center py-12">Empty notebook</div>
          ) : (
            cells.map((cell, i) => (
              <NotebookCell key={i} cell={cell} language={language} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default NotebookViewer;
export { parseNotebook };
