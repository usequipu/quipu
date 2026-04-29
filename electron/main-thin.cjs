/**
 * Thin Electron shell for production builds.
 *
 * Instead of using node-pty and IPC handlers, this shell spawns the bundled
 * Go server and loads the Vite-built frontend in browser mode. The frontend
 * connects to the Go server via HTTP/WebSocket. A minimal preload
 * (preload-thin.cjs) injects the server URL via contextBridge.
 */
const { app, BrowserWindow, ipcMain, net: electronNet, protocol } = require('electron');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const netTcp = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

// Plugin management paths
const QUIPU_HOME_DIR = path.join(os.homedir(), '.quipu');
const PLUGINS_CONFIG_PATH = path.join(QUIPU_HOME_DIR, 'plugins.json');
const PLUGINS_DIR = path.join(QUIPU_HOME_DIR, 'plugins');

// Register custom protocol schemes before app is ready. Mirror of main.cjs:
// `quipu-plugin` is `standard` so plugins loaded under it get a fetchable
// `import.meta.url` and can resolve sibling assets (fonts, css) by relative
// path; `quipu-runtime` serves React proxy modules so plugins share the
// host's React instance via globalThis.
protocol.registerSchemesAsPrivileged([
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
    if (/\bexports\b/.test(patched)) {
        patched = 'var exports = {};\n' + patched;
    }
    patched = patched
        .replace(/(['"])react\/jsx-runtime\1/g, '"quipu-runtime://react/jsx-runtime.js"')
        .replace(/(['"])react-dom\/client\1/g, '"quipu-runtime://react/react-dom.js"')
        .replace(/(['"])react-dom\1/g, '"quipu-runtime://react/react-dom.js"')
        .replace(/(['"])react\1/g, '"quipu-runtime://react/react.js"');
    return patched;
}

const PLUGIN_ASSET_MIME = {
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8',
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // Not available outside Squirrel installer context
}

let mainWindow;
let goServer;
let serverPort;

/**
 * Find a free TCP port, starting from the preferred port.
 */
function findFreePort(preferred) {
    return new Promise((resolve, reject) => {
        const server = netTcp.createServer();
        server.listen(preferred, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            // Preferred port busy, let OS pick one
            const server2 = netTcp.createServer();
            server2.listen(0, '127.0.0.1', () => {
                const { port } = server2.address();
                server2.close(() => resolve(port));
            });
            server2.on('error', reject);
        });
    });
}

/**
 * Get the path to the bundled Go server binary.
 * Returns null in dev mode (server should be run separately).
 */
function getServerBinary() {
    if (process.env.VITE_DEV_SERVER_URL) return null;

    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryPath = path.join(process.resourcesPath, 'server', `quipu-server${ext}`);

    if (!fs.existsSync(binaryPath)) {
        console.error('Go server binary not found at:', binaryPath);
        return null;
    }

    return binaryPath;
}

/**
 * Poll the Go server's /health endpoint until it responds or timeout.
 */
function waitForHealth(port, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (Date.now() - start > timeoutMs) {
                reject(new Error(`Server did not become healthy within ${timeoutMs}ms`));
                return;
            }

            const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            });

            req.on('error', () => {
                setTimeout(check, 100);
            });

            req.setTimeout(500, () => {
                req.destroy();
                setTimeout(check, 100);
            });
        };

        check();
    });
}

/**
 * Start the bundled Go server. In dev mode, assumes it's running externally.
 */
async function startServer(port) {
    const bin = getServerBinary();
    if (!bin) {
        // Dev mode — assume Go server is running externally
        serverPort = port;
        return;
    }

    // Ensure executable permission on Unix
    if (process.platform !== 'win32') {
        try {
            fs.chmodSync(bin, 0o755);
        } catch (err) {
            console.warn('Could not set execute permission:', err.message);
        }
    }

    goServer = spawn(bin, ['-addr', `127.0.0.1:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    goServer.stdout.on('data', (data) => {
        console.log(`[go-server] ${data.toString().trim()}`);
    });

    goServer.stderr.on('data', (data) => {
        console.error(`[go-server] ${data.toString().trim()}`);
    });

    goServer.on('error', (err) => {
        console.error('Failed to start Go server:', err);
    });

    goServer.on('exit', (code, signal) => {
        if (code !== null && code !== 0) {
            console.error(`Go server exited with code ${code}`);
        }
        goServer = null;
    });

    serverPort = port;

    // Wait for the server to be ready
    await waitForHealth(port, 10000);
}

function stopServer() {
    if (goServer) {
        goServer.kill();
        goServer = null;
    }
}

function createWindow() {
    // Set port env var so preload-thin.cjs can read it
    process.env.QUIPU_SERVER_PORT = String(serverPort);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-thin.cjs'),
        },
        backgroundColor: '#252220',
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Window control IPC handlers
ipcMain.on('window-minimize', () => mainWindow?.minimize());

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
        return entries.filter(e => e.isDirectory()).map(e => e.name);
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

ipcMain.handle('read-file', async (event, filePath) => {
    // Sandboxed to QUIPU_HOME_DIR for plugin file reads
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(QUIPU_HOME_DIR + path.sep) && resolved !== QUIPU_HOME_DIR) {
        return null;
    }
    try {
        return await fs.promises.readFile(resolved, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
});

ipcMain.handle('download-and-extract-plugin', async (event, { id, downloadUrl }) => {
    const destDir = path.join(PLUGINS_DIR, id);
    const resolvedDest = path.resolve(destDir);

    let zipBuffer;
    try {
        const response = await electronNet.fetch(downloadUrl);
        if (!response.ok) {
            return { error: `Download failed: ${response.status} ${response.statusText}` };
        }
        const arrayBuffer = await response.arrayBuffer();
        zipBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
        return { error: `Download failed: ${err.message}` };
    }

    try {
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        for (const entry of entries) {
            if (entry.isDirectory) continue;
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
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});
ipcMain.on('window-close', () => mainWindow?.close());

// -------------------- Agent runtime (shared with main.cjs) --------------------
// These handlers power the Agent Manager feature in production builds. File
// system / terminal / git operations go through the Go server; the claude
// subprocess itself lives in the Electron main process so we can stream
// stdin/stdout bidirectionally for interactive permission prompts.

const agentSessions = new Map();

function emitSessionEvent(agentId, sessionKey, event) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-session-event', { sessionKey, agentId, event });
    }
}

ipcMain.handle('path-exists', async (event, targetPath) => {
    try { await fs.promises.access(targetPath); return true; } catch { return false; }
});

ipcMain.handle('get-home-dir', async () => os.homedir());

ipcMain.handle('git-clone', async (event, { url, targetDir }) => {
    if (typeof url !== 'string' || !url) throw new Error('git-clone: url required');
    if (typeof targetDir !== 'string' || !targetDir) throw new Error('git-clone: targetDir required');
    await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
    return new Promise((resolve, reject) => {
        execFile('git', ['clone', '--depth', '1', url, targetDir], { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) { reject(new Error(stderr || err.message || 'git clone failed')); return; }
            resolve({ output: stdout + stderr });
        });
    });
});

ipcMain.handle('agent-session-start', async (event, { agentId, options }) => {
    if (!agentId) throw new Error('agent-session-start: agentId required');
    for (const [key, state] of agentSessions) {
        if (state.agentId === agentId) return { sessionKey: key, reused: true };
    }

    const opts = options || {};
    const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-prompt-tool', 'stdio',
    ];
    if (opts.permissionMode && typeof opts.permissionMode === 'string') args.push('--permission-mode', opts.permissionMode);
    if (opts.systemPrompt && typeof opts.systemPrompt === 'string' && opts.systemPrompt.trim()) args.push('--append-system-prompt', opts.systemPrompt);
    if (opts.model && typeof opts.model === 'string' && opts.model.trim()) args.push('--model', opts.model);
    if (Array.isArray(opts.addDirs)) for (const dir of opts.addDirs) if (typeof dir === 'string' && dir.length > 0) args.push('--add-dir', dir);
    if (Array.isArray(opts.allowedTools) && opts.allowedTools.length > 0) args.push('--allowedTools', ...opts.allowedTools.filter(t => typeof t === 'string' && t.length > 0));
    if (opts.resumeSessionId && typeof opts.resumeSessionId === 'string') args.push('--resume', opts.resumeSessionId);

    const cwd = typeof opts.cwd === 'string' && opts.cwd.length > 0 ? opts.cwd : process.env.HOME;
    let proc;
    try {
        proc = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
        throw new Error(`Failed to spawn claude: ${err.message || String(err)}`);
    }

    const sessionKey = crypto.randomUUID();
    const state = { proc, agentId, buffer: '' };
    agentSessions.set(sessionKey, state);

    try {
        proc.stdin.write(JSON.stringify({
            type: 'control_request',
            request_id: crypto.randomUUID(),
            request: { subtype: 'initialize', hooks: {}, sdkMcpServers: [] },
        }) + '\n');
    } catch { /* ignore */ }

    proc.on('error', (err) => emitSessionEvent(agentId, sessionKey, { type: 'error', message: err.message || String(err) }));

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
            try { emitSessionEvent(agentId, sessionKey, JSON.parse(line)); }
            catch { emitSessionEvent(agentId, sessionKey, { type: 'stdout_raw', text: line }); }
        }
    });

    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => emitSessionEvent(agentId, sessionKey, { type: 'stderr', text: chunk }));

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
    try { s.proc.stdin.write(JSON.stringify(payload) + '\n'); }
    catch (err) { emitSessionEvent(s.agentId, sessionKey, { type: 'error', message: `stdin write failed: ${err.message || String(err)}` }); }
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
        } catch (err) { resolve({ error: `spawn failed: ${err.message || String(err)}` }); return; }

        let buffer = '';
        let settled = false;
        const finish = (payload) => {
            if (settled) return;
            settled = true;
            try { proc.kill(); } catch { /* ignore */ }
            resolve(payload);
        };

        proc.on('error', (err) => finish({ error: err.message || String(err) }));
        proc.on('close', () => { if (!settled) finish({ error: 'claude exited before init event' }); });

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
                    const ev = JSON.parse(line);
                    if (ev && ev.type === 'system' && ev.subtype === 'init') {
                        clearTimeout(timer);
                        finish({
                            slashCommands: Array.isArray(ev.slash_commands) ? ev.slash_commands : [],
                            plugins: Array.isArray(ev.plugins) ? ev.plugins : [],
                            skills: Array.isArray(ev.skills) ? ev.skills : [],
                        });
                        return;
                    }
                } catch { /* ignore */ }
            }
        });
    });
});

// Light-weight read-directory / read-file shims so the browser-mode scan
// fallback in claudeCommandsService works without the Go server (used for
// reading plugin .md files from the user's ~/.claude tree).
ipcMain.handle('read-directory', async (event, dirPath) => {
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            path: path.join(dirPath, e.name),
            isDirectory: e.isDirectory(),
        })).sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
});

// NOTE: 'read-file' is already registered above with QUIPU_HOME_DIR sandboxing.
// Widen it: agent context + claude-commands scanning needs to read arbitrary
// files under the user's home (.claude tree, workspace metadata, etc.).
// We replace the existing handler below by re-registering — Electron throws if
// we register twice, so we instead add a dedicated handler with a distinct name.
ipcMain.handle('read-file-abs', async (event, filePath) => {
    try { return await fs.promises.readFile(filePath, 'utf-8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
});

app.whenReady().then(async () => {
    // Serve plugin files from ~/.quipu/plugins/<id>/. Plugin entries get
    // delivered under a real URL so module Workers and relative-URL asset
    // resolution work the same way as on the web. JS files have their bare
    // React imports rewritten to quipu-runtime:// at serve time so plugins
    // share the host's React instance.
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
            const contentType = PLUGIN_ASSET_MIME[ext] || 'application/octet-stream';
            const buffer = await fs.promises.readFile(resolved);
            return new Response(buffer, {
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=3600',
                },
            });
        } catch (err) {
            if (err.code === 'ENOENT') return new Response('not found', { status: 404 });
            return new Response(`error: ${err.message || err}`, { status: 500 });
        }
    });

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

    try {
        const port = await findFreePort(3000);
        await startServer(port);
        createWindow();
    } catch (err) {
        console.error('Failed to start:', err);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopServer();
});
