import type { ColumnDefault } from '@prisma-next/contract/types';

/**
 * Result of mapping a ColumnDefault to a PSL @default expression.
 */
export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

/**
 * Maps a normalized ColumnDefault to a PSL @default(...) attribute string,
 * or a comment for unrecognized expressions.
 */
export function mapDefault(columnDefault: ColumnDefault): DefaultMappingResult {
  if (columnDefault.kind === 'literal') {
    return { attribute: `@default(${formatLiteralValue(columnDefault.value)})` };
  }

  // Function expressions
  const expr = columnDefault.expression;

  if (expr === 'autoincrement()') {
    return { attribute: '@default(autoincrement())' };
  }
  if (expr === 'now()') {
    return { attribute: '@default(now())' };
  }
  if (expr === 'gen_random_uuid()') {
    return { attribute: '@default(dbgenerated("gen_random_uuid()"))' };
  }

  // Unrecognized function — emit as comment
  return { comment: `// Raw default: ${expr}` };
}

/**
 * Formats a literal value for use in @default(...).
 */
function formatLiteralValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return `"${escapeString(value)}"`;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  // Tagged bigint: { $type: 'bigint', value: string }
  if (isTaggedBigInt(value)) {
    return value.value;
  }
  if (value === null) {
    return 'null';
  }

  // Fallback for complex types (arrays, objects) — not representable in PSL @default
  return `"${escapeString(JSON.stringify(value))}"`;
}

function isTaggedBigInt(value: unknown): value is { $type: 'bigint'; value: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$type' in value &&
    (value as Record<string, unknown>)['$type'] === 'bigint'
  );
}

function escapeString(str: string): string {
  return JSON.stringify(str).slice(1, -1);
}
