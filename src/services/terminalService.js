import { WS_URL } from '../config.js';

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.createTerminal);
}

const electronTerminal = {
  create: async (cwd) => {
    return await window.electronAPI.createTerminal(cwd ? { cwd } : undefined);
    // Returns { terminalId }
  },
  write: (terminalId, data) => {
    window.electronAPI.writeTerminal(terminalId, data);
  },
  resize: (terminalId, cols, rows) => {
    window.electronAPI.resizeTerminal(terminalId, cols, rows);
  },
  kill: async (terminalId) => {
    return await window.electronAPI.killTerminal(terminalId);
  },
  onData: (callback) => {
    // Electron sends { terminalId, data } for all terminals on one channel
    return window.electronAPI.onTerminalData(callback);
  },
  removeDataListener: (callback) => {
    window.electronAPI.removeTerminalDataListener(callback);
  },
};

// Browser mode: each terminal gets its own WebSocket
// We track active WebSocket connections in a Map
const browserSockets = new Map();

const browserTerminal = {
  create: async (cwd) => {
    const terminalId = crypto.randomUUID();
    const wsUrl = cwd
      ? `${WS_URL}/term?cwd=${encodeURIComponent(cwd)}`
      : `${WS_URL}/term`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    browserSockets.set(terminalId, ws);
    return { terminalId, ws };
  },
  write: (terminalId, data) => {
    const ws = browserSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  },
  resize: (terminalId, cols, rows) => {
    const ws = browserSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ cols, rows }));
    }
  },
  kill: async (terminalId) => {
    const ws = browserSockets.get(terminalId);
    if (ws) {
      ws.close();
      browserSockets.delete(terminalId);
    }
  },
  // Browser mode: data listeners are per-WebSocket, set up inside the component
  onData: () => () => {},
  removeDataListener: () => {},
};

const terminalService = isElectron() ? electronTerminal : browserTerminal;
export { isElectron };
export default terminalService;
