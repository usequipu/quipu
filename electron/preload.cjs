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
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
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
    gitBranches: (dirPath) => ipcRenderer.invoke('git-branches', dirPath),
    gitCheckout: (dirPath, branch) => ipcRenderer.invoke('git-checkout', dirPath, branch),
    gitLog: (dirPath) => ipcRenderer.invoke('git-log', dirPath),
});
