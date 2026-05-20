import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnDefault } from '@prisma-next/sql-contract/types';

/**
 * Pre-compiled regex patterns for performance.
 * These are compiled once at module load time rather than on each function call.
 */
const NEXTVAL_PATTERN = /^nextval\s*\(/i;
const NOW_FUNCTION_PATTERN = /^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i;
const CLOCK_TIMESTAMP_PATTERN = /^clock_timestamp\s*\(\s*\)$/i;
const TIMESTAMP_CAST_SUFFIX = /::timestamp(?:tz|\s+(?:with|without)\s+time\s+zone)?$/i;
const TEXT_CAST_SUFFIX = /::text$/i;
const NOW_LITERAL_PATTERN = /^'now'$/i;
const UUID_PATTERN = /^gen_random_uuid\s*\(\s*\)$/i;
const UUID_OSSP_PATTERN = /^uuid_generate_v4\s*\(\s*\)$/i;

/**
 * Returns the canonical expression for a timestamp default function, or undefined
 * if the expression is not a recognized timestamp default.
 *
 * Keeps now()/CURRENT_TIMESTAMP and clock_timestamp() distinct:
 * - now(), CURRENT_TIMESTAMP, ('now'::text)::timestamp... → 'now()'
 * - clock_timestamp(), clock_timestamp()::timestamptz → 'clock_timestamp()'
 *
 * These are semantically different in Postgres: now() returns the transaction
 * start time (constant within a transaction), while clock_timestamp() returns
 * the actual wall-clock time (can differ across rows in a single INSERT).
 */
function canonicalizeTimestampDefault(expr: string): string | undefined {
  if (NOW_FUNCTION_PATTERN.test(expr)) return 'now()';
  if (CLOCK_TIMESTAMP_PATTERN.test(expr)) return 'clock_timestamp()';

  if (!TIMESTAMP_CAST_SUFFIX.test(expr)) return undefined;

  let inner = expr.replace(TIMESTAMP_CAST_SUFFIX, '').trim();

  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1).trim();
  }

  if (NOW_FUNCTION_PATTERN.test(inner)) return 'now()';
  if (CLOCK_TIMESTAMP_PATTERN.test(inner)) return 'clock_timestamp()';

  inner = inner.replace(TEXT_CAST_SUFFIX, '').trim();
  if (NOW_LITERAL_PATTERN.test(inner)) return 'now()';

  return undefined;
}

/**
 * Parses a raw Postgres column default expression into a normalized ColumnDefault.
 * This enables semantic comparison between contract defaults and introspected schema defaults.
 *
 * Used by the migration diff layer to normalize raw database defaults during comparison,
 * keeping the introspection layer focused on faithful data capture.
 *
 * @param rawDefault - Raw default expression from information_schema.columns.column_default
 * @param nativeType - Native column type, used for type-aware parsing (bigint tagging, JSON detection)
 * @returns Normalized ColumnDefault or undefined if the expression cannot be parsed
 */
export function parsePostgresDefault(
  rawDefault: string,
  _nativeType?: string,
): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();

  if (NEXTVAL_PATTERN.test(trimmed)) {
    return { kind: 'autoincrement' };
  }

  const canonicalTimestamp = canonicalizeTimestampDefault(trimmed);
  if (canonicalTimestamp) {
    return { kind: 'expression', expression: canonicalTimestamp };
  }

  if (UUID_PATTERN.test(trimmed)) {
    return { kind: 'expression', expression: 'gen_random_uuid()' };
  }

  if (UUID_OSSP_PATTERN.test(trimmed)) {
    return { kind: 'expression', expression: 'gen_random_uuid()' };
  }

  return { kind: 'expression', expression: trimmed };
}

/**
 * Matches an outer `::<type>` cast suffix (possibly quoted, possibly with
 * length / precision parameters). Used by {@link parsePostgresDefaultValue}
 * to strip the column-type cast before unquoting / number-parsing.
 */
const CAST_SUFFIX = /\s*::\s*(?:"[^"]+"|[\w\s]+)(?:\(\d+(?:,\d+)?\))?$/;

/**
 * Returns the SQL literal value with its outer `::<type>` cast stripped.
 * Handles quoted enum/type names (`::"BillingState"`) and parameterised
 * types (`::numeric(10,2)`).
 */
function stripOuterCast(s: string): string {
  return s.replace(CAST_SUFFIX, '');
}

/**
 * Extracts the codec-comparable {@link JsonValue} out of a raw Postgres
 * column default expression (the value `pg_get_expr` returns).
 *
 * The verifier round-trips this {@link JsonValue} through the column's
 * codec (`codec.decodeJson(...)` → `codec.renderSqlLiteral(...)`) and
 * compares the result against the contract-side expression. The
 * comparison is therefore codec-canonical: two textually different
 * Postgres-canonical forms collapse to one contract-canonical form when
 * they decode to the same typed value.
 *
 * Returns `undefined` for non-literal forms (function calls like `now()`,
 * `nextval(...)`, `gen_random_uuid()`); the verifier falls back to the
 * legacy normalizer-based string compare for those.
 *
 * Recognised literal forms:
 *
 * - Quoted strings (`'foo'`, `'it''s'`) with optional `::type` cast →
 *   the unquoted string.
 * - Bare numerics (`9007199254740991`, `3.14`) and quoted numerics
 *   (`'9007199254740991'::bigint`) on a numeric `nativeType` → the
 *   parsed number.
 * - Boolean literals (`true`, `false`, case-insensitive) → the boolean.
 * - Timestamp-typed literals: the inner string is parsed via `new Date`
 *   and emitted in canonical ISO-8601 UTC form so the codec's strict
 *   `decodeJson` accepts it. Both Postgres-canonical
 *   `'2024-01-15 10:30:00+00'` and ISO-T forms collapse to the same JS
 *   `Date`.
 * - JSON / JSONB literals (`'{"key":"value"}'::jsonb`) → the parsed
 *   `JsonValue`.
 *
 * Adversarial inputs are handled conservatively: malformed JSON returns
 * `undefined`, invalid dates return `undefined`, etc. The verifier's
 * fallback path picks them up.
 */
export function parsePostgresDefaultValue(
  rawDefault: string,
  nativeType: string,
): JsonValue | undefined {
  const trimmed = rawDefault.trim();

  // Non-literal forms — short-circuit so the verifier falls back to the
  // normalizer path (which detects autoincrement / timestamp functions).
  if (
    NEXTVAL_PATTERN.test(trimmed) ||
    NOW_FUNCTION_PATTERN.test(trimmed) ||
    CLOCK_TIMESTAMP_PATTERN.test(trimmed) ||
    UUID_PATTERN.test(trimmed) ||
    UUID_OSSP_PATTERN.test(trimmed) ||
    canonicalizeTimestampDefault(trimmed) !== undefined
  ) {
    return undefined;
  }

  const inner = stripOuterCast(trimmed);

  // Timestamp-typed: parse via `new Date` and emit ISO-8601 UTC so the
  // codec's strict `decodeJson` accepts the value. Both
  // `'2024-01-15 10:30:00+00'` and `'2024-01-15T10:30:00.000Z'` collapse
  // here.
  if (/timestamp|date|time/i.test(nativeType)) {
    const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
    const candidate = stringMatch?.[1]?.replace(/''/g, "'") ?? inner;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Boolean literals
  if (/^true$/i.test(inner)) return true;
  if (/^false$/i.test(inner)) return false;

  // Numerics — bare or quoted-with-cast — on a numeric nativeType.
  if (/^(?:int|bigint|smallint|numeric|decimal|float|real|double|serial)/i.test(nativeType)) {
    const numericMatch = inner.match(/^'?(-?\d+(?:\.\d+)?)'?$/);
    if (numericMatch?.[1] !== undefined) {
      const n = Number(numericMatch[1]);
      if (Number.isFinite(n)) return n;
    }
  }

  // JSON / JSONB literals — parse the inner quoted body
  if (/json/i.test(nativeType)) {
    const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
    if (stringMatch?.[1] !== undefined) {
      try {
        return JSON.parse(stringMatch[1].replace(/''/g, "'"));
      } catch {
        return undefined;
      }
    }
  }

  // Quoted strings — strip outer quotes, unescape doubled single quotes.
  const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
  if (stringMatch?.[1] !== undefined) {
    return stringMatch[1].replace(/''/g, "'");
  }

  // No recognised literal shape — let the verifier fall back to the
  // legacy normalizer path.
  return undefined;
}
