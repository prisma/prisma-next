import type { ColumnDefault } from '@prisma-next/contract/types';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

type TaggedBigInt = {
  readonly $type: 'bigint';
  readonly value: string;
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
}

/**
 * Result of mapping a ColumnDefault to a PSL @default expression.
 */
export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

/**
 * Maps a normalized ColumnDefault to a PSL @default(...) attribute string,
 * or a comment for unrecognized expressions.
 */
export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult {
  switch (columnDefault.kind) {
    case 'literal':
      return { attribute: `@default(${formatLiteralValue(columnDefault.value)})` };
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression];
      return attribute ? { attribute } : { comment: `// Raw default: ${columnDefault.expression}` };
    }
  }
}

/**
 * Formats a literal value for use in @default(...).
 */
function formatLiteralValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (isTaggedBigInt(value)) {
    return value.value;
  }

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'bigint':
      return String(value);
    case 'string':
      return quoteString(value);
    default:
      // Fallback for complex types (arrays, objects) — not representable in PSL @default
      return quoteString(JSON.stringify(value));
  }
}

function isTaggedBigInt(value: unknown): value is TaggedBigInt {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$type' in value &&
    (value as Record<string, unknown>)['$type'] === 'bigint'
  );
}

function quoteString(str: string): string {
  return `"${escapeString(str)}"`;
}

function escapeString(str: string): string {
  return JSON.stringify(str).slice(1, -1);
}
