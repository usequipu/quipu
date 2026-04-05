import { isMermaidFile } from '@/utils/fileTypes';
import MermaidViewer from './MermaidViewer.jsx';

export default {
  id: 'mermaid-viewer',
  canHandle(tab, activeFile) { return isMermaidFile(activeFile?.name); },
  priority: 10,
  component: MermaidViewer,
};
