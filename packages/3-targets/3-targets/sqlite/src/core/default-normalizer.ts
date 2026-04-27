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
const HEX_PATTERN = /^0[xX][\dA-Fa-f]+$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

function isNumericLiteral(value: string): boolean {
  return INTEGER_PATTERN.test(value) || REAL_PATTERN.test(value) || HEX_PATTERN.test(value);
}

/**
 * Strips a single matched wrapping pair of outer parens from `s`. Conservative:
 * only strips when the leading `(` is matched by the trailing `)` (so
 * `(a) + (b)` is returned unchanged). Mirrors SQLite's own
 * `pragma_table_info.dflt_value` normalization for expression defaults, and
 * is shared with the recreate-table postcheck builder so both sides agree
 * on the canonical form.
 */
export function stripOuterParens(s: string): string {
  if (!s.startsWith('(') || !s.endsWith(')')) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0 && i < s.length - 1) return s;
    }
  }
  return s.slice(1, -1);
}

export function parseSqliteDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parentheses that SQLite adds around expressions. Iterate to
  // fixpoint so accidental double-wrapping (e.g. `((expr))`) collapses too.
  while (true) {
    const stripped = stripOuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
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
