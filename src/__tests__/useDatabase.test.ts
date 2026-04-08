import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDatabase } from '../extensions/database-viewer/hooks/useDatabase';
import { parseQuipuDb, serializeQuipuDb } from '../extensions/database-viewer/utils/jsonl';
import type { ColumnDef } from '../extensions/database-viewer/types';

const SAMPLE_CONTENT = [
  '{"_schema":{"version":1,"name":"Tasks","columns":[{"id":"title","name":"Title","type":"text"},{"id":"done","name":"Done","type":"checkbox"}],"views":[{"id":"v1","name":"Table","type":"table","filters":[],"sorts":[],"columnWidths":{}}]}}',
  '{"_id":"r1","title":"First task","done":false}',
  '{"_id":"r2","title":"Second task","done":true}',
].join('\n');

describe('useDatabase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with valid JSONL content', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );
    expect(result.current.schema.name).toBe('Tasks');
    expect(result.current.schema.columns).toHaveLength(2);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].title).toBe('First task');
  });

  it('initializes empty database for null content', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDatabase({ content: null, onContentChange: onChange })
    );
    expect(result.current.schema.name).toBe('Untitled Database');
    expect(result.current.rows).toHaveLength(0);
  });

  it('addRow appends a new row with null values for each column', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT, onContentChange: onChange })
    );

    act(() => {
      result.current.addRow();
    });

    expect(result.current.rows).toHaveLength(3);
    const newRow = result.current.rows[2];
    expect(newRow._id).toBeTruthy();
    expect(newRow.title).toBeNull();
    expect(newRow.done).toBe(false); // checkbox defaults to false
  });

  it('updateCell updates the correct cell and triggers debounced onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT, onContentChange: onChange })
    );

    act(() => {
      result.current.updateCell('r1', 'title', 'Updated Title');
    });

    expect(result.current.rows[0].title).toBe('Updated Title');

    // onChange should not be called immediately (debounced)
    expect(onChange).not.toHaveBeenCalled();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const serialized = onChange.mock.calls[0][0] as string;
    expect(serialized).toContain('Updated Title');
  });

  it('deleteRow removes the row', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );

    act(() => {
      result.current.deleteRow('r1');
    });

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]._id).toBe('r2');
  });

  it('reorderRows moves a row to a new position', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );

    act(() => {
      result.current.reorderRows(0, 1);
    });

    expect(result.current.rows[0]._id).toBe('r2');
    expect(result.current.rows[1]._id).toBe('r1');
  });

  it('addColumn adds to schema and initializes null on all rows', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );

    const newCol: ColumnDef = { id: 'priority', name: 'Priority', type: 'number' };

    act(() => {
      result.current.addColumn(newCol);
    });

    expect(result.current.schema.columns).toHaveLength(3);
    expect(result.current.schema.columns[2].id).toBe('priority');
    expect(result.current.rows[0].priority).toBeNull();
    expect(result.current.rows[1].priority).toBeNull();
  });

  it('removeColumn removes from schema and deletes key from all rows', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );

    act(() => {
      result.current.removeColumn('done');
    });

    expect(result.current.schema.columns).toHaveLength(1);
    expect(result.current.rows[0]).not.toHaveProperty('done');
    expect(result.current.rows[1]).not.toHaveProperty('done');
  });

  it('renameColumn updates schema name but leaves row data unchanged', () => {
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT })
    );

    act(() => {
      result.current.renameColumn('title', 'Task Name');
    });

    expect(result.current.schema.columns[0].name).toBe('Task Name');
    expect(result.current.schema.columns[0].id).toBe('title'); // ID unchanged
    expect(result.current.rows[0].title).toBe('First task'); // data unchanged
  });

  it('changeColumnType converts values best-effort', () => {
    const content = [
      '{"_schema":{"version":1,"name":"Test","columns":[{"id":"val","name":"Value","type":"text"}],"views":[]}}',
      '{"_id":"r1","val":"42"}',
      '{"_id":"r2","val":"not a number"}',
    ].join('\n');

    const { result } = renderHook(() =>
      useDatabase({ content })
    );

    act(() => {
      result.current.changeColumnType('val', 'number');
    });

    expect(result.current.rows[0].val).toBe(42);
    expect(result.current.rows[1].val).toBeNull(); // non-numeric -> null
  });

  it('re-parses when content prop changes', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useDatabase({ content }),
      { initialProps: { content: SAMPLE_CONTENT } }
    );

    expect(result.current.rows).toHaveLength(2);

    const newContent = [
      '{"_schema":{"version":1,"name":"Updated","columns":[],"views":[]}}',
      '{"_id":"r1","x":1}',
    ].join('\n');

    rerender({ content: newContent });

    expect(result.current.schema.name).toBe('Updated');
    expect(result.current.rows).toHaveLength(1);
  });

  it('updateViewConfig uses longer debounce for view changes', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDatabase({ content: SAMPLE_CONTENT, onContentChange: onChange })
    );

    act(() => {
      result.current.updateViewConfig('v1', { sorts: [{ columnId: 'title', direction: 'asc' }] });
    });

    // Should not fire at 500ms (data debounce)
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onChange).not.toHaveBeenCalled();

    // Should fire at 2000ms (view debounce)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
