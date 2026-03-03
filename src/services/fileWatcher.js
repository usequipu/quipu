import { WS_URL } from '../config.js';

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.watchDirectory);
}

// Electron: delegates to IPC-based fs.watch in the main process
const electronWatcher = {
  watch: (dirPath) => {
    return window.electronAPI.watchDirectory(dirPath);
  },

  onChanged: (callback) => {
    window.electronAPI.onDirectoryChanged(callback);
    return () => window.electronAPI.removeDirectoryListener();
  },

  unwatch: () => {
    // Electron watcher is replaced on next watch() call; no explicit unwatch needed
    return window.electronAPI.watchDirectory(null);
  },
};

// Browser: connects to Go server's /watch WebSocket endpoint
function createBrowserWatcher() {
  let ws = null;
  let listeners = [];
  let reconnectTimer = null;
  let currentDir = null;

  function connect(dirPath) {
    cleanup();
    currentDir = dirPath;

    const url = `${WS_URL}/watch?path=${encodeURIComponent(dirPath)}`;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        listeners.forEach(cb => cb(data));
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      // Attempt reconnect after 5 seconds if we still have a target dir
      if (currentDir) {
        reconnectTimer = setTimeout(() => connect(currentDir), 5000);
      }
    };

    ws.onerror = () => {
      // Will trigger onclose which handles reconnect
    };
  }

  function cleanup() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // Prevent reconnect on intentional close
      ws.close();
      ws = null;
    }
  }

  return {
    watch: (dirPath) => {
      connect(dirPath);
      return Promise.resolve({ success: true });
    },

    onChanged: (callback) => {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter(cb => cb !== callback);
      };
    },

    unwatch: () => {
      currentDir = null;
      cleanup();
      listeners = [];
      return Promise.resolve({ success: true });
    },
  };
}

const fileWatcher = isElectron() ? electronWatcher : createBrowserWatcher();

export default fileWatcher;
