import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpenIcon, CircleIcon, WarningIcon,
  PlayIcon, SquareIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import { useToast } from '../../components/Toast';
import kernelService, { isElectron } from '../../services/kernelService';
import NotebookCell, { inferLanguage, joinSource } from './NotebookCell';

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

// Convert a Jupyter kernel IOPub message into a notebook output object
function msgToOutput(msgType, content) {
  if (msgType === 'stream') {
    return { output_type: 'stream', name: content.name, text: content.text };
  }
  if (msgType === 'display_data') {
    return { output_type: 'display_data', data: content.data, metadata: content.metadata ?? {} };
  }
  if (msgType === 'execute_result') {
    return { output_type: 'execute_result', data: content.data, metadata: content.metadata ?? {}, execution_count: content.execution_count };
  }
  if (msgType === 'error') {
    return { output_type: 'error', ename: content.ename, evalue: content.evalue, traceback: content.traceback };
  }
  return null;
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

  // --- kernel state ---
  const [kernelId, setKernelId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [kernelStatus, setKernelStatus] = useState('disconnected');
  const [kernelStarting, setKernelStarting] = useState(false);
  // index → { running: bool, executionCount: number|null, outputs: [] }
  const [cellStates, setCellStates] = useState({});

  const wsRef = useRef(null);
  const pendingRef = useRef(new Map()); // msg_id → { cellIndex, resolve }
  const reconnectTimerRef = useRef(null);
  const reconnectCountRef = useRef(0);

  // Ref-wrapped message handler — avoids stale closures in WebSocket callback
  const handleMsgRef = useRef(null);
  handleMsgRef.current = (msg) => {
    const msgType = msg.header?.msg_type;
    const content = msg.content ?? {};
    const parentMsgId = msg.parent_header?.msg_id;

    if (msgType === 'status') {
      setKernelStatus(content.execution_state);
      return;
    }
    if (msgType === 'execute_input') return;

    const entry = pendingRef.current.get(parentMsgId);
    if (!entry) return;

    if (msgType === 'execute_reply') {
      setCellStates(prev => ({
        ...prev,
        [entry.cellIndex]: {
          ...prev[entry.cellIndex],
          running: false,
          executionCount: content.execution_count,
        },
      }));
      pendingRef.current.delete(parentMsgId);
      entry.resolve();
      return;
    }

    const output = msgToOutput(msgType, content);
    if (output) {
      setCellStates(prev => ({
        ...prev,
        [entry.cellIndex]: {
          ...prev[entry.cellIndex],
          outputs: [...(prev[entry.cellIndex]?.outputs ?? []), output],
        },
      }));
    }
  };

  // Start jupyter server + create session when venv becomes ready
  useEffect(() => {
    if (!venvReady || !filePath || !venvPath) return;

    let cancelled = false;
    const workspaceRoot = filePath.includes('/')
      ? filePath.split('/').slice(0, -1).join('/') || '/'
      : '.';

    async function startKernel() {
      setKernelStarting(true);
      try {
        await kernelService.startServer(venvPath, workspaceRoot);
        if (cancelled) return;
        const session = await kernelService.createSession(filePath);
        if (cancelled) return;
        setSessionId(session.id);
        setKernelId(session.kernel.id);
      } catch (err) {
        if (!cancelled) showToast('Failed to start kernel: ' + err.message, 'error');
      } finally {
        if (!cancelled) setKernelStarting(false);
      }
    }

    startKernel();
    return () => { cancelled = true; };
  }, [venvReady, filePath, venvPath, showToast]);

  // Connect to kernel WebSocket when kernelId is available
  useEffect(() => {
    if (!kernelId) return;

    let active = true;
    let ws;

    async function connect() {
      setKernelStatus('starting');
      try {
        const url = await kernelService.getChannelUrl(kernelId);
        if (!active) return;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!active) return;
          reconnectCountRef.current = 0;
        };

        ws.onmessage = (e) => {
          if (!active) return;
          try { handleMsgRef.current(JSON.parse(e.data)); } catch (_) {}
        };

        ws.onclose = () => {
          if (!active) return;
          wsRef.current = null;
          setKernelStatus('disconnected');
          // Exponential backoff reconnect (max 30s)
          const delay = Math.min(1000 * 2 ** reconnectCountRef.current, 30000);
          reconnectCountRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {};
      } catch (err) {
        if (active) showToast('Kernel connection failed: ' + err.message, 'error');
      }
    }

    connect();

    return () => {
      active = false;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setKernelStatus('disconnected');
    };
  }, [kernelId, showToast]);

  // Stop jupyter server when component unmounts
  useEffect(() => {
    return () => { kernelService.stopServer().catch(() => {}); };
  }, []);

  // Run a single cell — returns a Promise that resolves on execute_reply
  const runCell = useCallback((cellIndex, source) => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Kernel not connected'));
        return;
      }

      const msgId = crypto.randomUUID();
      pendingRef.current.set(msgId, { cellIndex, resolve });

      setCellStates(prev => ({
        ...prev,
        [cellIndex]: { running: true, executionCount: null, outputs: [] },
      }));

      ws.send(JSON.stringify({
        header: {
          msg_id: msgId,
          msg_type: 'execute_request',
          username: 'quipu',
          session: sessionId ?? '',
          version: '5.3',
          date: new Date().toISOString(),
        },
        parent_header: {},
        metadata: {},
        content: {
          code: source,
          silent: false,
          store_history: true,
          user_expressions: {},
          allow_stdin: false,
          stop_on_error: true,
        },
        channel: 'shell',
        buffers: [],
      }));
    });
  }, [sessionId]);

  const runAll = useCallback(async () => {
    const cells = notebook?.cells ?? [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.cell_type === 'code') {
        const source = joinSource(cell.source);
        if (source.trim()) {
          try {
            await runCell(i, source);
          } catch (err) {
            showToast(`Cell ${i + 1}: ${err.message}`, 'error');
            break;
          }
        }
      }
    }
  }, [notebook, runCell, showToast]);

  const interruptKernel = useCallback(async () => {
    if (!kernelId) return;
    try {
      await kernelService.interruptKernel(kernelId);
    } catch (err) {
      showToast('Interrupt failed: ' + err.message, 'error');
    }
  }, [kernelId, showToast]);

  const restartKernel = useCallback(async () => {
    if (!kernelId) return;
    try {
      setKernelStatus('starting');
      await kernelService.restartKernel(kernelId);
      setCellStates({});
      showToast('Kernel restarted', 'success');
    } catch (err) {
      showToast('Restart failed: ' + err.message, 'error');
    }
  }, [kernelId, showToast]);

  // Listen for kernel commands dispatched from the command palette
  useEffect(() => {
    const handler = (e) => {
      if (e.detail === 'kernel.runAll') runAll();
      if (e.detail === 'kernel.interrupt') interruptKernel();
      if (e.detail === 'kernel.restart') restartKernel();
    };
    window.addEventListener('quipu:kernel-command', handler);
    return () => window.removeEventListener('quipu:kernel-command', handler);
  }, [runAll, interruptKernel, restartKernel]);

  const handleChangeVenv = useCallback(() => {
    if (sessionId) kernelService.closeSession(sessionId).catch(() => {});
    setVenvReady(false);
    setVenvInvalid(false);
    setKernelId(null);
    setSessionId(null);
    setCellStates({});
  }, [sessionId]);

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
  const isBusy = kernelStatus === 'busy' || kernelStatus === 'starting';

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-bg-surface">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-text-secondary text-sm font-medium truncate mr-auto">{fileName}</span>
        <span className="text-text-tertiary text-xs shrink-0">
          {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
        </span>

        {/* Kernel controls — only shown when a session is live */}
        {kernelId && (
          <div className="flex items-center gap-1 border-l border-border pl-3">
            <button
              onClick={runAll}
              disabled={isBusy}
              className="flex items-center gap-1 h-6 px-2 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
              title="Run all cells"
            >
              <PlayIcon size={11} />
              Run All
            </button>
            <button
              onClick={interruptKernel}
              className="flex items-center justify-center h-6 w-6 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              title="Interrupt kernel"
            >
              <SquareIcon size={11} />
            </button>
            <button
              onClick={restartKernel}
              className="flex items-center justify-center h-6 w-6 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              title="Restart kernel"
            >
              <ArrowClockwiseIcon size={11} />
            </button>
          </div>
        )}

        {/* Venv selector */}
        <div className="shrink-0 flex items-center gap-2 border-l border-border pl-3">
          {venvReady ? (
            <>
              {kernelStarting
                ? <span className="text-text-tertiary text-xs">Starting kernel…</span>
                : <KernelStatusDot status={kernelStatus} />
              }
              <span className="text-text-tertiary text-xs truncate max-w-32" title={venvPath}>
                {venvPath?.split('/').pop() ?? venvPath}
              </span>
              <button
                onClick={handleChangeVenv}
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
              <NotebookCell
                key={i}
                cell={cell}
                language={language}
                cellState={cellStates[i]}
                onRun={kernelId ? (source) => runCell(i, source).catch((err) => showToast(err.message, 'error')) : null}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default NotebookViewer;
export { parseNotebook };
