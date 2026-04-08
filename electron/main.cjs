const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pty = require('node-pty');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // electron-squirrel-startup not available outside of Squirrel installer context
}

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([{
    scheme: 'quipu-file',
    privileges: { bypassCSP: true, stream: true, supportFetchAPI: true },
}]);

const HIDDEN_DIRS = new Set(['.git']);

// Storage: simple JSON file in app userData directory
function getStorageFile() {
    return path.join(app.getPath('userData'), 'quipu-state.json');
}

function readStorage() {
    try {
        const data = fs.readFileSync(getStorageFile(), 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function writeStorage(data) {
    fs.writeFileSync(getStorageFile(), JSON.stringify(data, null, 2), 'utf-8');
}

let mainWindow;
const ptyProcesses = new Map(); // terminalId -> ptyProcess
const MAX_TERMINALS = 10;

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        titleBarStyle: 'hiddenInset', // Mac style, looks premium
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        backgroundColor: '#ffffff', // Start white, can change
    });

    // Zoom keybindings: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control || input.meta) {
            if (input.key === '=' || input.key === '+') {
                const current = mainWindow.webContents.getZoomFactor();
                mainWindow.webContents.setZoomFactor(Math.min(current + 0.1, 2.0));
                event.preventDefault();
            }
            if (input.key === '-') {
                const current = mainWindow.webContents.getZoomFactor();
                mainWindow.webContents.setZoomFactor(Math.max(current - 0.1, 0.5));
                event.preventDefault();
            }
            if (input.key === '0') {
                mainWindow.webContents.setZoomFactor(1.0);
                event.preventDefault();
            }
        }
    });

    // Load the index.html of the app.
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        // Open the DevTools.
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Open external links in system browser instead of navigating the app
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        const appOrigin = process.env.VITE_DEV_SERVER_URL || 'file://';
        if (!url.startsWith(appOrigin)) {
            event.preventDefault();
            if (url.startsWith('http://') || url.startsWith('https://')) {
                shell.openExternal(url);
            }
        }
    });
};

// ---------------------------------------------------------------------------
// Jupyter kernel management — module-level state + IPC handlers
// Registered at module load (before app.whenReady) so they're always present.
// ---------------------------------------------------------------------------
let _jupyterProc = null;
let _jupyterPort = null;
let _jupyterToken = null;
let _jupyterStartPromise = null;

function _jupyterBinary(venvPath) {
    return process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'jupyter.exe')
        : path.join(venvPath, 'bin', 'jupyter');
}

function _jupyterToken32() {
    return crypto.randomBytes(32).toString('hex');
}

// Find a free port in the 8900-9900 range (avoids common dev ports like 3000/4848).
function _findFreePort() {
    const net = require('net');
    const tryPort = (p) => new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(p)));
        srv.on('error', () => resolve(null)); // port busy, signal caller to retry
    });
    const start = 8900 + Math.floor(Math.random() * 1000);
    const attempt = async () => {
        for (let i = 0; i < 100; i++) {
            const p = ((start + i - 8900) % 1000) + 8900;
            const ok = await tryPort(p);
            if (ok) return ok;
        }
        throw new Error('no free port found in 8900-9900 range');
    };
    return attempt();
}

ipcMain.handle('jupyter-validate', async (event, venvPath) => {
    const bin = _jupyterBinary(venvPath);
    if (!fs.existsSync(bin)) {
        return { valid: false, error: 'jupyter binary not found in venv' };
    }
    return new Promise((resolve) => {
        execFile(bin, ['--version'], (err) => {
            resolve(err ? { valid: false, error: err.message } : { valid: true });
        });
    });
});

ipcMain.handle('jupyter-start', async (event, venvPath, workspaceRoot) => {
    if (_jupyterStartPromise) return _jupyterStartPromise;
    if (_jupyterProc && _jupyterPort) return { status: 'running', port: _jupyterPort };

    _jupyterStartPromise = (async () => {
        // Reserve a free port, then hand it to jupyter explicitly.
        // This avoids --port=0 compatibility issues and stdout-parsing races.
        const port = await _findFreePort();
        const bin = _jupyterBinary(venvPath);
        const token = _jupyterToken32();
        const env = { ...process.env, JUPYTER_TOKEN: token };

        const proc = require('child_process').spawn(bin, [
            'server', '--no-browser',
            `--port=${port}`,
            '--ip=127.0.0.1',
            `--ServerApp.root_dir=${workspaceRoot}`,
        ], { env, detached: false });

        _jupyterProc = proc;
        _jupyterToken = token;

        // Poll GET /api until jupyter responds — no stdout parsing needed.
        const ready = await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => { if (!done) { done = true; clearInterval(poll); clearTimeout(timer); fn(); } };

            const poll = setInterval(async () => {
                try {
                    const r = await fetch(`http://127.0.0.1:${port}/api`, {
                        headers: { Authorization: `token ${token}` },
                        signal: AbortSignal.timeout(1000),
                    });
                    if (r.status < 500) finish(() => resolve(port));
                } catch (_) { /* not ready yet */ }
            }, 500);

            const timer = setTimeout(
                () => finish(() => reject(new Error('timed out waiting for jupyter server'))),
                45000,
            );

            proc.on('close', (code) => {
                _jupyterProc = null;
                finish(() => reject(new Error(`jupyter server exited (code ${code})`)));
            });
        });

        _jupyterPort = ready;
        return { status: 'running', port: ready };
    })().finally(() => { _jupyterStartPromise = null; });

    return _jupyterStartPromise;
});

ipcMain.handle('jupyter-stop', async () => {
    if (_jupyterProc) {
        _jupyterProc.kill('SIGTERM');
        _jupyterProc = null;
        _jupyterPort = null;
        _jupyterToken = null;
    }
    return { status: 'stopped' };
});

ipcMain.handle('jupyter-proxy-rest', async (event, method, apiPath, body) => {
    if (!_jupyterPort) throw new Error('jupyter server is not running — start a kernel first');
    const url = `http://127.0.0.1:${_jupyterPort}${apiPath}`;
    const options = {
        method,
        headers: { 'Authorization': `token ${_jupyterToken}`, 'Content-Type': 'application/json' },
    };
    if (body != null) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (res.status === 204 || res.headers.get('content-length') === '0') return {};
    const text = await res.text();
    return text ? JSON.parse(text) : {};
});

ipcMain.handle('jupyter-get-channel-url', async (event, kernelId) => {
    if (!_jupyterPort) throw new Error('jupyter server not running');
    return `ws://127.0.0.1:${_jupyterPort}/api/kernels/${kernelId}/channels?token=${_jupyterToken}`;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
    // Register custom protocol to serve local files (works in both dev and prod)
    protocol.handle('quipu-file', (request) => {
        const filePath = decodeURIComponent(request.url.replace('quipu-file://', ''));
        return net.fetch('file://' + filePath);
    });

    // Enable spellcheck for both English and Portuguese
    session.defaultSession.setSpellCheckerLanguages(['en-US', 'pt-BR']);

    createWindow();

    // Setup File System IPC
    ipcMain.handle('open-folder-dialog', async () => {
        // Try native dialog first
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            if (result.canceled) return null;
        } catch (e) {
            // Native dialog failed (common on WSL), fall through
        }
        // Return null — the renderer will use its built-in folder picker
        return null;
    });

    ipcMain.handle('open-file-dialog', async (event, options) => {
        try {
            const filters = options?.filters || [];
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters,
            });
            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            return null;
        } catch (e) {
            return null;
        }
    });

    ipcMain.handle('storage-get', (event, key) => {
        const store = readStorage();
        return store[key] ?? null;
    });

    ipcMain.handle('storage-set', (event, key, value) => {
        const store = readStorage();
        store[key] = value;
        writeStorage(store);
        return { success: true };
    });

    ipcMain.handle('get-home-dir', async () => {
        return os.homedir();
    });

    ipcMain.handle('read-directory', async (event, dirPath) => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries
            .filter(e => !HIDDEN_DIRS.has(e.name))
            .map(e => ({
                name: e.name,
                path: path.join(dirPath, e.name),
                isDirectory: e.isDirectory(),
            }))
            .sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    });

    ipcMain.handle('read-file', async (event, filePath) => {
        try {
            return await fs.promises.readFile(filePath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
    });

    ipcMain.handle('create-file', async (event, filePath) => {
        await fs.promises.writeFile(filePath, '', 'utf-8');
        return { success: true };
    });

    ipcMain.handle('create-folder', async (event, folderPath) => {
        await fs.promises.mkdir(folderPath, { recursive: true });
        return { success: true };
    });

    ipcMain.handle('rename-path', async (event, oldPath, newPath) => {
        await fs.promises.rename(oldPath, newPath);
        return { success: true };
    });

    ipcMain.handle('delete-path', async (event, targetPath) => {
        const stat = await fs.promises.stat(targetPath);
        if (stat.isDirectory()) {
            await fs.promises.rm(targetPath, { recursive: true });
        } else {
            await fs.promises.unlink(targetPath);
        }
        return { success: true };
    });

    ipcMain.handle('upload-image', async (event, filePath, base64Data) => {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        // Decode base64 and write binary data
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
        return { success: true, path: filePath };
    });

    // Search files using ripgrep with grep fallback
    ipcMain.handle('search-files', async (event, dirPath, query, options = {}) => {
        const maxResults = 500;
        const isRegex = options.regex || false;
        const isCaseSensitive = options.caseSensitive || false;

        const parseOutput = (stdout) => {
            const lines = stdout.split('\n').filter(l => l.trim());
            const results = [];
            let truncated = false;

            for (const line of lines) {
                if (results.length >= maxResults) {
                    truncated = true;
                    break;
                }
                // Format: file:line:text
                const firstColon = line.indexOf(':');
                if (firstColon < 0) continue;
                const rest = line.slice(firstColon + 1);
                const secondColon = rest.indexOf(':');
                if (secondColon < 0) continue;

                const filePath = line.slice(0, firstColon);
                const lineNum = parseInt(rest.slice(0, secondColon), 10);
                const text = rest.slice(secondColon + 1);

                if (isNaN(lineNum)) continue;

                const relPath = path.relative(dirPath, filePath);
                results.push({ file: relPath, line: lineNum, text: text.trimEnd() });
            }

            return { results, truncated };
        };

        // Try ripgrep first
        try {
            const result = await new Promise((resolve, reject) => {
                const args = [
                    '--no-heading', '--line-number', '--color', 'never',
                    '--max-count', String(maxResults),
                ];
                if (!isCaseSensitive) args.push('--ignore-case');
                if (!isRegex) args.push('--fixed-strings');
                ['node_modules', '.git', '.quipu', 'build', 'dist'].forEach(d => {
                    args.push('--glob', '!' + d);
                });
                args.push(query, dirPath);

                execFile('rg', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                    if (err && err.code === 1) {
                        // No matches
                        resolve({ results: [], truncated: false });
                    } else if (err) {
                        reject(err);
                    } else {
                        resolve(parseOutput(stdout));
                    }
                });
            });
            return result;
        } catch {
            // Fallback to grep
        }

        // Grep fallback
        return new Promise((resolve, reject) => {
            const args = ['-rn', '--color=never'];
            if (!isCaseSensitive) args.push('-i');
            if (!isRegex) args.push('-F');
            ['node_modules', '.git', '.quipu', 'build', 'dist'].forEach(d => {
                args.push('--exclude-dir=' + d);
            });
            args.push(query, dirPath);

            execFile('grep', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err && err.code === 1) {
                    resolve({ results: [], truncated: false });
                } else if (err) {
                    reject(err);
                } else {
                    resolve(parseOutput(stdout));
                }
            });
        });
    });

    // List all files recursively
    ipcMain.handle('list-files-recursive', async (event, dirPath, limit = 5000) => {
        const excludeDirs = new Set(['node_modules', '.git', '.quipu', 'build', 'dist']);
        const files = [];
        let truncated = false;

        const walk = async (dir) => {
            if (truncated) return;
            let entries;
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (truncated) break;

                // Skip excluded dirs
                if (entry.isDirectory() && excludeDirs.has(entry.name)) continue;

                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else {
                    if (files.length >= limit) {
                        truncated = true;
                        break;
                    }
                    files.push({
                        path: path.relative(dirPath, fullPath),
                        name: entry.name,
                    });
                }
            }
        };

        await walk(dirPath);
        return { files, truncated };
    });

    // Git operations
    ipcMain.handle('git-status', async (event, dirPath) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['status', '--porcelain', '-z'], {
                cwd: dirPath,
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
            }, (err, stdout, stderr) => {
                if (err) {
                    if (stderr && stderr.includes('not a git repository')) {
                        reject(new Error('not a git repository'));
                        return;
                    }
                    reject(new Error(stderr || err.message));
                    return;
                }

                const staged = [];
                const unstaged = [];
                const untracked = [];

                const entries = stdout.split('\0');
                let i = 0;
                while (i < entries.length) {
                    const entry = entries[i];
                    if (entry.length < 3) {
                        i++;
                        continue;
                    }

                    const x = entry[0];
                    const y = entry[1];
                    const filePath = entry.slice(3);

                    if (x === '?' && y === '?') {
                        untracked.push(filePath);
                        i++;
                        continue;
                    }

                    if (x === 'R' || x === 'C') {
                        let newPath = '';
                        if (i + 1 < entries.length) {
                            newPath = entries[i + 1];
                            i++;
                        }
                        staged.push({ path: newPath, status: x });
                    } else if (x !== ' ' && x !== '?') {
                        staged.push({ path: filePath, status: x });
                    }

                    if (y === 'R' || y === 'C') {
                        let newPath = '';
                        if (i + 1 < entries.length) {
                            newPath = entries[i + 1];
                            i++;
                        }
                        unstaged.push({ path: newPath, status: y });
                    } else if (y !== ' ' && y !== '?') {
                        unstaged.push({ path: filePath, status: y });
                    }

                    i++;
                }

                resolve({ staged, unstaged, untracked });
            });
        });
    });

    ipcMain.handle('git-diff', async (event, dirPath, file, staged) => {
        return new Promise((resolve, reject) => {
            const args = ['diff'];
            if (staged) args.push('--cached');
            if (file) args.push('--', file);

            execFile('git', args, {
                cwd: dirPath,
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve(stdout);
            });
        });
    });

    ipcMain.handle('git-stage', async (event, dirPath, files) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['add', ...files], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ success: true });
            });
        });
    });

    ipcMain.handle('git-unstage', async (event, dirPath, files) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['reset', 'HEAD', '--', ...files], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ success: true });
            });
        });
    });

    ipcMain.handle('git-commit', async (event, dirPath, message) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['commit', '-m', message], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ output: stdout });
            });
        });
    });

    ipcMain.handle('git-push', async (event, dirPath) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['push'], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ output: stdout + stderr });
            });
        });
    });

    ipcMain.handle('git-pull', async (event, dirPath) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['pull'], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ output: stdout + stderr });
            });
        });
    });

    ipcMain.handle('git-branches', async (event, dirPath) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['branch', '--show-current'], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, currentOut) => {
                if (err) {
                    reject(new Error(err.message));
                    return;
                }
                const current = currentOut.trim();

                execFile('git', ['branch', '--list'], {
                    cwd: dirPath,
                    timeout: 30000,
                }, (err2, listOut) => {
                    if (err2) {
                        reject(new Error(err2.message));
                        return;
                    }

                    const branches = listOut.split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0)
                        .map(l => l.replace(/^\*\s+/, ''));

                    resolve({ branches, current });
                });
            });
        });
    });

    ipcMain.handle('git-checkout', async (event, dirPath, branch) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['checkout', branch], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve({ success: true });
            });
        });
    });

    ipcMain.handle('git-log', async (event, dirPath) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['log', '--oneline', '-20'], {
                cwd: dirPath,
                timeout: 30000,
            }, (err, stdout, stderr) => {
                if (err) {
                    if (stderr && (stderr.includes('does not have any commits') || stderr.includes('bad default revision'))) {
                        resolve({ entries: [] });
                        return;
                    }
                    reject(new Error(stderr || err.message));
                    return;
                }

                const entries = stdout.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 0)
                    .map(l => {
                        const spaceIdx = l.indexOf(' ');
                        if (spaceIdx < 0) return { hash: l, message: '' };
                        return { hash: l.slice(0, spaceIdx), message: l.slice(spaceIdx + 1) };
                    });

                resolve({ entries });
            });
        });
    });

    let watcher = null;
    ipcMain.handle('watch-directory', async (event, dirPath) => {
        if (watcher) {
            watcher.close();
            watcher = null;
        }
        if (!dirPath) return { success: true };
        try {
            watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('directory-changed', { eventType, filename });
                }
            });
        } catch (err) {
            // fs.watch with recursive may not be supported everywhere
            console.warn('Directory watch failed:', err.message);
        }
        return { success: true };
    });

    // FRAME file watcher — watches .quipu/meta/ for annotation changes
    let frameWatcher = null;
    ipcMain.handle('watch-frame-directory', async (event, workspacePath) => {
        if (frameWatcher) {
            frameWatcher.close();
            frameWatcher = null;
        }
        if (!workspacePath) return { success: true };

        const metaDir = path.join(workspacePath, '.quipu', 'meta');
        try {
            await fs.promises.mkdir(metaDir, { recursive: true });
            frameWatcher = fs.watch(metaDir, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.frame.json')) return;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('frame-changed', { eventType, filename });
                }
            });
        } catch (err) {
            console.warn('FRAME directory watch failed:', err.message);
        }
        return { success: true };
    });

    // Setup Terminal IPC (multi-terminal with terminalId multiplexing)
    ipcMain.handle('terminal-create', async (event, options) => {
        if (ptyProcesses.size >= MAX_TERMINALS) {
            throw new Error('Maximum number of terminals reached');
        }

        const shell = process.env[os.platform() === 'win32' ? 'COMSPEC' : 'SHELL'];
        const terminalId = crypto.randomUUID();
        const cwd = (options && options.cwd) || process.env.HOME;

        const ptyProc = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30,
            cwd,
            env: process.env
        });

        ptyProcesses.set(terminalId, ptyProc);

        ptyProc.on('data', function (data) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('terminal-incoming', { terminalId, data });
            }
        });

        ptyProc.on('exit', function () {
            ptyProcesses.delete(terminalId);
        });

        return { terminalId };
    });

    ipcMain.on('terminal-write', (event, { terminalId, data }) => {
        const ptyProc = ptyProcesses.get(terminalId);
        if (ptyProc) {
            ptyProc.write(data);
        }
    });

    ipcMain.on('terminal-resize', (event, { terminalId, cols, rows }) => {
        const ptyProc = ptyProcesses.get(terminalId);
        if (ptyProc) {
            ptyProc.resize(cols, rows);
        }
    });

    ipcMain.handle('terminal-kill', async (event, { terminalId }) => {
        const ptyProc = ptyProcesses.get(terminalId);
        if (ptyProc) {
            ptyProc.kill();
            ptyProcesses.delete(terminalId);
        }
        return { success: true };
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
