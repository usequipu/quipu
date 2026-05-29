import React, { useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { XIcon, CircleIcon, RobotIcon, GearIcon, GitForkIcon } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTab } from '../../context/TabContext';
import type { Pane, Tab } from '../../types/tab';

/**
 * Stable prefix for tab-bar droppable ids. Each pane bar gets one
 * `pane-bar:<paneId>` droppable so a tab can be dropped on the bar's
 * empty trailing area to append to that pane (cross-pane move).
 * Without this, pointerWithin collision detection only matches when
 * the cursor is inside a sortable tab's rect.
 */
export const PANE_BAR_DROPPABLE_PREFIX = 'pane-bar:';
export const paneBarDroppableId = (paneId: string) => `${PANE_BAR_DROPPABLE_PREFIX}${paneId}`;

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
  paneId: string;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onClose: (e: React.MouseEvent<HTMLButtonElement>, id: string) => void;
}

function SortableTab({ tab, paneId, isActive, onSwitch, onClose }: SortableTabProps) {
  // `data.paneId` lets the App-level onDragEnd determine which pane a tab
  // was dragged from / dropped on. Same-pane drag → reorderTabs; different
  // pane → moveTabToPane.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: { paneId },
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
        'cursor-pointer whitespace-nowrap',
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

interface TabBarProps {
  /** When provided, the bar renders only this pane's tabs and uses pane.activeTabId. */
  pane?: Pane;
}

export default function TabBar({ pane }: TabBarProps = {}) {
  const { openTabs, activeTabId, primary, switchTab, closeTab } = useTab();
  const scrollRef = useRef<HTMLDivElement>(null);

  // When a pane is supplied, scope the bar to that pane's tab order; otherwise
  // fall back to all openTabs (single-bar legacy mode).
  const effectivePane = pane ?? primary;

  // Make the entire bar a drop target so a tab dragged onto an empty area of
  // the bar (past the rightmost tab) gets appended to this pane. Without this,
  // pointerWithin collision detection only matches when the cursor is inside
  // a specific sortable tab — empty space drops fail silently.
  const { setNodeRef: setBarDroppableRef } = useDroppable({
    id: paneBarDroppableId(effectivePane.id),
    data: { paneId: effectivePane.id, kind: 'pane-bar' },
  });
  const tabsById = new Map(openTabs.map(t => [t.id, t]));
  const visibleTabs: Tab[] = pane
    ? effectivePane.tabIds.map(id => tabsById.get(id)).filter((t): t is Tab => !!t)
    : (openTabs as Tab[]);
  const isActiveTab = (tabId: string) => pane
    ? effectivePane.activeTabId === tabId
    : tabId === activeTabId;

  const handleClose = useCallback((e: React.MouseEvent<HTMLButtonElement>, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  }, [closeTab]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  // The DndContext lives in App.tsx so drags can cross pane bars (B3).
  // This component only renders a SortableContext scoped to its pane.
  // The same DOM node is also the pane-bar droppable so empty-area drops
  // (past the last tab) get routed to this pane. Declared before any early
  // return so hook order stays stable across re-renders.
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setBarDroppableRef(el);
  }, [setBarDroppableRef]);

  if (visibleTabs.length === 0) return null;

  return (
    <div
      ref={setRefs}
      className="flex h-[35px] bg-bg-surface overflow-x-auto overflow-y-hidden shrink-0 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:bg-border"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onWheel={handleWheel}
      role="tablist"
      data-pane-id={effectivePane.id}
    >
      <SortableContext items={visibleTabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
        {visibleTabs.map((tab: Tab) => (
          <SortableTab
            key={tab.id}
            tab={tab}
            paneId={effectivePane.id}
            isActive={isActiveTab(tab.id)}
            onSwitch={switchTab}
            onClose={handleClose}
          />
        ))}
      </SortableContext>
    </div>
  );
}
