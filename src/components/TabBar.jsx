import React, { useCallback } from 'react';
import { XIcon, CircleIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../context/WorkspaceContext';

export default function TabBar() {
    const { openTabs, activeTabId, switchTab, closeTab } = useWorkspace();

    const handleClose = useCallback((e, tabId) => {
        e.stopPropagation();
        closeTab(tabId);
    }, [closeTab]);

    if (openTabs.length === 0) return null;

    return (
        <div
            className="flex h-[35px] bg-bg-surface border-b border-border overflow-x-auto overflow-y-hidden shrink-0 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:bg-border"
            style={{ WebkitAppRegion: 'drag' }}
            role="tablist"
        >
            {openTabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        className={cn(
                            "group flex items-center gap-1.5 px-3",
                            "cursor-pointer border-r border-border whitespace-nowrap",
                            "text-[13px] text-text-primary opacity-70",
                            "min-w-0 shrink-0 relative",
                            "hover:opacity-100 hover:bg-white/[0.04]",
                            "transition-opacity",
                            isActive && "opacity-100 bg-page-bg border-b-2 border-b-accent",
                        )}
                        style={{ WebkitAppRegion: 'no-drag' }}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => switchTab(tab.id)}
                        title={tab.path}
                    >
                        <span className="overflow-hidden text-ellipsis max-w-[150px] font-sans">
                            {tab.name}
                        </span>
                        {tab.isDirty && (
                            <CircleIcon
                                weight="fill"
                                size={8}
                                className="shrink-0 text-accent"
                                aria-label="unsaved changes"
                            />
                        )}
                        <button
                            className={cn(
                                "bg-transparent border-none text-text-primary",
                                "cursor-pointer px-0.5 rounded-sm leading-none shrink-0",
                                "opacity-0 group-hover:opacity-60",
                                "hover:!opacity-100 hover:bg-white/10",
                                "transition-opacity",
                                isActive && "opacity-60",
                            )}
                            onClick={(e) => handleClose(e, tab.id)}
                            aria-label={`Close ${tab.name}`}
                        >
                            <XIcon size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
