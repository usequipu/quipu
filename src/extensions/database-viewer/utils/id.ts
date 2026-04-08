/**
 * Generate a short, unique row ID.
 * Uses first 8 chars of a UUID — ~4 billion possible IDs per database.
 */
export function generateRowId(): string {
  return crypto.randomUUID().slice(0, 8);
}
