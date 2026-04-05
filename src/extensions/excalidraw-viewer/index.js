import { isExcalidrawFile } from '@/utils/fileTypes';
import ExcalidrawViewer from './ExcalidrawViewer.jsx';

export default {
  id: 'excalidraw-viewer',
  canHandle(tab, activeFile) { return isExcalidrawFile(activeFile?.name); },
  priority: 10,
  component: ExcalidrawViewer,
};
