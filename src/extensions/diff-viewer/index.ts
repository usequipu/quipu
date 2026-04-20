import type { ComponentType } from 'react';
import { registerExtension } from '../registry';
import DiffViewer from './DiffViewer';

registerExtension({
  id: 'diff-viewer',
  canHandle: (tab) => tab.type === 'diff',
  priority: 90,
  component: DiffViewer as unknown as ComponentType<Record<string, unknown>>,
});
