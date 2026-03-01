/**
 * Minimal preload for thin shell mode.
 * Only exposes the Go server URL — no IPC, no file system, no terminal.
 */
const { contextBridge, ipcRenderer } = require('electron');

const port = process.env.QUIPU_SERVER_PORT || '3000';

contextBridge.exposeInMainWorld('__QUIPU_CONFIG__', {
    serverUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
});

contextBridge.exposeInMainWorld('__QUIPU_WINDOW__', {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
});
