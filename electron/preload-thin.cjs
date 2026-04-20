/**
 * Preload for thin shell (production) mode.
 * Exposes the Go server URL and plugin management IPC.
 * File system and terminal operations are handled by the Go server.
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

contextBridge.exposeInMainWorld('electronAPI', {
    // Plugin management
    getQuipuDir: () => ipcRenderer.invoke('get-quipu-dir'),
    readPluginsConfig: () => ipcRenderer.invoke('read-plugins-config'),
    writePluginsConfig: (content) => ipcRenderer.invoke('write-plugins-config', content),
    listPluginDirs: () => ipcRenderer.invoke('list-plugin-dirs'),
    removePluginDir: (id) => ipcRenderer.invoke('remove-plugin-dir', id),
    downloadAndExtractPlugin: (params) => ipcRenderer.invoke('download-and-extract-plugin', params),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
});
