import React, { useState, useMemo, useCallback } from 'react';
import { Tabs } from 'radix-ui';
import { Table, SquaresFour } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useDatabase } from './hooks/useDatabase';
import { useDatabaseFilters } from './hooks/useDatabaseFilters';
import TableView from './components/TableView';
import BoardView from './components/BoardView';
import FilterBar from './components/FilterBar';
import { AddColumnDialog } from './components/ColumnManager';
import type { Tab as TabType, ActiveFile } from '@/types/tab';
import type { ColumnDef, FilterDef, SortDef, ViewConfig } from './types';

export interface DatabaseViewerProps {
  tab?: TabType;
  activeFile?: ActiveFile;
  content?: string | null;
  onContentChange?: (content: string) => void;
  isActive?: boolean;
  /**
   * - `standalone`: full editor surface (title, toolbar, view switcher).
   * - `inline`: embedded inside a markdown document.
   * - `chat`: read-only card for the agent-chat surface — no header, no
   *   toolbar, no cell editing, max-height with internal scroll.
   */
  mode?: 'standalone' | 'inline' | 'chat';
  /**
   * Full path to the .quipudb.jsonl file backing this view. Required for
   * link columns (relative-mode resolution + create-new-file). Optional in
   * standalone mode because activeFile.path is used as a fallback. Inline
   * mode passes this explicitly from the EmbeddedDatabase node.
   */
  databaseFilePath?: string | null;
}

/**
 * Read the workspace path from the DOM marker the app root already sets.
 * Lets the viewer work whether it's mounted inside the app's React tree
 * (standalone tab — provider available) or inside a TipTap node-view
 * React root (inline embed — no provider). Falls back to null if the
 * marker isn't present.
 */
function getWorkspacePathFromDOM(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-workspace-path]') as HTMLElement | null;
  return el?.dataset.workspacePath ?? null;
}

const DatabaseViewer: React.FC<DatabaseViewerProps> = ({
  activeFile,
  onContentChange,
  content: directContent,
  mode = 'standalone',
  databaseFilePath,
}) => {
  const workspacePath = getWorkspacePathFromDOM();
  const content = directContent !== undefined ? directContent : (typeof activeFile?.content === 'string' ? activeFile.content : null);
  const resolvedDatabasePath = databaseFilePath ?? activeFile?.path ?? null;
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);

  const {
    schema,
    rows,
    addRow,
    updateCell,
    deleteRow,
    reorderRows,
    addColumn,
    removeColumn,
    renameColumn,
    changeColumnType,
    setColumnWrap,
    updateColumnOptions,
    updateViewConfig,
  } = useDatabase({ content, onContentChange });

  // Active view: default to first view in schema
  const [activeViewId, setActiveViewId] = useState<string>(
    () => schema.views[0]?.id ?? 'default-table',
  );

  const activeView: ViewConfig | undefined = useMemo(
    () => schema.views.find(v => v.id === activeViewId) ?? schema.views[0],
    [schema.views, activeViewId],
  );

  // Filter and sort rows through our hook
  const filteredRows = useDatabaseFilters({
    rows,
    columns: schema.columns,
    filters: activeView?.filters ?? [],
    sorts: activeView?.sorts ?? [],
  });

  const handleViewChange = useCallback((value: string) => {
    setActiveViewId(value);
  }, []);

  const handleFiltersChange = useCallback(
    (filters: FilterDef[]) => {
      if (activeView) {
        updateViewConfig(activeView.id, { filters });
      }
    },
    [activeView, updateViewConfig],
  );

  const handleSortsChange = useCallback(
    (sorts: SortDef[]) => {
      if (activeView) {
        updateViewConfig(activeView.id, { sorts });
      }
    },
    [activeView, updateViewConfig],
  );

  const handleAddColumn = useCallback((colDef: ColumnDef) => {
    addColumn(colDef);
  }, [addColumn]);

  const isChat = mode === 'chat';
  // Inline + chat modes live inside another container (the embed wrapper
  // or the chat card) that already provides horizontal alignment. Only
  // the standalone viewer applies the --db-h-pad token internally.
  const innerPadding = mode === 'standalone' ? 'var(--db-h-pad)' : '0';

  return (
    <div className={cn(
      'flex flex-col bg-page-bg overflow-hidden',
      mode === 'standalone' && 'flex-1',
      // Inline mode is hosted inside a TipTap block (display: block, no
      // parent flex height). Without min-h the inner flex-1 view content
      // resolves to 0 and the embed collapses to just the toolbar.
      mode === 'inline' && 'min-h-[280px] max-h-[400px]',
      isChat && 'min-h-[280px] max-h-[360px] rounded-md border border-border bg-bg-surface',
    )}>
      {/* Header — standalone only */}
      {mode === 'standalone' && (
        <div className="shrink-0 pt-10 pb-2" style={{ paddingInline: 'var(--db-h-pad)' }}>
          <h1 className="text-2xl font-bold text-page-text mb-1">{schema.name}</h1>
          <div className="flex items-center gap-3 text-xs text-page-text/50">
            <span>
              {filteredRows.length === rows.length
                ? `${rows.length} row${rows.length !== 1 ? 's' : ''}`
                : `${filteredRows.length} of ${rows.length} row${rows.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </div>
      )}

      {/* Toolbar — hidden in chat mode (read-only) */}
      {!isChat && (
      <div
        className="shrink-0 flex items-center gap-2 py-1.5 border-b border-border/30"
        style={{ paddingInline: innerPadding }}
      >
        <FilterBar
          columns={schema.columns}
          filters={activeView?.filters ?? []}
          sorts={activeView?.sorts ?? []}
          onFiltersChange={handleFiltersChange}
          onSortsChange={handleSortsChange}
        />

        <div className="ml-auto">
          <Tabs.Root value={activeViewId} onValueChange={handleViewChange}>
            <Tabs.List className="flex items-center gap-0.5 bg-bg-surface rounded-md p-0.5 border border-border/50">
              {schema.views.map(view => (
                <Tabs.Trigger
                  key={view.id}
                  value={view.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                    'text-text-tertiary hover:text-text-secondary',
                    'data-[state=active]:bg-bg-elevated data-[state=active]:text-text-primary data-[state=active]:shadow-sm',
                  )}
                >
                  {view.type === 'table' ? (
                    <Table size={14} weight="bold" />
                  ) : (
                    <SquaresFour size={14} weight="bold" />
                  )}
                  {view.name}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
        </div>
      </div>
      )}

      {/* View content — full width */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeView?.type === 'board' ? (
          <BoardView
            schema={schema}
            rows={filteredRows}
            viewConfig={activeView}
            updateCell={updateCell}
            addRow={addRow}
            reorderRows={reorderRows}
            updateViewConfig={updateViewConfig}
          />
        ) : (
          <TableView
            schema={schema}
            rows={filteredRows}
            updateCell={updateCell}
            addRow={addRow}
            deleteRow={isChat ? undefined : deleteRow}
            renameColumn={isChat ? undefined : renameColumn}
            removeColumn={isChat ? undefined : removeColumn}
            changeColumnType={isChat ? undefined : changeColumnType}
            setColumnWrap={isChat ? undefined : setColumnWrap}
            updateColumnOptions={isChat ? undefined : updateColumnOptions}
            onAddColumn={isChat ? undefined : () => setIsAddColumnOpen(true)}
            databaseFilePath={resolvedDatabasePath}
            workspacePath={workspacePath}
            readOnly={isChat}
            outerPaddingInline={innerPadding}
            view={activeView}
            updateViewConfig={isChat ? undefined : updateViewConfig}
          />
        )}
      </div>

      <AddColumnDialog
        isOpen={isAddColumnOpen}
        onClose={() => setIsAddColumnOpen(false)}
        onAdd={handleAddColumn}
        existingIds={schema.columns.map(c => c.id)}
      />
    </div>
  );
};

export default DatabaseViewer;
