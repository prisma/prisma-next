import type { ColumnDefault } from '@prisma-next/contract/types';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  readonly fallbackFunctionAttribute?: ((expression: string) => string | undefined) | undefined;
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
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        options?.fallbackFunctionAttribute?.(columnDefault.expression);
      return attribute
        ? { attribute }
        : { comment: `// Raw default: ${columnDefault.expression.replace(/[\r\n]+/g, ' ')}` };
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

  switch (typeof value) {
    case 'boolean':
    case 'number':
      return String(value);
    case 'string':
      return quoteString(value);
    default:
      return quoteString(JSON.stringify(value));
  }
}

function quoteString(str: string): string {
  return `"${escapeString(str)}"`;
}

function escapeString(str: string): string {
  return JSON.stringify(str).slice(1, -1);
}
