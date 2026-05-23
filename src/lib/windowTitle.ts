import type { ActiveFile } from '@/types/tab';

export function buildWindowTitle(
  activeFile: ActiveFile | null,
  workspacePath: string | null,
): string {
  if (!activeFile) return 'Quipu';
  const path = activeFile.path;
  if (workspacePath && path && path.startsWith(workspacePath + '/')) {
    return path.slice(workspacePath.length + 1);
  }
  return activeFile.name;
}
