import React, { useCallback, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { XIcon, CircleIcon, RobotIcon, GearIcon, GitForkIcon } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTab } from '../../context/TabContext';

interface Tab {
  id: string;
  name: string;
  path: string;
  isDirty: boolean;
  type?: string;
}

function tabTypeIcon(type: string | undefined): { Icon: PhosphorIcon; className: string } | null {
  switch (type) {
    case 'agent': return { Icon: RobotIcon, className: 'text-accent' };
    case 'agent-editor': return { Icon: GearIcon, className: 'text-accent' };
    case 'repo-editor': return { Icon: GitForkIcon, className: 'text-accent' };
    default: return null;
  }
}

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onClose: (e: React.MouseEvent<HTMLButtonElement>, id: string) => void;
}

function SortableTab({ tab, isActive, onSwitch, onClose }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      {...attributes}
      {...listeners}
      data-tab-id={tab.id}
      className={cn(
        'group/tab flex items-center gap-1.5 px-4',
        'cursor-pointer border-r border-border whitespace-nowrap',
        'text-[13px] text-text-primary opacity-70',
        'min-w-[120px] shrink-0 relative select-none',
        'hover:opacity-100 hover:bg-white/[0.04]',
        'transition-opacity',
        isActive && 'opacity-100 bg-page-bg border-b-2 border-b-accent',
      )}
      role="tab"
      aria-selected={isActive}
      onClick={() => onSwitch(tab.id)}
      title={tab.path}
    >
      {(() => {
        const typeIcon = tabTypeIcon(tab.type);
        if (!typeIcon) return null;
        const { Icon, className } = typeIcon;
        return <Icon size={13} weight="regular" className={cn('shrink-0', className)} aria-hidden />;
      })()}
      <span className="overflow-hidden text-ellipsis max-w-[180px] font-sans">
        {tab.name}
      </span>
      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
        {tab.isDirty ? (
          <>
            <CircleIcon
              weight="fill"
              size={8}
              className="text-accent group-hover/tab:hidden"
              aria-label="unsaved changes"
            />
            <button
              className={cn(
                'hidden group-hover/tab:flex items-center justify-center',
                'bg-transparent border-none text-text-primary',
                'cursor-pointer px-0.5 rounded-sm leading-none',
                'opacity-60 hover:!opacity-100 hover:bg-white/10',
              )}
              onClick={(e) => onClose(e, tab.id)}
              aria-label={`Close ${tab.name}`}
            >
              <XIcon size={14} />
            </button>
          </>
        ) : (
          <button
            className={cn(
              'bg-transparent border-none text-text-primary',
              'cursor-pointer px-0.5 rounded-sm leading-none',
              'opacity-0 group-hover/tab:opacity-60',
              'hover:!opacity-100 hover:bg-white/10',
              'transition-opacity',
              isActive && 'opacity-60',
            )}
            onClick={(e) => onClose(e, tab.id)}
            aria-label={`Close ${tab.name}`}
          >
            <XIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function TabBar() {
  const { openTabs, activeTabId, switchTab, closeTab, reorderTabs } = useTab();
  const scrollRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleClose = useCallback((e: React.MouseEvent<HTMLButtonElement>, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  }, [closeTab]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderTabs(String(active.id), String(over.id));
    }
  }, [reorderTabs]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  if (openTabs.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex h-[35px] bg-bg-surface border-b border-border overflow-x-auto overflow-y-hidden shrink-0 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:bg-border"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onWheel={handleWheel}
      role="tablist"
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={openTabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
          {openTabs.map((tab: Tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSwitch={switchTab}
              onClose={handleClose}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
