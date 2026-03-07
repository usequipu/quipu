import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  isCodeFile,
  isMediaFile,
  isExcalidrawFile,
  getLanguage,
  getViewerType,
} from './fileTypes';

describe('getFileExtension', () => {
  it('returns extension for standard files', () => {
    expect(getFileExtension('file.js')).toBe('.js');
    expect(getFileExtension('file.test.jsx')).toBe('.jsx');
  });

  it('returns empty string for extensionless files', () => {
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('.gitignore')).toBe('.gitignore');
  });

  it('lowercases extensions', () => {
    expect(getFileExtension('file.JSX')).toBe('.jsx');
  });
});

describe('isCodeFile', () => {
  it('returns true for code extensions', () => {
    expect(isCodeFile('app.js')).toBe(true);
    expect(isCodeFile('app.jsx')).toBe(true);
    expect(isCodeFile('app.py')).toBe(true);
    expect(isCodeFile('app.go')).toBe(true);
    expect(isCodeFile('app.json')).toBe(true);
    expect(isCodeFile('app.css')).toBe(true);
  });

  it('returns false for non-code extensions', () => {
    expect(isCodeFile('image.png')).toBe(false);
    expect(isCodeFile('doc.md')).toBe(false);
    expect(isCodeFile('drawing.excalidraw')).toBe(false);
  });
});

describe('isMediaFile', () => {
  it('returns true for media extensions', () => {
    expect(isMediaFile('photo.jpg')).toBe(true);
    expect(isMediaFile('photo.png')).toBe(true);
    expect(isMediaFile('video.mp4')).toBe(true);
    expect(isMediaFile('icon.svg')).toBe(true);
  });

  it('returns false for non-media extensions', () => {
    expect(isMediaFile('app.js')).toBe(false);
    expect(isMediaFile('doc.md')).toBe(false);
  });
});

describe('isExcalidrawFile', () => {
  it('returns true for .excalidraw files', () => {
    expect(isExcalidrawFile('drawing.excalidraw')).toBe(true);
    expect(isExcalidrawFile('my-diagram.excalidraw')).toBe(true);
  });

  it('returns false for other files', () => {
    expect(isExcalidrawFile('file.json')).toBe(false);
    expect(isExcalidrawFile('file.md')).toBe(false);
    expect(isExcalidrawFile('excalidraw.js')).toBe(false);
  });
});

describe('getLanguage', () => {
  it('returns language for known extensions', () => {
    expect(getLanguage('app.js')).toBe('javascript');
    expect(getLanguage('app.py')).toBe('python');
    expect(getLanguage('app.go')).toBe('go');
    expect(getLanguage('app.rs')).toBe('rust');
  });

  it('returns null for unknown extensions', () => {
    expect(getLanguage('file.excalidraw')).toBeNull();
    expect(getLanguage('file.md')).toBeNull();
    expect(getLanguage('file.unknown')).toBeNull();
  });
});

describe('getViewerType', () => {
  it('returns null for null tab', () => {
    expect(getViewerType(null)).toBeNull();
  });

  it('returns diff for diff tabs', () => {
    expect(getViewerType({ isDiff: true, name: 'file.js' })).toBe('diff');
  });

  it('returns media for media tabs', () => {
    expect(getViewerType({ isMedia: true, name: 'photo.jpg' })).toBe('media');
  });

  it('returns editor for quipu tabs', () => {
    expect(getViewerType({ isQuipu: true, name: 'doc.quipu' })).toBe('editor');
  });

  it('returns excalidraw for .excalidraw files', () => {
    expect(getViewerType({ name: 'drawing.excalidraw' })).toBe('excalidraw');
  });

  it('returns editor for markdown files', () => {
    expect(getViewerType({ name: 'readme.md' })).toBe('editor');
    expect(getViewerType({ name: 'readme.markdown' })).toBe('editor');
  });

  it('returns code for code files', () => {
    expect(getViewerType({ name: 'app.js' })).toBe('code');
    expect(getViewerType({ name: 'styles.css' })).toBe('code');
  });

  it('returns media for media file extensions', () => {
    expect(getViewerType({ name: 'photo.png' })).toBe('media');
  });

  it('returns editor as default', () => {
    expect(getViewerType({ name: 'unknown.xyz' })).toBe('editor');
  });

  it('prioritizes diff over everything', () => {
    expect(getViewerType({ isDiff: true, isMedia: true, name: 'photo.png' })).toBe('diff');
  });

  it('prioritizes excalidraw over code', () => {
    // .excalidraw is not in CODE_EXTENSIONS so this tests routing order
    expect(getViewerType({ name: 'test.excalidraw' })).toBe('excalidraw');
  });
});
