import type { ComponentType } from 'react';
import { registerExtension } from '../registry';
import AgentEditorView from './AgentEditorView';

registerExtension({
  id: 'agent-editor',
  canHandle: (tab) => tab.type === 'agent-editor',
  priority: 90,
  component: AgentEditorView as unknown as ComponentType<Record<string, unknown>>,
});
