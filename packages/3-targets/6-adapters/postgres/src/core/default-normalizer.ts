import type { ColumnDefault } from '@prisma-next/contract/types';

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

  // Autoincrement: nextval('tablename_column_seq'::regclass)
  if (/^nextval\s*\(/i.test(trimmed)) {
    return { kind: 'function', expression: 'autoincrement()' };
  }

  // now() / CURRENT_TIMESTAMP / clock_timestamp()
  if (/^(now\s*\(\s*\)|CURRENT_TIMESTAMP|clock_timestamp\s*\(\s*\))$/i.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }

  // gen_random_uuid()
  if (/^gen_random_uuid\s*\(\s*\)$/i.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  // Boolean literals
  if (/^true$/i.test(trimmed)) {
    return { kind: 'literal', expression: 'true' };
  }
  if (/^false$/i.test(trimmed)) {
    return { kind: 'literal', expression: 'false' };
  }

  // Numeric literals (integer or decimal)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', expression: trimmed };
  }

  // String literals: 'value'::type or just 'value'
  // Match: 'some text'::text, 'hello'::character varying, 'value', etc.
  const stringMatch = trimmed.match(/^'((?:[^']|'')*)'(?:::[\w\s]+(?:\(\d+\))?)?$/);
  if (stringMatch?.[1] !== undefined) {
    return { kind: 'literal', expression: trimmed };
  }

  // Unrecognized expression - return as a function with the raw expression
  // This preserves the information for debugging while still being comparable
  return { kind: 'function', expression: trimmed };
}
