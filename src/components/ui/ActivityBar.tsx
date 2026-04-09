import React from 'react';
import { FilesIcon, MagnifyingGlassIcon, GitBranchIcon } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useFileSystem } from '../../context/FileSystemContext';

type PanelId = 'explorer' | 'search' | 'git';

interface PanelDef {
    id: PanelId;
    label: string;
    Icon: PhosphorIcon;
}

interface ActivityBarProps {
    activePanel: PanelId | null;
    onPanelToggle: (panelId: PanelId) => void;
}

const PANELS: PanelDef[] = [
    { id: 'explorer', label: 'Explorer', Icon: FilesIcon },
    { id: 'search', label: 'Search', Icon: MagnifyingGlassIcon },
    { id: 'git', label: 'Source Control', Icon: GitBranchIcon },
];

export default function ActivityBar({ activePanel, onPanelToggle }: ActivityBarProps) {
    const { gitChangeCount } = useFileSystem();

    return (
        <div
            className="flex flex-col items-center w-12 shrink-0 pt-1 bg-activity-bar rounded-r-2xl"
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
                            "cursor-pointer text-activity-bar-text",
                            "hover:text-activity-bar-active transition-colors",
                            isActive && "text-activity-bar-active border-l-activity-bar-active",
                        )}
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        onClick={() => onPanelToggle(panel.id)}
                        aria-label={panel.label}
                        title={panel.label}
                    >
                        <div className="relative">
                            <panel.Icon weight={isActive ? 'regular' : 'light'} size={24} />
                            {panel.id === 'git' && gitChangeCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-white/90 text-activity-bar text-[10px] font-bold flex items-center justify-center px-1">
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
