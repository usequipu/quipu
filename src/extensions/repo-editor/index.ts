import type { ComponentType } from 'react';
import { registerExtension } from '../registry';
import RepoEditorView from './RepoEditorView';

registerExtension({
  id: 'repo-editor',
  canHandle: (tab) => tab.type === 'repo-editor',
  priority: 90,
  component: RepoEditorView as unknown as ComponentType<Record<string, unknown>>,
});
