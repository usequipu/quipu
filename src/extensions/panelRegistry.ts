import type { ComponentType } from 'react';
import type { PanelDescriptor } from '../types/plugin-types';
import FileExplorer from '../components/ui/FileExplorer';
import SearchPanel from '../components/ui/SearchPanel';
import SourceControlPanel from '../components/ui/SourceControlPanel';
import PluginManager from '../components/ui/PluginManager';
import AgentsPanel from '../components/ui/AgentsPanel';
import ReposPanel from '../components/ui/ReposPanel';

// ---------------------------------------------------------------------------
// Git badge count — written each render by ActivityBar before reading panels
// ---------------------------------------------------------------------------

let _gitBadgeCount = 0;

export function updateGitBadgeCount(count: number): void {
  _gitBadgeCount = count;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _panels: PanelDescriptor[] = [];

export function registerPanel(descriptor: PanelDescriptor): void {
  const existing = _panels.findIndex((p) => p.id === descriptor.id);
  if (existing !== -1) {
    _panels[existing] = descriptor;
  } else {
    _panels.push(descriptor);
  }
  _panels.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getRegisteredPanels(): readonly PanelDescriptor[] {
  return _panels;
}

// ---------------------------------------------------------------------------
// Built-in panel registrations
// ---------------------------------------------------------------------------

registerPanel({
  id: 'explorer',
  label: 'Explorer',
  icon: 'FilesIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: FileExplorer as unknown as ComponentType<any>,
  order: 0,
});

registerPanel({
  id: 'search',
  label: 'Search',
  icon: 'MagnifyingGlassIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: SearchPanel as unknown as ComponentType<any>,
  order: 1,
});

registerPanel({
  id: 'git',
  label: 'Source Control',
  icon: 'GitBranchIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: SourceControlPanel as unknown as ComponentType<any>,
  order: 2,
  badge: () => (_gitBadgeCount > 0 ? _gitBadgeCount : null),
});

registerPanel({
  id: 'agents',
  label: 'Agents',
  icon: 'RobotIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: AgentsPanel as unknown as ComponentType<any>,
  order: 10,
});

registerPanel({
  id: 'repos',
  label: 'Repos',
  icon: 'GitForkIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ReposPanel as unknown as ComponentType<any>,
  order: 11,
});

registerPanel({
  id: 'plugin-manager',
  label: 'Plugins',
  icon: 'PuzzlePieceIcon',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: PluginManager as unknown as ComponentType<any>,
  order: 99,
});
