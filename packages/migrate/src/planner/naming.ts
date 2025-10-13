import { createHash } from 'crypto';

// Postgres identifier length limit
const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Generate deterministic constraint names following Postgres conventions
 * with 63-byte truncation and hash suffix for collision avoidance
 */
export function generateConstraintName(
  type: 'primaryKey' | 'unique' | 'foreignKey' | 'index',
  table: string,
  columns: string[],
): string {
  const sortedColumns = [...columns].sort();

  let baseName: string;
  switch (type) {
    case 'primaryKey':
      baseName = `${table}_pkey`;
      break;
    case 'unique':
      baseName = `${table}_${sortedColumns.join('_')}_key`;
      break;
    case 'foreignKey':
      baseName = `${table}_${sortedColumns.join('_')}_fkey`;
      break;
    case 'index':
      baseName = `${table}_${sortedColumns.join('_')}_idx`;
      break;
  }

  return truncateWithHash(baseName);
}

/**
 * Truncate identifier to 63 bytes and add short hash suffix if needed
 */
function truncateWithHash(identifier: string): string {
  if (identifier.length <= MAX_IDENTIFIER_LENGTH) {
    return identifier;
  }

  // Reserve 8 characters for hash suffix (including underscore)
  const maxBaseLength = MAX_IDENTIFIER_LENGTH - 8;
  const truncated = identifier.substring(0, maxBaseLength);

  // Generate short hash suffix
  const hash = createHash('sha256').update(identifier).digest('hex').substring(0, 7);

  return `${truncated}_${hash}`;
}

/**
 * Normalize column set for comparison (sorted, lowercase)
 */
export function normalizeColumnSet(columns: string[]): string[] {
  return [...columns].sort();
}

/**
 * Check if two column sets are equivalent (order-insensitive)
 */
export function columnSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  const normalizedA = normalizeColumnSet(a);
  const normalizedB = normalizeColumnSet(b);

  return normalizedA.every((col, i) => col === normalizedB[i]);
}
