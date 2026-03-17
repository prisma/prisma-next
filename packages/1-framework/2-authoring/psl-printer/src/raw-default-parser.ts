import type { ColumnDefault } from '@prisma-next/contract/types';

/**
 * Parses a raw database default expression into a normalized ColumnDefault.
 * This is a lightweight, target-agnostic parser that handles common patterns.
 */

const NEXTVAL_PATTERN = /^nextval\s*\(/i;
const TIMESTAMP_PATTERN = /^(now\s*\(\s*\)|CURRENT_TIMESTAMP|clock_timestamp\s*\(\s*\))$/i;
const UUID_PATTERN = /^gen_random_uuid\s*\(\s*\)$/i;
const UUID_OSSP_PATTERN = /^uuid_generate_v4\s*\(\s*\)$/i;
const TRUE_PATTERN = /^true$/i;
const FALSE_PATTERN = /^false$/i;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/;

export function parseRawDefault(rawDefault: string): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();

  if (NEXTVAL_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'autoincrement()' };
  }

  if (TIMESTAMP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }

  if (UUID_PATTERN.test(trimmed) || UUID_OSSP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  if (TRUE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: true };
  }

  if (FALSE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: false };
  }

  if (NUMERIC_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: Number(trimmed) };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized — return as function with raw expression
  return { kind: 'function', expression: trimmed };
}
