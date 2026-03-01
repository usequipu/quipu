import { SERVER_URL } from '../config.js';

const GO_SERVER = SERVER_URL;

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.readDirectory);
}

async function getHomeDir() {
  if (isElectron() && window.electronAPI.getHomeDir) {
    return window.electronAPI.getHomeDir();
  }
  // Browser mode: ask Go server
  try {
    const res = await fetch(`${GO_SERVER}/homedir`);
    if (res.ok) {
      const data = await res.json();
      return data.path;
    }
  } catch {}
  return '/home';
}

// Electron implementations
const electronFS = {
  openFolderDialog: async () => {
    // Try native dialog; if it returns null (failed or cancelled), let caller handle fallback
    const result = await window.electronAPI.openFolderDialog();
    return result; // null means cancelled or failed
  },
  getHomeDir,
  readDirectory: (dirPath) => window.electronAPI.readDirectory(dirPath),
  readFile: (filePath) => window.electronAPI.readFile(filePath),
  writeFile: (filePath, content) => window.electronAPI.writeFile(filePath, content),
  createFile: (filePath) => window.electronAPI.createFile(filePath),
  createFolder: (folderPath) => window.electronAPI.createFolder(folderPath),
  renamePath: (oldPath, newPath) => window.electronAPI.renamePath(oldPath, newPath),
  deletePath: (targetPath) => window.electronAPI.deletePath(targetPath),
  getFileUrl: (filePath) => `file://${filePath}`,
  watchDirectory: (dirPath) => window.electronAPI.watchDirectory(dirPath),
  onDirectoryChanged: (callback) => {
    window.electronAPI.onDirectoryChanged(callback);
    return () => window.electronAPI.removeDirectoryListener();
  },
};

// Browser/Go server implementations
const browserFS = {
  openFolderDialog: async () => {
    // Return null to trigger in-app folder picker
    return null;
  },
  getHomeDir,

  readDirectory: async (dirPath) => {
    const res = await fetch(`${GO_SERVER}/files?path=${encodeURIComponent(dirPath)}`);
    if (!res.ok) throw new Error(`Failed to read directory: ${res.statusText}`);
    return res.json();
  },

  readFile: async (filePath) => {
    const res = await fetch(`${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.text();
  },

  writeFile: async (filePath, content) => {
    const res = await fetch(`${GO_SERVER}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
    return res.json();
  },

  createFile: async (filePath) => {
    const res = await fetch(`${GO_SERVER}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: '' }),
    });
    if (!res.ok) throw new Error(`Failed to create file: ${res.statusText}`);
    return res.json();
  },

  createFolder: async (folderPath) => {
    const res = await fetch(`${GO_SERVER}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    if (!res.ok) throw new Error(`Failed to create folder: ${res.statusText}`);
    return res.json();
  },

  renamePath: async (oldPath, newPath) => {
    const res = await fetch(`${GO_SERVER}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    });
    if (!res.ok) throw new Error(`Failed to rename: ${res.statusText}`);
    return res.json();
  },

  deletePath: async (targetPath) => {
    const res = await fetch(`${GO_SERVER}/file?path=${encodeURIComponent(targetPath)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`);
    return res.json();
  },

  getFileUrl: (filePath) => `${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`,

  watchDirectory: async () => null,

  onDirectoryChanged: () => {
    return () => {};
  },
};

const fs = isElectron() ? electronFS : browserFS;

export default fs;
