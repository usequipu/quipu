import { describe, it, expect } from 'vitest';
import { pickMime, joinText, truncate, OUTPUT_TRUNCATION_LIMIT } from '../extensions/notebook/CellOutput';
import { inferLanguage, joinSource } from '../extensions/notebook/NotebookCell';
import { parseNotebook } from '../extensions/notebook/NotebookViewer';

// ---------------------------------------------------------------------------
// CellOutput — pure logic
// ---------------------------------------------------------------------------

describe('pickMime', () => {
  it('picks text/html over image/png', () => {
    expect(pickMime({ 'text/html': '<b>hi</b>', 'image/png': 'abc' })).toBe('text/html');
  });

  it('picks image/png over text/plain', () => {
    expect(pickMime({ 'image/png': 'abc', 'text/plain': 'hello' })).toBe('image/png');
  });

  it('falls back to text/plain when nothing else matches', () => {
    expect(pickMime({ 'text/plain': 'hello' })).toBe('text/plain');
  });

  it('returns null for empty data dict', () => {
    expect(pickMime({})).toBeNull();
  });

  it('ignores unknown MIME types', () => {
    expect(pickMime({ 'application/vnd.widget+json': 'x' })).toBeNull();
  });
});

describe('joinText', () => {
  it('joins array of strings', () => {
    expect(joinText(['hello ', 'world'])).toBe('hello world');
  });

  it('returns string as-is', () => {
    expect(joinText('hello')).toBe('hello');
  });

  it('returns empty string for null', () => {
    expect(joinText(null)).toBe('');
  });
});

describe('truncate', () => {
  it('returns text unchanged when under limit', () => {
    const result = truncate('short');
    expect(result.text).toBe('short');
    expect(result.truncated).toBe(false);
  });

  it('truncates text over the limit and sets truncated flag', () => {
    const large = 'x'.repeat(OUTPUT_TRUNCATION_LIMIT + 10);
    const result = truncate(large);
    expect(result.text.length).toBe(OUTPUT_TRUNCATION_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it('does not truncate text exactly at limit', () => {
    const exact = 'x'.repeat(OUTPUT_TRUNCATION_LIMIT);
    const result = truncate(exact);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NotebookCell — pure logic
// ---------------------------------------------------------------------------

describe('joinSource', () => {
  it('joins array of source lines', () => {
    expect(joinSource(['a = 1\n', 'b = 2'])).toBe('a = 1\nb = 2');
  });

  it('returns string source unchanged', () => {
    expect(joinSource('hello')).toBe('hello');
  });

  it('returns empty string for null/undefined', () => {
    expect(joinSource(null)).toBe('');
    expect(joinSource(undefined)).toBe('');
  });
});

describe('inferLanguage', () => {
  it('reads from kernelspec', () => {
    const nb = { metadata: { kernelspec: { language: 'python' } } };
    expect(inferLanguage(nb)).toBe('python');
  });

  it('reads from language_info when kernelspec absent', () => {
    const nb = { metadata: { language_info: { name: 'julia' } } };
    expect(inferLanguage(nb)).toBe('julia');
  });

  it('falls back to python', () => {
    expect(inferLanguage({})).toBe('python');
    expect(inferLanguage(null)).toBe('python');
  });
});

// ---------------------------------------------------------------------------
// parseNotebook
// ---------------------------------------------------------------------------

describe('parseNotebook', () => {
  it('parses valid nbformat 4 notebook', () => {
    const nb = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
    const result = parseNotebook(JSON.stringify(nb));
    expect(result.cells).toEqual([]);
    expect(result.nbformat).toBe(4);
  });

  it('normalizes nbformat 3 by extracting cells from worksheets', () => {
    const v3Cell = { cell_type: 'code', input: ['print(1)'], outputs: [], prompt_number: 1 };
    const nb = { nbformat: 3, worksheets: [{ cells: [v3Cell] }] };
    const result = parseNotebook(JSON.stringify(nb));
    expect(result.nbformat).toBe(4);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].source).toEqual(['print(1)']);
    expect(result.cells[0].execution_count).toBe(1);
  });

  it('handles nbformat 3 with no worksheets gracefully', () => {
    const nb = { nbformat: 3 };
    const result = parseNotebook(JSON.stringify(nb));
    expect(result.cells).toEqual([]);
  });

  it('does not alter notebooks with worksheets key but nbformat 4', () => {
    const nb = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {}, worksheets: null };
    const result = parseNotebook(JSON.stringify(nb));
    expect(result.nbformat).toBe(4);
    expect(result.cells).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseNotebook('{not valid json')).toThrow();
  });

  it('returns cells array from notebook', () => {
    const cell = { cell_type: 'code', source: ['print(1)'], outputs: [], execution_count: 1 };
    const nb = { nbformat: 4, nbformat_minor: 5, cells: [cell], metadata: {} };
    const result = parseNotebook(JSON.stringify(nb));
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].cell_type).toBe('code');
  });

  it('handles empty cells array without crash', () => {
    const nb = { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} };
    expect(() => parseNotebook(JSON.stringify(nb))).not.toThrow();
  });
});
