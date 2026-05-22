import { describe, it, expect } from 'vitest';
import { buildWindowTitle } from '../lib/windowTitle';
import type { ActiveFile } from '../types/tab';

const ws = '/home/user/project';

function file(path: string, name?: string): ActiveFile {
  return {
    path,
    name: name ?? path.split('/').pop() ?? path,
    content: '',
    isQuipu: false,
  };
}

describe('buildWindowTitle', () => {
  it('returns "Quipu" when no active file', () => {
    expect(buildWindowTitle(null, ws)).toBe('Quipu');
    expect(buildWindowTitle(null, null)).toBe('Quipu');
  });

  it('returns workspace-relative path when file is under workspace', () => {
    const f = file(`${ws}/src/components/App.tsx`);
    expect(buildWindowTitle(f, ws)).toBe('src/components/App.tsx');
  });

  it('handles top-level files', () => {
    const f = file(`${ws}/README.md`);
    expect(buildWindowTitle(f, ws)).toBe('README.md');
  });

  it('handles deeply nested paths like the agent-workspace tmp tree', () => {
    const f = file(`${ws}/tmp/abc-123/repos/code-plugin/tsconfig.json`);
    expect(buildWindowTitle(f, ws)).toBe('tmp/abc-123/repos/code-plugin/tsconfig.json');
  });

  it('falls back to name when workspace is null', () => {
    const f = file(`${ws}/src/App.tsx`, 'App.tsx');
    expect(buildWindowTitle(f, null)).toBe('App.tsx');
  });

  it('falls back to name when path is outside workspace (e.g., Kamalu remote)', () => {
    const f = file('/elsewhere/foo.ts', 'foo.ts');
    expect(buildWindowTitle(f, ws)).toBe('foo.ts');
  });

  it('does not match a workspace that is a prefix without a trailing slash boundary', () => {
    // path = /home/user/project-other/x.ts should NOT match workspace /home/user/project
    const f = file('/home/user/project-other/x.ts', 'x.ts');
    expect(buildWindowTitle(f, ws)).toBe('x.ts');
  });

  it('falls back to name when path is empty', () => {
    const f: ActiveFile = { path: '', name: 'untitled', content: '', isQuipu: false };
    expect(buildWindowTitle(f, ws)).toBe('untitled');
  });
});
