import fs from './fileSystem.js';

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

async function addAnnotation(workspacePath, filePath, { line, text, type = 'review', author = 'user' }) {
  let frame = await readFrame(workspacePath, filePath);
  if (!frame) frame = createEmptyFrame(filePath, workspacePath);

  frame.annotations.push({
    id: generateId(),
    line,
    text,
    type,
    author,
    timestamp: new Date().toISOString(),
  });

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

const frameService = {
  getFramePath,
  readFrame,
  writeFrame,
  createFrame,
  addAnnotation,
  addHistoryEntry,
  updateInstructions,
};

export default frameService;
