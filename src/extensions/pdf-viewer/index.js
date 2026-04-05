import PdfViewer from './PdfViewer.jsx';

export default {
  id: 'pdf-viewer',
  canHandle(tab) { return tab?.isPdf; },
  priority: 10,
  component: PdfViewer,
};
