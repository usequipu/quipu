/**
 * Extension loader — registers built-in viewer extensions that remain in core.
 * Heavy viewers (pdf, code, mermaid, excalidraw, media, notebook) are now
 * distributed as separate plugins via the plugin system.
 */
import { registerExtension } from './registry';
import type { ExtensionDescriptor } from '@/types/extensions';

// diff-viewer stays in core (registered as side-effect for tab.type === 'diff').
import './diff-viewer/index';

// agent viewers stay in core — they couple to Electron IPC for subprocess management.
import './agent-chat/index';
import './agent-editor/index';
import './repo-editor/index';

// database-viewer stays in core permanently (see plugin architecture plan §Key Decisions).
import databaseViewer from './database-viewer';

const viewers: ExtensionDescriptor[] = [databaseViewer];
viewers.forEach(registerExtension);
