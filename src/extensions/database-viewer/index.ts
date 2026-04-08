import type { ExtensionDescriptor } from '@/types/extensions';
import DatabaseViewer from './DatabaseViewer';

const descriptor: ExtensionDescriptor = {
  id: 'database-viewer',
  canHandle(tab) {
    return tab.name.endsWith('.quipudb.jsonl');
  },
  priority: 10,
  component: DatabaseViewer,
  onSave: async (tab) => {
    return typeof tab.content === 'string' ? tab.content : null;
  },
};

export default descriptor;
