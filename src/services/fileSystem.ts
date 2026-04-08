import { SERVER_URL } from '../config.js';
import type { DirectoryEntry } from '../types/electron-api';

const GO_SERVER = SERVER_URL;

function isElectron(): boolean {
  return !!(window.electronAPI && window.electronAPI.readDirectory);
}

export interface FileSystemService {
  openFolderDialog: () => Promise<string | null>;
  openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  getHomeDir: () => Promise<string>;
  readDirectory: (dirPath: string) => Promise<DirectoryEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  createFile: (filePath: string) => Promise<{ success: boolean }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean }>;
  renamePath: (oldPath: string, newPath: string) => Promise<{ success: boolean }>;
  deletePath: (targetPath: string) => Promise<{ success: boolean }>;
  getFileUrl: (filePath: string) => string;
  uploadImage: (filePath: string, base64Data: string) => Promise<{ success: boolean; url?: string }>;
  watchDirectory: (dirPath: string) => Promise<{ success: boolean } | null>;
  onDirectoryChanged: (callback: (event: { type: string; path?: string }) => void) => () => void;
}

async function getHomeDir(): Promise<string> {
  if (isElectron()) {
    return window.electronAPI!.getHomeDir();
  }
  // Browser mode: ask Go server
  try {
    const res = await fetch(`${GO_SERVER}/homedir`);
    if (res.ok) {
      const data: { path: string } = await res.json();
      return data.path;
    }
  } catch {}
  return '/home';
}

// Electron implementations
const electronFS: FileSystemService = {
  openFolderDialog: async () => {
    const result = await window.electronAPI!.openFolderDialog();
    return result;
  },
  openFileDialog: async (options) => {
    const result = await window.electronAPI!.openFileDialog(options);
    return result;
  },
  getHomeDir,
  readDirectory: (dirPath: string) => window.electronAPI!.readDirectory(dirPath),
  readFile: (filePath: string) => window.electronAPI!.readFile(filePath),
  writeFile: (filePath: string, content: string) => window.electronAPI!.writeFile(filePath, content),
  createFile: (filePath: string) => window.electronAPI!.createFile(filePath),
  createFolder: (folderPath: string) => window.electronAPI!.createFolder(folderPath),
  renamePath: (oldPath: string, newPath: string) => window.electronAPI!.renamePath(oldPath, newPath),
  deletePath: (targetPath: string) => window.electronAPI!.deletePath(targetPath),
  getFileUrl: (filePath: string) => `quipu-file://${encodeURIComponent(filePath)}`,
  uploadImage: (filePath: string, base64Data: string) => window.electronAPI!.uploadImage(filePath, base64Data),
  watchDirectory: (dirPath: string) => window.electronAPI!.watchDirectory(dirPath),
  onDirectoryChanged: (callback: (event: { type: string; path?: string }) => void) => {
    window.electronAPI!.onDirectoryChanged(callback);
    return () => window.electronAPI!.removeDirectoryListener();
  },
};

// Browser/Go server implementations
const browserFS: FileSystemService = {
  openFolderDialog: async () => {
    // Return null to trigger in-app folder picker
    return null;
  },
  openFileDialog: async () => {
    // Browser mode: no native file dialog, return null
    return null;
  },
  getHomeDir,

  readDirectory: async (dirPath: string) => {
    const res = await fetch(`${GO_SERVER}/files?path=${encodeURIComponent(dirPath)}`);
    if (!res.ok) throw new Error(`Failed to read directory: ${res.statusText}`);
    const data: DirectoryEntry[] | null = await res.json();
    return data || [];
  },

  readFile: async (filePath: string) => {
    const res = await fetch(`${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
    return res.text();
  },

  writeFile: async (filePath: string, content: string) => {
    const res = await fetch(`${GO_SERVER}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
    return res.json();
  },

  createFile: async (filePath: string) => {
    const res = await fetch(`${GO_SERVER}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: '' }),
    });
    if (!res.ok) throw new Error(`Failed to create file: ${res.statusText}`);
    return res.json();
  },

  createFolder: async (folderPath: string) => {
    const res = await fetch(`${GO_SERVER}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    if (!res.ok) throw new Error(`Failed to create folder: ${res.statusText}`);
    return res.json();
  },

  renamePath: async (oldPath: string, newPath: string) => {
    const res = await fetch(`${GO_SERVER}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    });
    if (!res.ok) throw new Error(`Failed to rename: ${res.statusText}`);
    return res.json();
  },

  deletePath: async (targetPath: string) => {
    const res = await fetch(`${GO_SERVER}/file?path=${encodeURIComponent(targetPath)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`);
    return res.json();
  },

  getFileUrl: (filePath: string) => `${GO_SERVER}/file?path=${encodeURIComponent(filePath)}`,

  uploadImage: async (filePath: string, base64Data: string) => {
    const res = await fetch(`${GO_SERVER}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, data: base64Data }),
    });
    if (!res.ok) throw new Error(`Failed to upload image: ${res.statusText}`);
    return res.json();
  },

  watchDirectory: async () => null,

  onDirectoryChanged: () => {
    return () => {};
  },
};

const fs: FileSystemService = isElectron() ? electronFS : browserFS;

export default fs;
