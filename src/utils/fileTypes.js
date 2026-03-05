const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less',
  '.html', '.xml', '.py', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.hpp', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml',
  '.sql', '.rb', '.php', '.swift', '.kt', '.lua', '.r',
  '.dockerfile', '.makefile', '.gitignore', '.env', '.cjs', '.mjs',
]);

const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.ogg', '.mov',
]);

const EXT_TO_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'xml', '.xml': 'xml', '.svg': 'xml',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini',
  '.sql': 'sql', '.rb': 'ruby', '.php': 'php',
};

export function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : '';
}

export function isCodeFile(fileName) {
  return CODE_EXTENSIONS.has(getFileExtension(fileName));
}

export function isMediaFile(fileName) {
  return MEDIA_EXTENSIONS.has(getFileExtension(fileName));
}

export function getLanguage(fileName) {
  return EXT_TO_LANG[getFileExtension(fileName)] || null;
}

export function isExcalidrawFile(fileName) {
  return fileName.endsWith('.excalidraw');
}

export function getViewerType(tab) {
  if (!tab) return null;
  if (tab.isDiff) return 'diff';
  if (tab.isMedia) return 'media';
  if (tab.isQuipu) return 'editor';
  if (isExcalidrawFile(tab.name)) return 'excalidraw';
  if (tab.name.endsWith('.md') || tab.name.endsWith('.markdown')) return 'editor';
  if (isCodeFile(tab.name)) return 'code';
  if (isMediaFile(tab.name)) return 'media';
  return 'editor';
}
