const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Terminal (multi-terminal with terminalId multiplexing)
    createTerminal: (options) => ipcRenderer.invoke('terminal-create', options),
    writeTerminal: (terminalId, data) => ipcRenderer.send('terminal-write', { terminalId, data }),
    resizeTerminal: (terminalId, cols, rows) => ipcRenderer.send('terminal-resize', { terminalId, cols, rows }),
    killTerminal: (terminalId) => ipcRenderer.invoke('terminal-kill', { terminalId }),
    onTerminalData: (callback) => {
        const handler = (event, payload) => callback(payload);
        ipcRenderer.on('terminal-incoming', handler);
        return handler;
    },
    removeTerminalDataListener: (handler) => {
        ipcRenderer.removeListener('terminal-incoming', handler);
    },

    // File system
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
    openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
    openNewWindow: () => ipcRenderer.invoke('open-new-window'),
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    pathExists: (targetPath) => ipcRenderer.invoke('path-exists', targetPath),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath) => ipcRenderer.invoke('create-file', filePath),
    createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
    renamePath: (oldPath, newPath) => ipcRenderer.invoke('rename-path', oldPath, newPath),
    deletePath: (targetPath) => ipcRenderer.invoke('delete-path', targetPath),
    uploadImage: (filePath, base64Data) => ipcRenderer.invoke('upload-image', filePath, base64Data),
    watchDirectory: (dirPath) => ipcRenderer.invoke('watch-directory', dirPath),
    onDirectoryChanged: (callback) => ipcRenderer.on('directory-changed', (event, data) => callback(data)),
    removeDirectoryListener: () => ipcRenderer.removeAllListeners('directory-changed'),

    // FRAME file watching
    watchFrameDirectory: (workspacePath) => ipcRenderer.invoke('watch-frame-directory', workspacePath),
    onFrameChanged: (callback) => ipcRenderer.on('frame-changed', (event, data) => callback(data)),
    removeFrameListener: () => ipcRenderer.removeAllListeners('frame-changed'),

    // FRAME anchor resolution
    resolveFrameAnnotations: (workspacePath, filePath, plainText) =>
        ipcRenderer.invoke('frame-resolve', workspacePath, filePath, plainText),

    // Search
    searchFiles: (dirPath, query, options) => ipcRenderer.invoke('search-files', dirPath, query, options),
    listFilesRecursive: (dirPath, limit) => ipcRenderer.invoke('list-files-recursive', dirPath, limit),

    // Storage
    storageGet: (key) => ipcRenderer.invoke('storage-get', key),
    storageSet: (key, value) => ipcRenderer.invoke('storage-set', key, value),

    // Git
    gitStatus: (dirPath) => ipcRenderer.invoke('git-status', dirPath),
    gitDiff: (dirPath, file, staged) => ipcRenderer.invoke('git-diff', dirPath, file, staged),
    gitStage: (dirPath, files) => ipcRenderer.invoke('git-stage', dirPath, files),
    gitUnstage: (dirPath, files) => ipcRenderer.invoke('git-unstage', dirPath, files),
    gitCommit: (dirPath, message) => ipcRenderer.invoke('git-commit', dirPath, message),
    gitPush: (dirPath) => ipcRenderer.invoke('git-push', dirPath),
    gitPull: (dirPath) => ipcRenderer.invoke('git-pull', dirPath),
    gitClone: (url, targetDir) => ipcRenderer.invoke('git-clone', { url, targetDir }),
    gitBranches: (dirPath) => ipcRenderer.invoke('git-branches', dirPath),
    gitCheckout: (dirPath, branch) => ipcRenderer.invoke('git-checkout', dirPath, branch),
    gitLog: (dirPath) => ipcRenderer.invoke('git-log', dirPath),

    // Jupyter kernel management
    kernelValidate: (venvPath) => ipcRenderer.invoke('jupyter-validate', venvPath),
    kernelStart: (venvPath, workspaceRoot) => ipcRenderer.invoke('jupyter-start', venvPath, workspaceRoot),
    kernelStop: () => ipcRenderer.invoke('jupyter-stop'),
    kernelProxyRest: (method, apiPath, body) => ipcRenderer.invoke('jupyter-proxy-rest', method, apiPath, body),
    kernelGetChannelUrl: (kernelId) => ipcRenderer.invoke('jupyter-get-channel-url', kernelId),

    // Plugin management
    getQuipuDir: () => ipcRenderer.invoke('get-quipu-dir'),
    readPluginsConfig: () => ipcRenderer.invoke('read-plugins-config'),
    writePluginsConfig: (content) => ipcRenderer.invoke('write-plugins-config', content),
    listPluginDirs: () => ipcRenderer.invoke('list-plugin-dirs'),
    removePluginDir: (id) => ipcRenderer.invoke('remove-plugin-dir', id),
    downloadAndExtractPlugin: (params) => ipcRenderer.invoke('download-and-extract-plugin', params),

    // Kamalu OAuth
    kamaluStartOAuth: (signInUrl) => ipcRenderer.invoke('kamalu:start-oauth', { signInUrl }),

    // Agent subprocess (legacy per-turn spawn).
    agentSpawn: (agentId, options) => ipcRenderer.invoke('agent-spawn', { agentId, options }),
    agentKill: (spawnId) => ipcRenderer.invoke('agent-kill', { spawnId }),

    // Persistent agent session (stream-json I/O — supports permission prompts).
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
    onAgentEvent: (callback) => {
        const handler = (event, payload) => callback(payload);
        ipcRenderer.on('agent-event', handler);
        return handler;
    },
    removeAgentEventListener: (handler) => {
        ipcRenderer.removeListener('agent-event', handler);
    },
    onAgentExit: (callback) => {
        const handler = (event, payload) => callback(payload);
        ipcRenderer.on('agent-exit', handler);
        return handler;
    },
    removeAgentExitListener: (handler) => {
        ipcRenderer.removeListener('agent-exit', handler);
    },
});
