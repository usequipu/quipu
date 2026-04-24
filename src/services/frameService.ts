import fs from './fileSystem';
import { SERVER_URL } from '../config.js';

const FRAME_VERSION = 1;
const MAX_HISTORY_ENTRIES = 20;

function generateId(): string {
  return crypto.randomUUID();
}

export interface FrameAnnotationResponse {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface FrameAnnotation {
  id: string;
  line?: number;
  text: string;
  type: string;
  author: string;
  page?: number;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  occurrence?: number | null;
  topRatio?: number;
  detached?: boolean;
  timestamp: string;
  /** Threaded replies under this annotation (human or agent). */
  responses?: FrameAnnotationResponse[];
}

export interface AddResponseParams {
  body: string;
  author?: string;
}

export interface FrameHistoryEntry {
  id: string;
  prompt: string;
  summary: string;
  timestamp: string;
}

export interface Frame {
  version: number;
  type: string;
  id: string;
  filePath: string;
  format?: 'markdown' | 'quipu' | 'text';
  createdAt: string;
  updatedAt: string;
  annotations: FrameAnnotation[];
  instructions: string;
  history: FrameHistoryEntry[];
}

export interface AddAnnotationParams {
  id?: string;
  line?: number;
  text: string;
  type?: string;
  author?: string;
  page?: number;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  occurrence?: number | null;
  topRatio?: number;
}

export interface AddHistoryParams {
  prompt: string;
  summary: string;
}

interface FrameWatchCleanup {
  (): void;
  registerPath?: (framePath: string) => void;
}

export interface FrameService {
  getFramePath: (workspacePath: string, filePath: string) => string;
  readFrame: (workspacePath: string, filePath: string) => Promise<Frame | null>;
  writeFrame: (workspacePath: string, filePath: string, frame: Frame) => Promise<Frame>;
  createFrame: (workspacePath: string, filePath: string) => Promise<Frame>;
  addAnnotation: (workspacePath: string, filePath: string, params: AddAnnotationParams) => Promise<Frame>;
  removeAnnotation: (workspacePath: string, filePath: string, annotationId: string) => Promise<Frame | null>;
  addResponse: (workspacePath: string, filePath: string, annotationId: string, params: AddResponseParams) => Promise<Frame | null>;
  removeResponse: (workspacePath: string, filePath: string, annotationId: string, responseId: string) => Promise<Frame | null>;
  addHistoryEntry: (workspacePath: string, filePath: string, params: AddHistoryParams) => Promise<Frame>;
  updateInstructions: (workspacePath: string, filePath: string, instructions: string) => Promise<Frame>;
  resolveAnnotations: (workspacePath: string, filePath: string, plainTextCorpus?: string) => Promise<void>;
  watchFrames: (workspacePath: string, onFrameChanged: (fullPath: string) => void) => FrameWatchCleanup;
  isWritingFrame: () => boolean;
}

function getFramePath(workspacePath: string, filePath: string): string {
  const relativePath = filePath.replace(workspacePath + '/', '');
  return `${workspacePath}/.quipu/meta/${relativePath}.frame.json`;
}

function getFrameDir(framePath: string): string {
  return framePath.substring(0, framePath.lastIndexOf('/'));
}

function createEmptyFrame(filePath: string, workspacePath: string): Frame {
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

async function ensureFrameDir(framePath: string): Promise<void> {
  const dir = getFrameDir(framePath);
  try {
    await fs.createFolder(dir);
  } catch {
    // Directory may already exist
  }
}

async function readFrame(workspacePath: string, filePath: string): Promise<Frame | null> {
  const framePath = getFramePath(workspacePath, filePath);
  try {
    const content = await fs.readFile(framePath);
    if (!content) return null;
    return JSON.parse(content) as Frame;
  } catch {
    return null;
  }
}

async function writeFrame(workspacePath: string, filePath: string, frame: Frame): Promise<Frame> {
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

async function createFrame(workspacePath: string, filePath: string): Promise<Frame> {
  const existing = await readFrame(workspacePath, filePath);
  if (existing) return existing;

  const frame = createEmptyFrame(filePath, workspacePath);
  return writeFrame(workspacePath, filePath, frame);
}

async function addAnnotation(workspacePath: string, filePath: string, { id, line, text, type = 'review', author = 'user', page, selectedText, contextBefore, contextAfter, occurrence, topRatio }: AddAnnotationParams): Promise<Frame> {
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
    contextBefore,
    contextAfter,
    occurrence,
    topRatio,
    timestamp: new Date().toISOString(),
  });

  return writeFrame(workspacePath, filePath, frame);
}

async function removeAnnotation(workspacePath: string, filePath: string, annotationId: string): Promise<Frame | null> {
  const frame = await readFrame(workspacePath, filePath);
  if (!frame) return null;

  frame.annotations = frame.annotations.filter((a) => a.id !== annotationId);
  return writeFrame(workspacePath, filePath, frame);
}

async function addResponse(workspacePath: string, filePath: string, annotationId: string, { body, author = 'user' }: AddResponseParams): Promise<Frame | null> {
  const frame = await readFrame(workspacePath, filePath);
  if (!frame) return null;
  const annotation = frame.annotations.find((a) => a.id === annotationId);
  if (!annotation) return frame;
  const response: FrameAnnotationResponse = {
    id: generateId(),
    author,
    body,
    createdAt: new Date().toISOString(),
  };
  annotation.responses = [...(annotation.responses ?? []), response];
  return writeFrame(workspacePath, filePath, frame);
}

async function removeResponse(workspacePath: string, filePath: string, annotationId: string, responseId: string): Promise<Frame | null> {
  const frame = await readFrame(workspacePath, filePath);
  if (!frame) return null;
  const annotation = frame.annotations.find((a) => a.id === annotationId);
  if (!annotation || !annotation.responses) return frame;
  annotation.responses = annotation.responses.filter((r) => r.id !== responseId);
  return writeFrame(workspacePath, filePath, frame);
}

async function addHistoryEntry(workspacePath: string, filePath: string, { prompt, summary }: AddHistoryParams): Promise<Frame> {
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

async function updateInstructions(workspacePath: string, filePath: string, instructions: string): Promise<Frame> {
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
async function writeFrameWithFlag(workspacePath: string, filePath: string, frame: Frame): Promise<Frame> {
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
function watchFrames(workspacePath: string, onFrameChanged: (fullPath: string) => void): FrameWatchCleanup {
  if (!workspacePath) return (() => {}) as FrameWatchCleanup;

  if (window.electronAPI && window.electronAPI.watchFrameDirectory) {
    // Electron: native watcher
    window.electronAPI.watchFrameDirectory(workspacePath).catch(() => {});

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = ({ filename }: { filename: string }) => {
      if (!filename || isWritingFrame) return;

      // Debounce rapid events (write-then-rename patterns)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // filename is relative to .quipu/meta/, e.g. "src/App.jsx.frame.json"
        // Strip .frame.json suffix to get the relative file path
        const relativePath = filename.replace(/\.frame\.json$/, '').replace(/\\/g, '/');
        const fullPath = workspacePath + '/' + relativePath;
        onFrameChanged(fullPath);
      }, 500);
    };

    window.electronAPI.onFrameChanged(handler);

    return (() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.electronAPI!.removeFrameListener();
    }) as FrameWatchCleanup;
  }

  // Browser: poll mtime of FRAME files via /file/stat endpoint
  // Tracks all .frame.json files that have been accessed
  const mtimeCache: Record<string, string | null> = {};

  // Auto-discover frame paths by scanning open tab paths from the caller
  // The caller can register specific paths via cleanup.registerPath()
  const id = setInterval(async () => {
    if (isWritingFrame) return;

    for (const [framePath, lastMtime] of Object.entries(mtimeCache)) {
      try {
        const res = await fetch(`${SERVER_URL}/file/stat?path=${encodeURIComponent(framePath)}`);
        if (!res.ok) continue;
        const { mtime }: { mtime: string } = await res.json();
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

  const cleanup: FrameWatchCleanup = () => clearInterval(id);
  // Allow external code to register frame paths for polling
  cleanup.registerPath = (framePath: string) => {
    if (!(framePath in mtimeCache)) {
      mtimeCache[framePath] = null; // Will be populated on first poll tick
    }
  };
  return cleanup;
}

async function resolveAnnotations(workspacePath: string, filePath: string, plainTextCorpus?: string): Promise<void> {
  if (!workspacePath || !filePath) return;

  if (window.electronAPI?.resolveFrameAnnotations) {
    await window.electronAPI.resolveFrameAnnotations(workspacePath, filePath, plainTextCorpus);
    return;
  }

  await fetch(`${SERVER_URL}/frame/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, filePath, plainText: plainTextCorpus }),
  });
}

const frameService: FrameService = {
  getFramePath,
  readFrame,
  writeFrame: writeFrameWithFlag,
  createFrame,
  addAnnotation,
  removeAnnotation,
  addResponse,
  removeResponse,
  addHistoryEntry,
  updateInstructions,
  resolveAnnotations,
  watchFrames,
  isWritingFrame: () => isWritingFrame,
};

export default frameService;
