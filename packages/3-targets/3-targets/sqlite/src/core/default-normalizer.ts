/**
 * Normalizes SQLite's stored default expressions back into the
 * `ColumnDefault` shape the verifier compares against. Lives target-side
 * (mirroring Postgres's `target-postgres/src/core/default-normalizer.ts`)
 * so both the control adapter (`SqliteControlAdapter.introspect`) and the
 * planner / runner schema-verify path can consume it without
 * `target-sqlite` reaching into `adapter-sqlite`.
 */

import type { ColumnDefault } from '@prisma-next/contract/types';

const NULL_PATTERN = /^NULL$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const REAL_PATTERN = /^-?\d+\.\d+(?:[eE][+-]?\d+)?$/;
const HEX_PATTERN = /^-?0[xX][\dA-Fa-f]+$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

function isNumericLiteral(value: string): boolean {
  return INTEGER_PATTERN.test(value) || REAL_PATTERN.test(value) || HEX_PATTERN.test(value);
}

export function parseSqliteDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parentheses that SQLite adds around expressions
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  const lower = trimmed.toLowerCase();

  // CURRENT_TIMESTAMP and datetime('now')/datetime("now") are the SQLite forms of now()
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return { kind: 'function', expression: 'now()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  // SQLite integer is always 64-bit — can exceed JS safe integer range.
  // Use nativeType to pick strategy: integer → always string, real → always number.
  if (isNumericLiteral(trimmed)) {
    if (nativeType?.toLowerCase() === 'integer') {
      return { kind: 'literal', value: trimmed };
    }
    return { kind: 'literal', value: Number(trimmed) };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized expression — preserve as function
  return { kind: 'function', expression: trimmed };
}
