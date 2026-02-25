import type { ColumnDefault } from '@prisma-next/contract/types';

/**
 * Pre-compiled regex patterns for performance.
 * These are compiled once at module load time rather than on each function call.
 */
const NEXTVAL_PATTERN = /^nextval\s*\(/i;
const TIMESTAMP_PATTERN = /^(now\s*\(\s*\)|CURRENT_TIMESTAMP|clock_timestamp\s*\(\s*\))$/i;
const UUID_PATTERN = /^gen_random_uuid\s*\(\s*\)$/i;
const UUID_OSSP_PATTERN = /^uuid_generate_v4\s*\(\s*\)$/i;
const TRUE_PATTERN = /^true$/i;
const FALSE_PATTERN = /^false$/i;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/;

/**
 * Parses a raw Postgres column default expression into a normalized ColumnDefault.
 * This enables semantic comparison between contract defaults and introspected schema defaults.
 *
 * Used by the migration diff layer to normalize raw database defaults during comparison,
 * keeping the introspection layer focused on faithful data capture.
 *
 * @param rawDefault - Raw default expression from information_schema.columns.column_default
 * @param _nativeType - Native column type (currently unused, reserved for future type-aware parsing)
 * @returns Normalized ColumnDefault or undefined if the expression cannot be parsed
 */
export function parsePostgresDefault(
  rawDefault: string,
  _nativeType?: string,
): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();
  const normalizedType = _nativeType?.toLowerCase();
  const isBigInt = normalizedType === 'bigint' || normalizedType === 'int8';

  // Autoincrement: nextval('tablename_column_seq'::regclass)
  if (NEXTVAL_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'autoincrement()' };
  }

  // now() / CURRENT_TIMESTAMP / clock_timestamp()
  if (TIMESTAMP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }

  // gen_random_uuid()
  if (UUID_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  // uuid_generate_v4() from uuid-ossp extension
  if (UUID_OSSP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  // Boolean literals
  if (TRUE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: true };
  }
  if (FALSE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: false };
  }

  // Numeric literals (integer or decimal)
  if (NUMERIC_PATTERN.test(trimmed)) {
    if (isBigInt) {
      return { kind: 'literal', value: { $type: 'bigint', value: trimmed } };
    }
    return { kind: 'literal', value: Number(trimmed) };
  }

  // String literals: 'value'::type or just 'value'
  // Match: 'some text'::text, 'hello'::character varying, 'value', etc.
  // Strip the ::type cast so the normalized expression matches what contract authors write.
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
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized expression - return as a function with the raw expression
  // This preserves the information for debugging while still being comparable
  return { kind: 'function', expression: trimmed };
}
