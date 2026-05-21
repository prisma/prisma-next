import type { ColumnDefault } from '@prisma-next/sql-contract/types';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  readonly fallbackFunctionAttribute?: ((expression: string) => string | undefined) | undefined;
}

export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult {
  switch (columnDefault.kind) {
    case 'autoincrement':
      return { attribute: '@default(autoincrement())' };
    case 'expression': {
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
