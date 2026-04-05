import MediaViewer from './MediaViewer.jsx';

export default {
  id: 'media-viewer',
  canHandle(tab) { return tab?.isMedia; },
  priority: 10,
  component: MediaViewer,
};
