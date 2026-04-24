import type { ComponentType } from 'react';
import { registerExtension } from '../registry';
import ChatView from './ChatView';

registerExtension({
  id: 'agent-chat',
  canHandle: (tab) => tab.type === 'agent',
  priority: 90,
  component: ChatView as unknown as ComponentType<Record<string, unknown>>,
});
