/**
 * Preload for thin shell (production) mode.
 * Exposes the Go server URL and plugin management IPC.
 * File system and terminal operations are handled by the Go server.
 *
 * Agent manager features (subprocess-spawned claude, repo cloning, path probe,
 * claude-slash-command listing) live in Electron main because they need
 * bidirectional stdio with the claude CLI. We expose them here alongside the
 * minimal plugin/window APIs.
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

    // Agent-runtime utilities (shared with dev preload)
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    pathExists: (targetPath) => ipcRenderer.invoke('path-exists', targetPath),
    gitClone: (url, targetDir) => ipcRenderer.invoke('git-clone', { url, targetDir }),

    // List available Claude models (Anthropic API → CLI alias fallback).
    agentListModels: () => ipcRenderer.invoke('agent-list-models'),

    // Persistent agent session (stream-json I/O with permission prompts)
    agentSessionStart: (agentId, options) => ipcRenderer.invoke('agent-session-start', { agentId, options }),
    agentSessionWrite: (sessionKey, payload) => ipcRenderer.send('agent-session-write', { sessionKey, payload }),
    agentSessionStop: (sessionKey) => ipcRenderer.invoke('agent-session-stop', { sessionKey }),
    onAgentSessionEvent: (callback) => {
        const handler = (event, payload) => callback(payload);
        ipcRenderer.on('agent-session-event', handler);
        return handler;
    },
    removeAgentSessionEventListener: (handler) => {
        ipcRenderer.removeListener('agent-session-event', handler);
    },
    onAgentSessionExit: (callback) => {
        const handler = (event, payload) => callback(payload);
        ipcRenderer.on('agent-session-exit', handler);
        return handler;
    },
    removeAgentSessionExitListener: (handler) => {
        ipcRenderer.removeListener('agent-session-exit', handler);
    },

    claudeListSlashCommands: (cwd) => ipcRenderer.invoke('claude-list-slash-commands', { cwd }),
});
