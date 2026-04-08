import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { parseQuipuDb } from './utils/jsonl';
import type { Tab, ActiveFile } from '@/types/tab';

export interface DatabaseViewerProps {
  tab: Tab;
  activeFile: ActiveFile;
  onContentChange?: (content: string) => void;
  isActive?: boolean;
}

const DatabaseViewer: React.FC<DatabaseViewerProps> = ({ tab, activeFile, onContentChange }) => {
  const content = typeof activeFile.content === 'string' ? activeFile.content : '';

  const parsed = useMemo(() => {
    if (!content) return null;
    try {
      return parseQuipuDb(content);
    } catch {
      return null;
    }
  }, [content]);

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base text-text-tertiary">
        <p>Empty database — add columns and rows to get started.</p>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-base text-error">
        <p>Failed to parse database file.</p>
      </div>
    );
  }

  const { schema, rows } = parsed;

  return (
    <div className="flex-1 flex flex-col bg-bg-base overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-sm font-medium text-text-primary">{schema.name}</span>
        <span className="text-xs text-text-tertiary">
          {rows.length} row{rows.length !== 1 ? 's' : ''} &middot; {schema.columns.length} column{schema.columns.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table placeholder */}
      <div className="flex-1 overflow-auto p-4">
        {schema.columns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
            No columns defined. Column management coming soon.
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {schema.columns.map(col => (
                  <th
                    key={col.id}
                    className="text-left px-3 py-2 text-text-secondary font-medium text-xs uppercase tracking-wide"
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} className="border-b border-border/50 hover:bg-bg-surface/50">
                  {schema.columns.map(col => (
                    <td key={col.id} className="px-3 py-2 text-text-primary">
                      {String(row[col.id] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default DatabaseViewer;
