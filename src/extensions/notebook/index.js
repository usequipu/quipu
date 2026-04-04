import { isNotebookFile } from '@/utils/fileTypes';
import NotebookViewer from './NotebookViewer.jsx';

export default {
  id: 'notebook-viewer',
  canHandle(tab, activeFile) { return isNotebookFile(activeFile?.name); },
  priority: 10,
  component: NotebookViewer,
};
