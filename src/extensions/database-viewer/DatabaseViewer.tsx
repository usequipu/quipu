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
  mode?: 'standalone' | 'inline';
}

const DatabaseViewer: React.FC<DatabaseViewerProps> = ({ activeFile, onContentChange, content: directContent, mode = 'standalone' }) => {
  const content = directContent !== undefined ? directContent : (typeof activeFile?.content === 'string' ? activeFile.content : null);
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

  return (
    <div className={cn(
      'flex flex-col bg-page-bg overflow-hidden',
      mode === 'standalone' ? 'flex-1' : 'max-h-[400px]',
    )}>
      {/* Header — standalone only */}
      {mode === 'standalone' && (
        <div className="shrink-0 pt-10 pb-2 px-10">
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

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 py-1.5 border-b border-border/30 px-10">
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
            deleteRow={deleteRow}
            renameColumn={renameColumn}
            removeColumn={removeColumn}
            changeColumnType={changeColumnType}
            onAddColumn={() => setIsAddColumnOpen(true)}
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
