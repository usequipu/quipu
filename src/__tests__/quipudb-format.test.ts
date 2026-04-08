import { describe, it, expect } from 'vitest';
import { parseQuipuDb, serializeQuipuDb, createEmptyDatabase } from '../extensions/database-viewer/utils/jsonl';
import { generateRowId } from '../extensions/database-viewer/utils/id';

const VALID_JSONL = [
  '{"_schema":{"version":1,"name":"Tasks","columns":[{"id":"title","name":"Title","type":"text"},{"id":"status","name":"Status","type":"select","options":[{"value":"Todo","color":"#6366f1"},{"value":"Done","color":"#22c55e"}]},{"id":"due","name":"Due Date","type":"date"}],"views":[{"id":"v1","name":"Table","type":"table","filters":[],"sorts":[],"columnWidths":{}}]}}',
  '{"_id":"r1","title":"Ship v1","status":"Todo","due":"2026-04-15"}',
  '{"_id":"r2","title":"Write docs","status":"Done","due":"2026-04-10"}',
  '{"_id":"r3","title":"Add tests","status":"Todo","due":null}',
].join('\n');

describe('parseQuipuDb', () => {
  it('parses a valid 3-row JSONL string', () => {
    const { schema, rows } = parseQuipuDb(VALID_JSONL);
    expect(schema.name).toBe('Tasks');
    expect(schema.columns).toHaveLength(3);
    expect(schema.version).toBe(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]._id).toBe('r1');
    expect(rows[0].title).toBe('Ship v1');
    expect(rows[1].status).toBe('Done');
    expect(rows[2].due).toBeNull();
  });

  it('parses file with only schema line (no rows)', () => {
    const content = '{"_schema":{"version":1,"name":"Empty","columns":[],"views":[]}}';
    const { schema, rows } = parseQuipuDb(content);
    expect(schema.name).toBe('Empty');
    expect(rows).toHaveLength(0);
  });

  it('skips empty lines between rows', () => {
    const content = [
      '{"_schema":{"version":1,"name":"Test","columns":[],"views":[]}}',
      '',
      '{"_id":"r1","val":"a"}',
      '',
      '{"_id":"r2","val":"b"}',
      '',
    ].join('\n');
    const { rows } = parseQuipuDb(content);
    expect(rows).toHaveLength(2);
  });

  it('throws on empty string', () => {
    expect(() => parseQuipuDb('')).toThrow('Cannot parse empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseQuipuDb('   \n  \n  ')).toThrow('Cannot parse empty');
  });

  it('throws with line number on malformed data row', () => {
    const content = [
      '{"_schema":{"version":1,"name":"Test","columns":[],"views":[]}}',
      '{"_id":"r1","val":"ok"}',
      '{bad json}',
    ].join('\n');
    expect(() => parseQuipuDb(content)).toThrow('Line 3');
  });

  it('throws on malformed schema line', () => {
    expect(() => parseQuipuDb('{bad json}')).toThrow('Line 1');
  });

  it('throws when first line has no _schema key', () => {
    expect(() => parseQuipuDb('{"data":"not a schema"}')).toThrow('Missing _schema');
  });

  it('generates _id for rows missing it', () => {
    const content = [
      '{"_schema":{"version":1,"name":"Test","columns":[],"views":[]}}',
      '{"val":"no id here"}',
    ].join('\n');
    const { rows } = parseQuipuDb(content);
    expect(rows[0]._id).toBeTruthy();
    expect(typeof rows[0]._id).toBe('string');
  });

  it('fills in defaults for missing schema fields', () => {
    const content = '{"_schema":{}}';
    const { schema } = parseQuipuDb(content);
    expect(schema.version).toBe(1);
    expect(schema.name).toBe('Untitled Database');
    expect(schema.columns).toEqual([]);
    expect(schema.views).toHaveLength(1);
    expect(schema.views[0].type).toBe('table');
  });
});

describe('serializeQuipuDb', () => {
  it('produces valid JSONL with trailing newline', () => {
    const { schema, rows } = parseQuipuDb(VALID_JSONL);
    const serialized = serializeQuipuDb(schema, rows);
    expect(serialized.endsWith('\n')).toBe(true);
    const lines = serialized.trim().split('\n');
    expect(lines).toHaveLength(4); // 1 schema + 3 rows
  });

  it('round-trips parse -> serialize -> parse identically', () => {
    const original = parseQuipuDb(VALID_JSONL);
    const serialized = serializeQuipuDb(original.schema, original.rows);
    const reparsed = parseQuipuDb(serialized);
    expect(reparsed.schema).toEqual(original.schema);
    expect(reparsed.rows).toEqual(original.rows);
  });

  it('serializes empty rows array with schema only', () => {
    const schema = parseQuipuDb(VALID_JSONL).schema;
    const serialized = serializeQuipuDb(schema, []);
    const lines = serialized.trim().split('\n');
    expect(lines).toHaveLength(1); // schema only
  });
});

describe('createEmptyDatabase', () => {
  it('creates valid JSONL with schema line and no data', () => {
    const content = createEmptyDatabase('My Tasks');
    const { schema, rows } = parseQuipuDb(content);
    expect(schema.name).toBe('My Tasks');
    expect(schema.version).toBe(1);
    expect(schema.columns).toEqual([]);
    expect(schema.views).toHaveLength(2); // table + board
    expect(schema.views[0].type).toBe('table');
    expect(schema.views[1].type).toBe('board');
    expect(rows).toHaveLength(0);
  });
});

describe('generateRowId', () => {
  it('produces an 8-character string', () => {
    const id = generateRowId();
    expect(id).toHaveLength(8);
    expect(typeof id).toBe('string');
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRowId()));
    expect(ids.size).toBe(100);
  });
});
