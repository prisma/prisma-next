import type { ColumnDefault, JsonValue } from '@prisma-next/contract/types';

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
const NULL_PATTERN = /^NULL(?:::.+)?$/i;
const TRUE_PATTERN = /^true$/i;
const FALSE_PATTERN = /^false$/i;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/;

/**
 * Matches a Postgres array literal default of the form `'{...}'::elemtype[]`.
 * The literal body is captured in group 1; the cast (including `[]`) is optional.
 * Examples: `'{}'::text[]`, `'{1,2}'::integer[]`, `'{}'`
 */
const ARRAY_LITERAL_PATTERN = /^'(\{.*\})'(?:::.+\[\])?$/;

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
 * Parses a Postgres array literal body (`{...}`) into a JS array of primitives.
 * Returns undefined if the body cannot be reliably parsed.
 *
 * Handles:
 * - `{}` → `[]`
 * - `{elem1,elem2,...}` → `[elem1, elem2, ...]` with numeric and string element coercion
 */
function parseArrayLiteralBody(body: string): readonly JsonValue[] | undefined {
  const inner = body.slice(1, -1).trim();
  if (inner === '') return [];
  const elements = inner.split(',');
  const result: JsonValue[] = [];
  for (const rawEl of elements) {
    const el = rawEl.trim();
    if (el.toUpperCase() === 'NULL') {
      result.push(null);
      continue;
    }
    if (el === 'true') {
      result.push(true);
      continue;
    }
    if (el === 'false') {
      result.push(false);
      continue;
    }
    if (NUMERIC_PATTERN.test(el)) {
      result.push(Number(el));
      continue;
    }
    if (el.startsWith('"') && el.endsWith('"')) {
      result.push(el.slice(1, -1).replace(/""/g, '"'));
      continue;
    }
    return undefined;
  }
  return result;
}

/**
 * Parses a raw Postgres column default expression into a normalized ColumnDefault.
 * This enables semantic comparison between contract defaults and introspected schema defaults.
 *
 * Used by the migration diff layer to normalize raw database defaults during comparison,
 * keeping the introspection layer focused on faithful data capture.
 *
 * @param rawDefault - Raw default expression from information_schema.columns.column_default
 * @param nativeType - Native column type, used for type-aware parsing (array, bigint, JSON)
 * @returns Normalized ColumnDefault or undefined if the expression cannot be parsed
 */
export function parsePostgresDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();
  const normalizedType = nativeType?.toLowerCase();
  const isBigInt = normalizedType === 'bigint' || normalizedType === 'int8';
  const isArrayType = normalizedType?.endsWith('[]') ?? false;

  if (NEXTVAL_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'autoincrement()' };
  }

  if (isArrayType) {
    const arrayMatch = trimmed.match(ARRAY_LITERAL_PATTERN);
    if (arrayMatch?.[1] !== undefined) {
      const parsed = parseArrayLiteralBody(arrayMatch[1]);
      if (parsed !== undefined) {
        return { kind: 'literal', value: parsed };
      }
    }
  }

  const canonicalTimestamp = canonicalizeTimestampDefault(trimmed);
  if (canonicalTimestamp) {
    return { kind: 'function', expression: canonicalTimestamp };
  }

  if (UUID_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  if (UUID_OSSP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  if (TRUE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: true };
  }
  if (FALSE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: false };
  }

  if (NUMERIC_PATTERN.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    if (isBigInt && !Number.isSafeInteger(num)) {
      return { kind: 'literal', value: trimmed };
    }
    return { kind: 'literal', value: num };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    if (normalizedType === 'json' || normalizedType === 'jsonb') {
      try {
        return { kind: 'literal', value: JSON.parse(unescaped) };
      } catch {
        // Keep legacy behavior for malformed/non-JSON string content.
      }
    }
    if (isBigInt && NUMERIC_PATTERN.test(unescaped)) {
      const num = Number(unescaped);
      if (Number.isSafeInteger(num)) {
        return { kind: 'literal', value: num };
      }
      return { kind: 'literal', value: unescaped };
    }
    return { kind: 'literal', value: unescaped };
  }

  return { kind: 'function', expression: trimmed };
}
