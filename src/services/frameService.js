import fs from './fileSystem.js';
import { SERVER_URL } from '../config.js';

const FRAME_VERSION = 1;
const MAX_HISTORY_ENTRIES = 20;

function generateId() {
  return crypto.randomUUID();
}

function getFramePath(workspacePath, filePath) {
  const relativePath = filePath.replace(workspacePath + '/', '');
  return `${workspacePath}/.quipu/meta/${relativePath}.frame.json`;
}

function getFrameDir(framePath) {
  return framePath.substring(0, framePath.lastIndexOf('/'));
}

function createEmptyFrame(filePath, workspacePath) {
  const relativePath = filePath.replace(workspacePath + '/', '');
  return {
    version: FRAME_VERSION,
    type: 'frame',
    id: generateId(),
    filePath: relativePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    annotations: [],
    instructions: '',
    history: [],
  };
}

async function ensureFrameDir(framePath) {
  const dir = getFrameDir(framePath);
  try {
    await fs.createFolder(dir);
  } catch {
    // Directory may already exist
  }
}

async function readFrame(workspacePath, filePath) {
  const framePath = getFramePath(workspacePath, filePath);
  try {
    const content = await fs.readFile(framePath);
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeFrame(workspacePath, filePath, frame) {
  const framePath = getFramePath(workspacePath, filePath);
  await ensureFrameDir(framePath);

  // Enforce history cap
  if (frame.history && frame.history.length > MAX_HISTORY_ENTRIES) {
    frame.history = frame.history.slice(-MAX_HISTORY_ENTRIES);
  }

  frame.updatedAt = new Date().toISOString();
  await fs.writeFile(framePath, JSON.stringify(frame, null, 2));
  return frame;
}

async function createFrame(workspacePath, filePath) {
  const existing = await readFrame(workspacePath, filePath);
  if (existing) return existing;

  const frame = createEmptyFrame(filePath, workspacePath);
  return writeFrame(workspacePath, filePath, frame);
}

async function addAnnotation(workspacePath, filePath, { id, line, text, type = 'review', author = 'user', page, selectedText, occurrence, topRatio }) {
  let frame = await readFrame(workspacePath, filePath);
  if (!frame) frame = createEmptyFrame(filePath, workspacePath);

  frame.annotations.push({
    id: id || generateId(),
    line,
    text,
    type,
    author,
    page,
    selectedText,
    occurrence,
    topRatio,
    timestamp: new Date().toISOString(),
  });

  return writeFrame(workspacePath, filePath, frame);
}

async function removeAnnotation(workspacePath, filePath, annotationId) {
  const frame = await readFrame(workspacePath, filePath);
  if (!frame) return null;

  frame.annotations = frame.annotations.filter((a) => a.id !== annotationId);
  return writeFrame(workspacePath, filePath, frame);
}

async function addHistoryEntry(workspacePath, filePath, { prompt, summary }) {
  let frame = await readFrame(workspacePath, filePath);
  if (!frame) frame = createEmptyFrame(filePath, workspacePath);

  frame.history.push({
    id: generateId(),
    prompt,
    summary,
    timestamp: new Date().toISOString(),
  });

  return writeFrame(workspacePath, filePath, frame);
}

async function updateInstructions(workspacePath, filePath, instructions) {
  let frame = await readFrame(workspacePath, filePath);
  if (!frame) frame = createEmptyFrame(filePath, workspacePath);

  frame.instructions = instructions;
  return writeFrame(workspacePath, filePath, frame);
}

// --- FRAME file watching ---

// Flag to suppress watcher events during our own writes
let isWritingFrame = false;

// Wrap writeFrame to set the writing flag
const originalWriteFrame = writeFrame;
async function writeFrameWithFlag(workspacePath, filePath, frame) {
  isWritingFrame = true;
  try {
    const result = await originalWriteFrame(workspacePath, filePath, frame);
    // Keep flag set briefly to absorb delayed fs events
    setTimeout(() => { isWritingFrame = false; }, 600);
    return result;
  } catch (err) {
    isWritingFrame = false;
    throw err;
  }
}

/**
 * Watch for FRAME file changes. Returns a cleanup function.
 * - Electron: uses native fs.watch via IPC on .quipu/meta/
 * - Browser: polls mtime every 5 seconds
 */
function watchFrames(workspacePath, onFrameChanged) {
  if (!workspacePath) return () => {};

  if (window.electronAPI && window.electronAPI.watchFrameDirectory) {
    // Electron: native watcher
    window.electronAPI.watchFrameDirectory(workspacePath).catch(() => {});

    let debounceTimer = null;
    const handler = ({ filename }) => {
      if (!filename || isWritingFrame) return;

      // Debounce rapid events (write-then-rename patterns)
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // filename is relative to .quipu/meta/, e.g. "src/App.jsx.frame.json"
        // Strip .frame.json suffix to get the relative file path
        const relativePath = filename.replace(/\.frame\.json$/, '').replace(/\\/g, '/');
        const fullPath = workspacePath + '/' + relativePath;
        onFrameChanged(fullPath);
      }, 500);
    };

    window.electronAPI.onFrameChanged(handler);

    return () => {
      clearTimeout(debounceTimer);
      window.electronAPI.removeFrameListener();
    };
  }

  // Browser: poll mtime of FRAME files via /file/stat endpoint
  // Tracks all .frame.json files that have been accessed
  const mtimeCache = {};

  // Auto-discover frame paths by scanning open tab paths from the caller
  // The caller can register specific paths via cleanup.registerPath()
  const id = setInterval(async () => {
    if (isWritingFrame) return;

    for (const [framePath, lastMtime] of Object.entries(mtimeCache)) {
      try {
        const res = await fetch(`${SERVER_URL}/file/stat?path=${encodeURIComponent(framePath)}`);
        if (!res.ok) continue;
        const { mtime } = await res.json();
        if (lastMtime && mtime !== lastMtime) {
          // Extract source file path from frame path
          const metaPrefix = workspacePath + '/.quipu/meta/';
          const relativePath = framePath.replace(metaPrefix, '').replace(/\.frame\.json$/, '');
          const fullPath = workspacePath + '/' + relativePath;
          onFrameChanged(fullPath);
        }
        mtimeCache[framePath] = mtime;
      } catch { /* ignore transient errors */ }
    }
  }, 5000);

  const cleanup = () => clearInterval(id);
  // Allow external code to register frame paths for polling
  cleanup.registerPath = (framePath) => {
    if (!(framePath in mtimeCache)) {
      mtimeCache[framePath] = null; // Will be populated on first poll tick
    }
  };
  return cleanup;
}

const frameService = {
  getFramePath,
  readFrame,
  writeFrame: writeFrameWithFlag,
  createFrame,
  addAnnotation,
  removeAnnotation,
  addHistoryEntry,
  updateInstructions,
  watchFrames,
  isWritingFrame: () => isWritingFrame,
};

export default frameService;
