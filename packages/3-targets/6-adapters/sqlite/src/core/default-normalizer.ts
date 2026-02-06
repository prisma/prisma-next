import type { ColumnDefault } from '@prisma-next/contract/types';

const CURRENT_TIMESTAMP_PATTERN = /^current_timestamp$/i;
const DATETIME_NOW_PATTERN = /^datetime\s*\(\s*'now'\s*\)$/i;
const TRUE_PATTERN = /^true$/i;
const FALSE_PATTERN = /^false$/i;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

/**
 * Parses a raw SQLite column default expression into a normalized ColumnDefault.
 *
 * SQLite stores defaults as text fragments (e.g., CURRENT_TIMESTAMP, 0, 'hello').
 * Normalization enables semantic comparison against contract defaults.
 */
export function parseSqliteDefault(rawDefault: string): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();

  // now(): CURRENT_TIMESTAMP or datetime('now')
  if (CURRENT_TIMESTAMP_PATTERN.test(trimmed) || DATETIME_NOW_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }

  if (TRUE_PATTERN.test(trimmed)) {
    return { kind: 'literal', expression: 'true' };
  }
  if (FALSE_PATTERN.test(trimmed)) {
    return { kind: 'literal', expression: 'false' };
  }

  if (NUMERIC_PATTERN.test(trimmed)) {
    return { kind: 'literal', expression: trimmed };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    return { kind: 'literal', expression: trimmed };
  }

  // Unknown default; preserve raw expression.
  return { kind: 'function', expression: trimmed };
}
