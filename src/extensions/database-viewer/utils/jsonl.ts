import type { DatabaseSchema, DatabaseRow, ParsedDatabase, SchemaLine } from '../types';
import { generateRowId } from './id';

/**
 * Parse a .quipudb.jsonl file content string into schema + rows.
 * First line must be a schema object with `_schema` key.
 * Subsequent lines are data rows with `_id` and column values.
 */
export function parseQuipuDb(content: string): ParsedDatabase {
  if (!content || !content.trim()) {
    throw new Error('Cannot parse empty .quipudb.jsonl file');
  }

  const lines = content.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('Cannot parse empty .quipudb.jsonl file');
  }

  // Parse schema (first line)
  let schemaLine: SchemaLine;
  try {
    schemaLine = JSON.parse(lines[0]) as SchemaLine;
  } catch {
    throw new Error('Line 1: Invalid JSON in schema line');
  }

  if (!schemaLine._schema) {
    throw new Error('Line 1: Missing _schema key — first line must be the database schema');
  }

  const schema = schemaLine._schema;

  // Ensure schema has required fields
  if (!schema.version) schema.version = 1;
  if (!schema.name) schema.name = 'Untitled Database';
  if (!Array.isArray(schema.columns)) schema.columns = [];
  if (!Array.isArray(schema.views)) {
    schema.views = [{
      id: 'default-table',
      name: 'Table',
      type: 'table',
      filters: [],
      sorts: [],
      columnWidths: {},
    }];
  }

  // Parse data rows (remaining lines)
  const rows: DatabaseRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    let row: DatabaseRow;
    try {
      row = JSON.parse(lines[i]) as DatabaseRow;
    } catch {
      throw new Error(`Line ${i + 1}: Invalid JSON in data row`);
    }

    // Ensure row has an ID
    if (!row._id) {
      row._id = generateRowId();
    }

    rows.push(row);
  }

  return { schema, rows };
}

/**
 * Serialize a database (schema + rows) back to .quipudb.jsonl format.
 * Produces one JSON object per line, with a trailing newline for POSIX compatibility.
 */
export function serializeQuipuDb(schema: DatabaseSchema, rows: DatabaseRow[]): string {
  const schemaLine: SchemaLine = { _schema: schema };
  const lines = [
    JSON.stringify(schemaLine),
    ...rows.map(row => JSON.stringify(row)),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Create a new empty database with the given name.
 * Returns a serialized .quipudb.jsonl string with schema only (no rows).
 */
export function createEmptyDatabase(name: string): string {
  const schema: DatabaseSchema = {
    version: 1,
    name,
    columns: [],
    views: [
      {
        id: 'default-table',
        name: 'Table',
        type: 'table',
        filters: [],
        sorts: [],
        columnWidths: {},
      },
      {
        id: 'default-board',
        name: 'Board',
        type: 'board',
        filters: [],
        sorts: [],
        columnWidths: {},
      },
    ],
  };

  return serializeQuipuDb(schema, []);
}
