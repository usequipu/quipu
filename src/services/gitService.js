import { SERVER_URL } from '../config.js';

const GO_SERVER = SERVER_URL;

function isElectron() {
  return !!(window.electronAPI && window.electronAPI.gitStatus);
}

const electronGit = {
  status: (dirPath) => window.electronAPI.gitStatus(dirPath),
  diff: (dirPath, file, staged) => window.electronAPI.gitDiff(dirPath, file, staged),
  stage: (dirPath, files) => window.electronAPI.gitStage(dirPath, files),
  unstage: (dirPath, files) => window.electronAPI.gitUnstage(dirPath, files),
  commit: (dirPath, message) => window.electronAPI.gitCommit(dirPath, message),
  push: (dirPath) => window.electronAPI.gitPush(dirPath),
  pull: (dirPath) => window.electronAPI.gitPull(dirPath),
  branches: (dirPath) => window.electronAPI.gitBranches(dirPath),
  checkout: (dirPath, branch) => window.electronAPI.gitCheckout(dirPath, branch),
  log: (dirPath) => window.electronAPI.gitLog(dirPath),
};

const browserGit = {
  status: async () => {
    const res = await fetch(`${GO_SERVER}/git/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  diff: async (dirPath, file, staged = false) => {
    const params = new URLSearchParams();
    if (file) params.set('file', file);
    if (staged) params.set('staged', 'true');
    const res = await fetch(`${GO_SERVER}/git/diff?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  stage: async (dirPath, files) => {
    const res = await fetch(`${GO_SERVER}/git/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  unstage: async (dirPath, files) => {
    const res = await fetch(`${GO_SERVER}/git/unstage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  commit: async (dirPath, message) => {
    const res = await fetch(`${GO_SERVER}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  push: async () => {
    const res = await fetch(`${GO_SERVER}/git/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  pull: async () => {
    const res = await fetch(`${GO_SERVER}/git/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  branches: async () => {
    const res = await fetch(`${GO_SERVER}/git/branches`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  checkout: async (dirPath, branch) => {
    const res = await fetch(`${GO_SERVER}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  log: async () => {
    const res = await fetch(`${GO_SERVER}/git/log`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

const gitService = isElectron() ? electronGit : browserGit;
export default gitService;
