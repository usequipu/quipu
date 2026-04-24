const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const pty = require('node-pty');
const AdmZip = require('adm-zip');

// FRAME anchor resolution helpers (mirror of Go server logic)
function stripMarkdownElectron(content) {
    // Strip YAML frontmatter
    if (content.startsWith('---\n')) {
        const end = content.indexOf('\n---', 4);
        if (end >= 0) {
            content = content.slice(end + 4);
            if (content.startsWith('\n')) content = content.slice(1);
        }
    }
    // Strip inline markdown markers
    return content
        .split('\n')
        .map(line => {
            const trimmed = line.replace(/^#+\s*/, '');
            return trimmed
                .replace(/\*\*/g, '').replace(/__/g, '')
                .replace(/\*/g, '').replace(/_/g, '').replace(/`/g, '');
        })
        .join('\n');
}

function overlapRatioElectron(a, b) {
    if (!a && !b) return 1.0;
    if (!a || !b) return 0.0;
    const freq = {};
    for (const c of a) freq[c] = (freq[c] || 0) + 1;
    let common = 0;
    for (const c of b) {
        if (freq[c] > 0) { common++; freq[c]--; }
    }
    return (2 * common) / ([...a].length + [...b].length);
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // electron-squirrel-startup not available outside of Squirrel installer context
}

// Register custom protocol schemes before app is ready.
// `quipu-plugin` is declared `standard` so relative URL resolution
// (e.g. `new URL('./fonts/x.woff2', import.meta.url)`) and module
// Worker construction (which require a valid absolute origin) work
// the same way as http(s). Plugins loaded under this scheme can
// reference sibling assets by relative path from their entry file.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'quipu-file',
        privileges: { bypassCSP: true, stream: true, supportFetchAPI: true },
    },
    {
        scheme: 'quipu-plugin',
        privileges: {
            standard: true,
            secure: true,
            bypassCSP: true,
            stream: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
    {
        scheme: 'quipu-runtime',
        privileges: {
            standard: true,
            secure: true,
            bypassCSP: true,
            stream: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
]);

// Proxy modules served under quipu-runtime://. Plugin source that imports
// 'react' / 'react-dom' / 'react/jsx-runtime' is rewritten to import these
// instead, so every plugin shares the host's single React instance.
const RUNTIME_MODULES = {
    'react.js':
        "const R=globalThis.__quipuReact;export default R;" +
        "export const{useState,useEffect,useCallback,useMemo,useRef,useContext," +
        "createContext,createElement,forwardRef,memo,lazy,Suspense,Fragment," +
        "Component,PureComponent,Children,cloneElement,isValidElement,createRef," +
        "startTransition,useTransition,useDeferredValue,useId,useInsertionEffect," +
        "useLayoutEffect,useImperativeHandle,useReducer,useSyncExternalStore," +
        "useDebugValue,Profiler,StrictMode,version,use}=R;",
    'react-dom.js':
        "const RD=globalThis.__quipuReactDOM;export default RD;" +
        "export const{createPortal,flushSync,unstable_batchedUpdates,version," +
        "findDOMNode,render,hydrate,unmountComponentAtNode," +
        "preconnect,prefetchDNS,preinit,preinitModule,preload,preloadModule," +
        "requestFormReset,useFormState,useFormStatus}=RD;",
    'jsx-runtime.js':
        "const J=globalThis.__quipuJsx;" +
        "export const jsx=J.jsx,jsxs=J.jsxs,Fragment=J.Fragment;",
};

function rewritePluginSource(source) {
    let patched = source;
    // Polyfill CJS `exports` for plugins whose bundled deps reference it.
    if (/\bexports\b/.test(patched)) {
        patched = 'var exports = {};\n' + patched;
    }
    // Redirect bare React imports to runtime proxies.
    patched = patched
        .replace(/(['"])react\/jsx-runtime\1/g, '"quipu-runtime://react/jsx-runtime.js"')
        .replace(/(['"])react-dom\/client\1/g, '"quipu-runtime://react/react-dom.js"')
        .replace(/(['"])react-dom\1/g, '"quipu-runtime://react/react-dom.js"')
        .replace(/(['"])react\1/g, '"quipu-runtime://react/react.js"');
    return patched;
}

const HIDDEN_DIRS = new Set(['.git']);

// Plugin management paths
const QUIPU_HOME_DIR = path.join(os.homedir(), '.quipu');
const PLUGINS_CONFIG_PATH = path.join(QUIPU_HOME_DIR, 'plugins.json');
const PLUGINS_DIR = path.join(QUIPU_HOME_DIR, 'plugins');

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

// Agent subprocesses (Claude Code CLI, per-turn spawn — legacy).
const agentProcesses = new Map(); // spawnId -> { proc, agentId, buffer }
const MAX_AGENTS = 20;

// Persistent agent sessions (Claude Code CLI with stream-json I/O).
// One subprocess per agent for as long as the session lives.
const agentSessions = new Map(); // sessionKey -> { proc, agentId, buffer }

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

    // Serve plugin files from ~/.quipu/plugins/<id>/.
    // The plugin's entry is delivered under a real URL so ES module Workers
    // (which require a fetchable import.meta.url) and relative-URL asset
    // resolution (`new URL('./fonts/x', import.meta.url)`) work the same way
    // they do on the web. JS files are rewritten on the fly to redirect
    // `react` imports to the host's React instance via quipu-runtime://.
    protocol.handle('quipu-plugin', async (request) => {
        try {
            const url = new URL(request.url);
            const pluginId = url.hostname;
            if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginId)) {
                return new Response('invalid plugin id', { status: 400 });
            }
            const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const pluginRoot = path.join(PLUGINS_DIR, pluginId);
            const resolvedRoot = path.resolve(pluginRoot);
            const resolved = path.resolve(pluginRoot, relPath);
            if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
                return new Response('path escapes plugin dir', { status: 403 });
            }
            const ext = path.extname(resolved).toLowerCase();
            if (ext === '.js' || ext === '.mjs') {
                const source = await fs.promises.readFile(resolved, 'utf-8');
                return new Response(rewritePluginSource(source), {
                    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
                });
            }
            return net.fetch('file://' + resolved);
        } catch (err) {
            if (err.code === 'ENOENT') return new Response('not found', { status: 404 });
            return new Response(`error: ${err.message || err}`, { status: 500 });
        }
    });

    // Serve runtime proxy modules that forward to the host's React instance
    // via globalThis. The renderer sets the globals before it imports any
    // plugin; each plugin shares the host dispatcher, which prevents the
    // two-React-instances hook failure.
    protocol.handle('quipu-runtime', async (request) => {
        try {
            const url = new URL(request.url);
            const file = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const code = RUNTIME_MODULES[file];
            if (!code) return new Response('not found', { status: 404 });
            return new Response(code, {
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
            });
        } catch (err) {
            return new Response(`error: ${err.message || err}`, { status: 500 });
        }
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

    ipcMain.handle('path-exists', async (event, targetPath) => {
        try {
            await fs.promises.access(targetPath);
            return true;
        } catch {
            return false;
        }
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

    ipcMain.handle('git-clone', async (event, { url, targetDir }) => {
        if (typeof url !== 'string' || url.length === 0) throw new Error('git-clone: url required');
        if (typeof targetDir !== 'string' || targetDir.length === 0) throw new Error('git-clone: targetDir required');
        await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
        return new Promise((resolve, reject) => {
            execFile('git', ['clone', '--depth', '1', url, targetDir], {
                timeout: 120000,
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message || 'git clone failed'));
                    return;
                }
                resolve({ output: stdout + stderr });
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

    // Polling-based recursive directory watcher (works on all platforms including Linux,
    // where fs.watch with { recursive: true } is unsupported).
    const WATCH_SKIP_DIRS = new Set(['.git', 'node_modules', '.quipu']);

    async function buildDirSnapshot(rootDir) {
        const snap = {};
        async function walk(dir) {
            let entries;
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
            catch { return; }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (WATCH_SKIP_DIRS.has(entry.name)) continue;
                    await walk(path.join(dir, entry.name));
                } else {
                    const full = path.join(dir, entry.name);
                    try { snap[full] = (await fs.promises.stat(full)).mtimeMs; }
                    catch { /* ignore transient errors */ }
                }
            }
        }
        await walk(rootDir);
        return snap;
    }

    let watcher = null; // holds { intervalId, rootDir }
    ipcMain.handle('watch-directory', async (event, dirPath) => {
        if (watcher) {
            clearInterval(watcher.intervalId);
            watcher = null;
        }
        if (!dirPath) return { success: true };
        let snapshot = await buildDirSnapshot(dirPath);
        const intervalId = setInterval(async () => {
            const next = await buildDirSnapshot(dirPath);
            for (const [file, mtime] of Object.entries(next)) {
                if (snapshot[file] === undefined || snapshot[file] !== mtime) {
                    const filename = path.relative(dirPath, file).replace(/\\/g, '/');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('directory-changed', { eventType: 'change', filename });
                    }
                }
            }
            for (const file of Object.keys(snapshot)) {
                if (next[file] === undefined) {
                    const filename = path.relative(dirPath, file).replace(/\\/g, '/');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('directory-changed', { eventType: 'rename', filename });
                    }
                }
            }
            snapshot = next;
        }, 2000);
        watcher = { intervalId, rootDir: dirPath };
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

    // FRAME anchor resolution — mirrors the Go /frame/resolve algorithm
    ipcMain.handle('frame-resolve', async (event, workspacePath, filePath, plainText) => {
        if (!workspacePath || !filePath) return { resolved: 0 };

        // Path validation: filePath must be within workspacePath
        const rel = path.relative(workspacePath, filePath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return { resolved: 0, error: 'path outside workspace' };
        }

        const framePath = path.join(workspacePath, '.quipu', 'meta', rel + '.frame.json');

        let frameData;
        try {
            frameData = await fs.promises.readFile(framePath, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') return { resolved: 0 };
            return { resolved: 0 };
        }

        let frame;
        try {
            frame = JSON.parse(frameData);
        } catch {
            return { resolved: 0 };
        }

        // Determine format
        let format = frame.format || '';
        if (!format) {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.md' || ext === '.markdown') format = 'markdown';
            else if (ext === '.quipu') format = 'quipu';
            else format = 'text';
            frame.format = format;
        }

        // Build corpus — prefer client-provided plain text (same block-based newline
        // counting as posToLineNumber/lineNumberToPos on the client).
        let corpus = '';
        try {
            if (plainText) {
                corpus = plainText;
            } else if (format === 'quipu') {
                return { resolved: 0 };
            } else {
                const raw = await fs.promises.readFile(filePath, 'utf8');
                corpus = format === 'markdown' ? stripMarkdownElectron(raw) : raw;
            }
        } catch {
            return { resolved: 0 };
        }

        const annotations = frame.annotations || [];
        let resolved = 0;

        for (let i = 0; i < annotations.length; i++) {
            const a = annotations[i];
            if (!a || !a.selectedText) continue;

            // Find all occurrence offsets
            const offsets = [];
            let pos = 0;
            while (true) {
                const idx = corpus.indexOf(a.selectedText, pos);
                if (idx < 0) break;
                offsets.push(idx);
                pos = idx + 1;
            }

            if (offsets.length === 0) {
                a.detached = true;
                delete a.line;
                continue;
            }

            // Score each occurrence
            const contextBefore = a.contextBefore || '';
            const contextAfter = a.contextAfter || '';
            let bestScore = -1;
            let bestCandidates = [];

            for (let k = 0; k < offsets.length; k++) {
                const offset = offsets[k];
                const wb = corpus.substring(Math.max(0, offset - 80), offset);
                const wa = corpus.substring(offset + a.selectedText.length, offset + a.selectedText.length + 80);
                const score = overlapRatioElectron(contextBefore, wb) + overlapRatioElectron(contextAfter, wa);
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidates = [k];
                } else if (score === bestScore) {
                    bestCandidates.push(k);
                }
            }

            let chosen = bestCandidates[0];
            if (typeof a.occurrence === 'number' && a.occurrence > 0) {
                const occIdx = a.occurrence - 1;
                if (occIdx < bestCandidates.length) chosen = bestCandidates[occIdx];
            }

            const matchOffset = offsets[chosen];
            const lineNum = corpus.substring(0, matchOffset).split('\n').length;

            a.line = lineNum;
            a.detached = false;
            resolved++;
        }

        frame.annotations = annotations;
        frame.updatedAt = new Date().toISOString();

        try {
            await fs.promises.mkdir(path.dirname(framePath), { recursive: true });
            await fs.promises.writeFile(framePath, JSON.stringify(frame, null, 2), 'utf8');
        } catch {
            return { resolved: 0 };
        }

        return { resolved };
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

    // Agent subprocess IPC — spawns `claude` per turn with stream-json output.
    // Options: { message, systemPrompt, model, addDirs: string[], resumeSessionId?, cwd? }
    ipcMain.handle('agent-spawn', async (event, { agentId, options }) => {
        if (agentProcesses.size >= MAX_AGENTS) {
            throw new Error('Maximum number of concurrent agents reached');
        }
        if (!agentId || !options || typeof options.message !== 'string') {
            throw new Error('agent-spawn: agentId and options.message required');
        }

        const spawnId = crypto.randomUUID();
        const args = [
            '-p', options.message,
            '--output-format', 'stream-json',
            '--verbose',
        ];
        if (options.resumeSessionId) {
            args.push('--resume', options.resumeSessionId);
        }
        if (options.systemPrompt && options.systemPrompt.trim().length > 0) {
            args.push('--append-system-prompt', options.systemPrompt);
        }
        if (options.model && options.model.trim().length > 0) {
            args.push('--model', options.model);
        }
        if (Array.isArray(options.addDirs)) {
            for (const dir of options.addDirs) {
                if (typeof dir === 'string' && dir.length > 0) {
                    args.push('--add-dir', dir);
                }
            }
        }
        if (options.permissionMode && typeof options.permissionMode === 'string') {
            args.push('--permission-mode', options.permissionMode);
        }

        const cwd = typeof options.cwd === 'string' && options.cwd.length > 0 ? options.cwd : process.env.HOME;
        let proc;
        try {
            proc = spawn('claude', args, {
                cwd,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            throw new Error(`Failed to spawn claude: ${err.message || err}`);
        }

        agentProcesses.set(spawnId, { proc, agentId, buffer: '' });

        const emit = (event) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('agent-event', { spawnId, agentId, event });
            }
        };

        proc.on('error', (err) => {
            emit({ type: 'error', message: err.message || String(err) });
        });

        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (chunk) => {
            const state = agentProcesses.get(spawnId);
            if (!state) return;
            state.buffer += chunk;
            let idx;
            while ((idx = state.buffer.indexOf('\n')) !== -1) {
                const line = state.buffer.slice(0, idx).trim();
                state.buffer = state.buffer.slice(idx + 1);
                if (!line) continue;
                try {
                    emit(JSON.parse(line));
                } catch {
                    emit({ type: 'stdout_raw', text: line });
                }
            }
        });

        proc.stderr.setEncoding('utf-8');
        proc.stderr.on('data', (chunk) => {
            emit({ type: 'stderr', text: chunk });
        });

        proc.on('close', (code, signal) => {
            const state = agentProcesses.get(spawnId);
            if (state && state.buffer.trim().length > 0) {
                try {
                    emit(JSON.parse(state.buffer.trim()));
                } catch {
                    emit({ type: 'stdout_raw', text: state.buffer.trim() });
                }
            }
            agentProcesses.delete(spawnId);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('agent-exit', { spawnId, agentId, code, signal });
            }
        });

        return { spawnId };
    });

    ipcMain.handle('agent-kill', async (event, { spawnId }) => {
        const state = agentProcesses.get(spawnId);
        if (state) {
            try { state.proc.kill(); } catch { /* ignore */ }
            agentProcesses.delete(spawnId);
        }
        return { success: true };
    });

    // -------- Persistent-session agent runtime (stream-json I/O) --------
    // One subprocess per agent, alive across turns. Supports interactive
    // permission prompts via can_use_tool events.

    function emitSessionEvent(agentId, sessionKey, event) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent-session-event', { sessionKey, agentId, event });
        }
    }

    ipcMain.handle('agent-session-start', async (event, { agentId, options }) => {
        if (!agentId) throw new Error('agent-session-start: agentId required');
        // If a session already exists for this agent, keep it.
        for (const [key, state] of agentSessions) {
            if (state.agentId === agentId) return { sessionKey: key, reused: true };
        }

        const opts = options || {};
        const args = [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            // Route permission prompts over stdio so we can ask the user via our
            // own UI. The flag isn't in --help but is the same path the Agent SDK uses.
            '--permission-prompt-tool', 'stdio',
        ];
        if (opts.permissionMode && typeof opts.permissionMode === 'string') {
            args.push('--permission-mode', opts.permissionMode);
        }
        if (opts.systemPrompt && typeof opts.systemPrompt === 'string' && opts.systemPrompt.trim().length > 0) {
            args.push('--append-system-prompt', opts.systemPrompt);
        }
        if (opts.model && typeof opts.model === 'string' && opts.model.trim().length > 0) {
            args.push('--model', opts.model);
        }
        if (Array.isArray(opts.addDirs)) {
            for (const dir of opts.addDirs) {
                if (typeof dir === 'string' && dir.length > 0) args.push('--add-dir', dir);
            }
        }
        if (Array.isArray(opts.allowedTools) && opts.allowedTools.length > 0) {
            args.push('--allowedTools', ...opts.allowedTools.filter(t => typeof t === 'string' && t.length > 0));
        }
        if (opts.resumeSessionId && typeof opts.resumeSessionId === 'string') {
            args.push('--resume', opts.resumeSessionId);
        }

        const cwd = typeof opts.cwd === 'string' && opts.cwd.length > 0 ? opts.cwd : process.env.HOME;
        let proc;
        try {
            proc = spawn('claude', args, {
                cwd,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (err) {
            throw new Error(`Failed to spawn claude: ${err.message || String(err)}`);
        }

        const sessionKey = crypto.randomUUID();
        const state = { proc, agentId, buffer: '' };
        agentSessions.set(sessionKey, state);

        // Send the initialize control_request immediately so the CLI knows we
        // can handle can_use_tool prompts via stdio.
        try {
            const initPayload = {
                type: 'control_request',
                request_id: crypto.randomUUID(),
                request: { subtype: 'initialize', hooks: {}, sdkMcpServers: [] },
            };
            proc.stdin.write(JSON.stringify(initPayload) + '\n');
        } catch (err) {
            console.warn('[agent] failed to send initialize', err);
        }

        proc.on('error', (err) => {
            emitSessionEvent(agentId, sessionKey, { type: 'error', message: err.message || String(err) });
        });

        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (chunk) => {
            const s = agentSessions.get(sessionKey);
            if (!s) return;
            s.buffer += chunk;
            let idx;
            while ((idx = s.buffer.indexOf('\n')) !== -1) {
                const line = s.buffer.slice(0, idx).trim();
                s.buffer = s.buffer.slice(idx + 1);
                if (!line) continue;
                try {
                    emitSessionEvent(agentId, sessionKey, JSON.parse(line));
                } catch {
                    emitSessionEvent(agentId, sessionKey, { type: 'stdout_raw', text: line });
                }
            }
        });

        proc.stderr.setEncoding('utf-8');
        proc.stderr.on('data', (chunk) => {
            emitSessionEvent(agentId, sessionKey, { type: 'stderr', text: chunk });
        });

        proc.on('close', (code, signal) => {
            const s = agentSessions.get(sessionKey);
            if (s && s.buffer.trim().length > 0) {
                try { emitSessionEvent(agentId, sessionKey, JSON.parse(s.buffer.trim())); }
                catch { emitSessionEvent(agentId, sessionKey, { type: 'stdout_raw', text: s.buffer.trim() }); }
            }
            agentSessions.delete(sessionKey);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('agent-session-exit', { sessionKey, agentId, code, signal });
            }
        });

        return { sessionKey, reused: false };
    });

    ipcMain.on('agent-session-write', (event, { sessionKey, payload }) => {
        const s = agentSessions.get(sessionKey);
        if (!s || !s.proc.stdin.writable) return;
        try {
            s.proc.stdin.write(JSON.stringify(payload) + '\n');
        } catch (err) {
            emitSessionEvent(s.agentId, sessionKey, { type: 'error', message: `stdin write failed: ${err.message || String(err)}` });
        }
    });

    ipcMain.handle('agent-session-stop', async (event, { sessionKey }) => {
        const s = agentSessions.get(sessionKey);
        if (s) {
            try { s.proc.stdin.end(); } catch { /* ignore */ }
            try { s.proc.kill(); } catch { /* ignore */ }
            agentSessions.delete(sessionKey);
        }
        return { success: true };
    });

    // Ask Claude Code for the authoritative list of slash commands + plugin
    // paths by spawning it with stream-json output, capturing the init event,
    // then killing before the API call completes (no token cost).
    ipcMain.handle('claude-list-slash-commands', async (event, { cwd } = {}) => {
        return await new Promise((resolve) => {
            let proc;
            try {
                proc = spawn('claude', [
                    '-p', '__probe__',
                    '--output-format', 'stream-json',
                    '--verbose',
                    '--permission-mode', 'plan',
                ], {
                    cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : process.env.HOME,
                    env: process.env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch (err) {
                resolve({ error: `spawn failed: ${err.message || String(err)}` });
                return;
            }

            let buffer = '';
            let settled = false;
            const finish = (payload) => {
                if (settled) return;
                settled = true;
                try { proc.kill(); } catch { /* ignore */ }
                resolve(payload);
            };

            proc.on('error', (err) => finish({ error: err.message || String(err) }));
            proc.on('close', () => {
                if (!settled) finish({ error: 'claude exited before init event' });
            });

            // Safety timeout — init normally arrives in <2s.
            const timer = setTimeout(() => finish({ error: 'timeout waiting for init event' }), 15000);

            proc.stdout.setEncoding('utf-8');
            proc.stdout.on('data', (chunk) => {
                buffer += chunk;
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (!line) continue;
                    try {
                        const event = JSON.parse(line);
                        if (event && event.type === 'system' && event.subtype === 'init') {
                            clearTimeout(timer);
                            finish({
                                slashCommands: Array.isArray(event.slash_commands) ? event.slash_commands : [],
                                plugins: Array.isArray(event.plugins) ? event.plugins : [],
                                skills: Array.isArray(event.skills) ? event.skills : [],
                            });
                            return;
                        }
                    } catch { /* ignore non-JSON lines */ }
                }
            });
        });
    });

    // Plugin management IPC handlers
    ipcMain.handle('get-quipu-dir', () => QUIPU_HOME_DIR);

    ipcMain.handle('read-plugins-config', async () => {
        try {
            return await fs.promises.readFile(PLUGINS_CONFIG_PATH, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    });

    ipcMain.handle('write-plugins-config', async (event, content) => {
        await fs.promises.mkdir(QUIPU_HOME_DIR, { recursive: true });
        await fs.promises.writeFile(PLUGINS_CONFIG_PATH, content, 'utf-8');
        return { success: true };
    });

    ipcMain.handle('list-plugin-dirs', async () => {
        try {
            const entries = await fs.promises.readdir(PLUGINS_DIR, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    });

    ipcMain.handle('remove-plugin-dir', async (event, id) => {
        const pluginPath = path.join(PLUGINS_DIR, id);
        await fs.promises.rm(pluginPath, { recursive: true, force: true });
        return { success: true };
    });

    ipcMain.handle('download-and-extract-plugin', async (event, { id, downloadUrl }) => {
        const destDir = path.join(PLUGINS_DIR, id);
        const resolvedDest = path.resolve(destDir);

        // Download the zip
        let zipBuffer;
        try {
            const response = await net.fetch(downloadUrl);
            if (!response.ok) {
                return { error: `Download failed: ${response.status} ${response.statusText}` };
            }
            const arrayBuffer = await response.arrayBuffer();
            zipBuffer = Buffer.from(arrayBuffer);
        } catch (err) {
            return { error: `Download failed: ${err.message}` };
        }

        // Validate all entries for zip slip before extracting anything
        try {
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries();

            for (const entry of entries) {
                if (entry.isDirectory) continue;
                // Normalize separators and strip leading slashes
                const normalized = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
                const entryResolved = path.resolve(destDir, normalized);
                if (!entryResolved.startsWith(resolvedDest + path.sep)) {
                    return { error: `Zip slip detected in entry: ${entry.entryName}` };
                }
            }

            await fs.promises.mkdir(destDir, { recursive: true });
            zip.extractAllTo(destDir, /* overwrite */ true);
            return { success: true };
        } catch (err) {
            return { error: `Extraction failed: ${err.message}` };
        }
    });

    // Kamalu OAuth: spawn a localhost HTTP listener, return the URL the
    // browser should redirect back to. The renderer opens the sign-in page in
    // the system browser; when the page redirects to our loopback with a
    // ?token=..., we capture it and push it back to the renderer.
    ipcMain.handle('kamalu:start-oauth', async (_event, { signInUrl }) => {
        return new Promise((resolve, reject) => {
            const state = crypto.randomBytes(16).toString('hex');
            let settled = false;
            const server = http.createServer((req, res) => {
                try {
                    const url = new URL(req.url, 'http://127.0.0.1');
                    if (url.pathname !== '/callback') {
                        res.writeHead(404).end();
                        return;
                    }
                    const token = url.searchParams.get('token');
                    const returnedState = url.searchParams.get('state');
                    const serverUrl = url.searchParams.get('server');
                    const errorParam = url.searchParams.get('error');

                    if (errorParam) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<!doctype html><meta charset="utf-8"><title>Kamalu</title><body style="font-family:system-ui;padding:40px;color:#b91c1c"><h2>Sign-in failed</h2><p>${errorParam}</p><p>You can close this tab.</p></body>`);
                        if (!settled) {
                            settled = true;
                            server.close();
                            reject(new Error(errorParam));
                        }
                        return;
                    }

                    if (!token || returnedState !== state) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid callback');
                        return;
                    }

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<!doctype html><meta charset="utf-8"><title>Kamalu</title><body style="font-family:system-ui;padding:40px"><h2>Signed in to Kamalu</h2><p>You can close this tab and return to Quipu.</p><script>setTimeout(()=>window.close(),800)</script></body>');

                    if (!settled) {
                        settled = true;
                        server.close();
                        resolve({ token, serverUrl });
                    }
                } catch (err) {
                    res.writeHead(500).end();
                    if (!settled) {
                        settled = true;
                        server.close();
                        reject(err);
                    }
                }
            });
            server.on('error', (err) => {
                if (!settled) { settled = true; reject(err); }
            });
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                const redirectUri = `http://127.0.0.1:${port}/callback`;
                const url = new URL(signInUrl);
                url.searchParams.set('redirect_uri', redirectUri);
                url.searchParams.set('state', state);
                shell.openExternal(url.toString());
            });
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    server.close();
                    reject(new Error('Sign-in timed out'));
                }
            }, 5 * 60 * 1000);
        });
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
