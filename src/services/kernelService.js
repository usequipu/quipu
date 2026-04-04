import { SERVER_URL } from '../config.js';
import storageService from './storageService.js';

const VENV_STORAGE_KEY = 'notebookVenvPath';

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.kernelStart);
}

// ---------------------------------------------------------------------------
// In-flight start serialization — prevents concurrent spawns
// ---------------------------------------------------------------------------
let _startPromise = null;

// ---------------------------------------------------------------------------
// Browser implementation — calls Go proxy endpoints
// ---------------------------------------------------------------------------
const browserKernel = {
  validateVenv: async (venvPath) => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venvPath }),
    });
    return res.json();
  },

  startServer: async (venvPath, workspaceRoot) => {
    if (_startPromise) return _startPromise;
    _startPromise = fetch(`${SERVER_URL}/api/jupyter/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venvPath, workspaceRoot }),
    })
      .then((r) => r.json())
      .finally(() => { _startPromise = null; });
    return _startPromise;
  },

  stopServer: async () => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/stop`, { method: 'DELETE' });
    return res.json();
  },

  createSession: async (notebookPath, kernelName = 'python3') => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: notebookPath, type: 'notebook', kernel: { name: kernelName } }),
    });
    return res.json(); // { id, kernel: { id, name }, path }
  },

  closeSession: async (sessionId) => {
    await fetch(`${SERVER_URL}/api/jupyter/sessions/${sessionId}`, { method: 'DELETE' });
  },

  interruptKernel: async (kernelId) => {
    await fetch(`${SERVER_URL}/api/jupyter/kernels/${kernelId}/interrupt`, { method: 'POST' });
  },

  restartKernel: async (kernelId) => {
    const res = await fetch(`${SERVER_URL}/api/jupyter/kernels/${kernelId}/restart`, { method: 'POST' });
    return res.json();
  },

  // Browser: frontend connects via Go WebSocket proxy
  getChannelUrl: (kernelId) => {
    const wsBase = SERVER_URL.replace(/^http/, 'ws');
    return `${wsBase}/ws/jupyter/kernels/${kernelId}/channels`;
  },
};

// ---------------------------------------------------------------------------
// Electron implementation — calls IPC via window.electronAPI
// ---------------------------------------------------------------------------
const electronKernel = {
  validateVenv: async (venvPath) => {
    return window.electronAPI.kernelValidate(venvPath);
  },

  startServer: async (venvPath, workspaceRoot) => {
    if (_startPromise) return _startPromise;
    _startPromise = window.electronAPI.kernelStart(venvPath, workspaceRoot)
      .finally(() => { _startPromise = null; });
    return _startPromise;
  },

  stopServer: async () => {
    return window.electronAPI.kernelStop();
  },

  createSession: async (notebookPath, kernelName = 'python3') => {
    return window.electronAPI.kernelProxyRest(
      'POST',
      '/api/sessions',
      { path: notebookPath, type: 'notebook', kernel: { name: kernelName } },
    );
  },

  closeSession: async (sessionId) => {
    return window.electronAPI.kernelProxyRest('DELETE', `/api/sessions/${sessionId}`, null);
  },

  interruptKernel: async (kernelId) => {
    return window.electronAPI.kernelProxyRest('POST', `/api/kernels/${kernelId}/interrupt`, null);
  },

  restartKernel: async (kernelId) => {
    return window.electronAPI.kernelProxyRest('POST', `/api/kernels/${kernelId}/restart`, null);
  },

  // Electron: frontend gets a direct ws:// URL to the local Jupyter server (token included)
  getChannelUrl: async (kernelId) => {
    return window.electronAPI.kernelGetChannelUrl(kernelId);
  },
};

// ---------------------------------------------------------------------------
// Unified API — select runtime at module load
// ---------------------------------------------------------------------------
const _impl = isElectron() ? electronKernel : browserKernel;

const kernelService = {
  // venv storage helpers
  getVenvPath: () => storageService.get(VENV_STORAGE_KEY),
  setVenvPath: (path) => storageService.set(VENV_STORAGE_KEY, path),

  // delegates to runtime impl
  validateVenv: (venvPath) => _impl.validateVenv(venvPath),
  startServer: (venvPath, workspaceRoot) => _impl.startServer(venvPath, workspaceRoot),
  stopServer: () => _impl.stopServer(),
  createSession: (notebookPath, kernelName) => _impl.createSession(notebookPath, kernelName),
  closeSession: (sessionId) => _impl.closeSession(sessionId),
  interruptKernel: (kernelId) => _impl.interruptKernel(kernelId),
  restartKernel: (kernelId) => _impl.restartKernel(kernelId),
  getChannelUrl: (kernelId) => _impl.getChannelUrl(kernelId),
};

export default kernelService;
export { isElectron };
