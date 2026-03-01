import React from 'react';
import { FilesIcon, MagnifyingGlassIcon, GitBranchIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';

const PANELS = [
    { id: 'explorer', label: 'Explorer', Icon: FilesIcon },
    { id: 'search', label: 'Search', Icon: MagnifyingGlassIcon },
    { id: 'git', label: 'Source Control', Icon: GitBranchIcon },
];

export default function ActivityBar({ activePanel, onPanelToggle }) {
    const { gitChangeCount } = useWorkspace();

    return (
        <div
            className="flex flex-col items-center w-12 shrink-0 pt-1 bg-bg-surface"
            role="toolbar"
            aria-label="Activity Bar"
        >
            {PANELS.map(panel => {
                const isActive = activePanel === panel.id;
                return (
                    <button
                        key={panel.id}
                        className={cn(
                            "w-12 h-12 flex items-center justify-center",
                            "border-l-3 border-transparent bg-transparent",
                            "cursor-pointer text-text-primary opacity-60",
                            "hover:opacity-100 transition-opacity",
                            isActive && "opacity-100 border-l-accent",
                        )}
                        style={{ WebkitAppRegion: 'no-drag' }}
                        onClick={() => onPanelToggle(panel.id)}
                        aria-label={panel.label}
                        title={panel.label}
                    >
                        <div className="relative">
                            <panel.Icon weight={isActive ? 'regular' : 'light'} size={24} />
                            {panel.id === 'git' && gitChangeCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent text-white text-[10px] font-medium flex items-center justify-center px-1">
                                    {gitChangeCount > 99 ? '99+' : gitChangeCount}
                                </span>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
