import { isCodeFile } from '@/utils/fileTypes';
import CodeViewer from './CodeViewer.jsx';

export default {
  id: 'code-viewer',
  canHandle(tab, activeFile) {
    return isCodeFile(activeFile?.name) && !activeFile?.isQuipu;
  },
  priority: 5,
  component: CodeViewer,
};
