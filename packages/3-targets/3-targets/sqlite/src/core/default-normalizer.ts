/**
 * Normalizes SQLite's stored default expressions back into the
 * `ColumnDefault` shape the verifier compares against. Lives target-side
 * (mirroring Postgres's `target-postgres/src/core/default-normalizer.ts`)
 * so both the control adapter (`SqliteControlAdapter.introspect`) and the
 * planner / runner schema-verify path can consume it without
 * `target-sqlite` reaching into `adapter-sqlite`.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnDefault } from '@prisma-next/sql-contract/types';

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
  _nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parentheses that SQLite adds around expressions. Iterate to
  // fixpoint so accidental double-wrapping (e.g. `((expr))`) collapses too.
  while (true) {
    const stripped = stripOuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
  }

  // SQLite has several spellings for "current timestamp" — `CURRENT_TIMESTAMP`
  // (keyword) and `datetime('now')` / `datetime("now")` (function call). The
  // contract authoring side canonicalizes `dbgenerated("CURRENT_TIMESTAMP")`
  // (and friends) to `now()` via `lowerDbgenerated`; mirror that here so a
  // schema produced by either spelling round-trips to the same canonical
  // form for verification.
  const lower = trimmed.toLowerCase();
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return { kind: 'expression', expression: 'now()' };
  }

  return { kind: 'expression', expression: trimmed };
}

/**
 * Extracts the codec-comparable {@link JsonValue} out of a raw SQLite
 * column default expression (the value `pragma_table_info.dflt_value`
 * returns). Mirror of `parsePostgresDefaultValue` in
 * `target-postgres/src/core/default-normalizer.ts`; the verifier dispatches
 * the returned {@link JsonValue} through the column's codec
 * (`codec.decodeJson(...)` → `codec.renderSqlLiteral(...)`) and compares
 * the result against the contract-side expression.
 *
 * Returns `undefined` for non-literal forms (`CURRENT_TIMESTAMP`,
 * `datetime('now')`); the verifier falls back to the legacy normalizer
 * path for those.
 *
 * SQLite is loose-typed at the storage layer: it stores affinities, not
 * strict per-column types. The parser therefore relies on the `nativeType`
 * hint to disambiguate quoted numerics from quoted strings.
 */
export function parseSqliteDefaultValue(
  rawDefault: string,
  nativeType: string,
): JsonValue | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parens iteratively (SQLite wraps expressions like `(1)` in
  // parens; the recreate-table postcheck builder mirrors this).
  while (true) {
    const stripped = stripOuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return undefined;
  }

  // Boolean literals (SQLite supports both `1`/`0` and `true`/`false`).
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;

  // Numerics — bare or quoted-with-cast — on a numeric nativeType
  // (SQLite's affinity is integer / real / numeric).
  if (/^(?:int|bigint|smallint|numeric|real|float|double)/i.test(nativeType)) {
    const numericMatch = trimmed.match(/^'?(-?\d+(?:\.\d+)?)'?$/);
    if (numericMatch?.[1] !== undefined) {
      const n = Number(numericMatch[1]);
      if (Number.isFinite(n)) return n;
    }
  }

  // JSON literals — SQLite's text-JSON columns store JSON as TEXT;
  // `pragma_table_info.dflt_value` returns the quoted JSON literal.
  if (/json/i.test(nativeType)) {
    const stringMatch = trimmed.match(/^'((?:[^']|'')*)'$/);
    if (stringMatch?.[1] !== undefined) {
      try {
        return JSON.parse(stringMatch[1].replace(/''/g, "'"));
      } catch {
        return undefined;
      }
    }
  }

  // Quoted strings — strip outer single quotes; SQLite uses `''` for
  // embedded quotes (same as Postgres).
  const stringMatch = trimmed.match(/^'((?:[^']|'')*)'$/);
  if (stringMatch?.[1] !== undefined) {
    return stringMatch[1].replace(/''/g, "'");
  }

  return undefined;
}
