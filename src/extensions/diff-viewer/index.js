import DiffViewer from './DiffViewer.jsx';

export default {
  id: 'diff-viewer',
  canHandle(tab) { return tab?._isDiff; },
  priority: 100,
  component: DiffViewer,
};
