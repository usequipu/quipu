/**
 * Thin Electron shell for production builds.
 *
 * Instead of using node-pty and IPC handlers, this shell spawns the bundled
 * Go server and loads the Vite-built frontend in browser mode. The frontend
 * connects to the Go server via HTTP/WebSocket. A minimal preload
 * (preload-thin.cjs) injects the server URL via contextBridge.
 */
const { app, BrowserWindow, ipcMain, net: electronNet } = require('electron');
const { spawn } = require('child_process');
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

app.whenReady().then(async () => {
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
