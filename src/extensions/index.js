/**
 * Extension loader — imports all built-in viewer extensions and registers them.
 * This is the ONLY file that imports from individual extension folders.
 * Import this module once at app startup (side-effect import).
 */
import { registerExtension } from './registry';

import pdfViewer from './pdf-viewer';
import mediaViewer from './media-viewer';
import excalidrawViewer from './excalidraw-viewer';
import mermaidViewer from './mermaid-viewer';
import notebookViewer from './notebook';
import codeViewer from './code-viewer';

[pdfViewer, mediaViewer, excalidrawViewer, mermaidViewer, notebookViewer, codeViewer]
  .forEach(registerExtension);
