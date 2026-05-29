import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  defaultSizeForType,
  useColumnDefs,
} from '../extensions/database-viewer/hooks/useColumnDefs';
import type {
  ColumnDef as DbColumnDef,
  DatabaseSchema,
} from '../extensions/database-viewer/types';

describe('defaultSizeForType', () => {
  it('returns the documented per-type defaults', () => {
    expect(defaultSizeForType('checkbox')).toBe(60);
    expect(defaultSizeForType('number')).toBe(100);
    expect(defaultSizeForType('date')).toBe(140);
    expect(defaultSizeForType('select')).toBe(160);
    expect(defaultSizeForType('multi-select')).toBe(200);
    expect(defaultSizeForType('text')).toBe(240);
    expect(defaultSizeForType('link')).toBe(240);
  });
});

describe('useColumnDefs', () => {
  const columns: DbColumnDef[] = [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'count', name: 'Count', type: 'number' },
    { id: 'done', name: 'Done', type: 'checkbox' },
  ];
  const schema: DatabaseSchema = {
    version: 1,
    name: 'Test',
    columns,
    views: [],
  };

  it('uses per-type defaults when no saved widths are passed', () => {
    const { result } = renderHook(() => useColumnDefs(schema));
    const sizes = result.current.map(c => c.size);
    expect(sizes).toEqual([240, 100, 60]);
  });

  it('lets saved widths override per-type defaults', () => {
    const { result } = renderHook(() =>
      useColumnDefs(schema, { title: 400, done: 90 }),
    );
    const sizes = result.current.map(c => c.size);
    expect(sizes).toEqual([400, 100, 90]);
  });

  it('raises maxSize cap to 800 so text columns can be dragged wider', () => {
    const { result } = renderHook(() => useColumnDefs(schema));
    expect(result.current[0].maxSize).toBe(800);
    expect(result.current[0].minSize).toBe(80);
  });
});
