import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { PslSpan, ResolvedAttribute } from '@prisma-next/psl-parser';
import { parseQuotedStringLiteral } from '@prisma-next/psl-parser';
import type { ExpressionAst } from '@prisma-next/psl-parser/syntax';

export { parseQuotedStringLiteral };

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly ResolvedAttribute[] | undefined,
  name: string,
): ResolvedAttribute | undefined {
  return attributes?.find((attribute) => attribute.name === name);
}

export function getNamedArgument(attribute: ResolvedAttribute, name: string): string | undefined {
  const entry = attribute.args.find((arg) => arg.kind === 'named' && arg.name === name);
  if (entry?.kind !== 'named') {
    return undefined;
  }
  return entry.value;
}

export function getPositionalArgumentEntry(
  attribute: ResolvedAttribute,
  index = 0,
): { value: string; expression?: ExpressionAst; span: PslSpan } | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (entry?.kind !== 'positional') {
    return undefined;
  }
  return {
    value: entry.value,
    ...(entry.expression !== undefined ? { expression: entry.expression } : {}),
    span: entry.span,
  };
}

export function unquoteStringLiteral(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) {
    return trimmed;
  }
  return match[2] ?? '';
}

export function getPositionalArguments(attribute: ResolvedAttribute): readonly string[] {
  return attribute.args
    .filter((arg) => arg.kind === 'positional')
    .map((arg) => (arg.kind === 'positional' ? arg.value : ''));
}

export function pushInvalidAttributeArgument(input: {
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: input.message,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

export function parseOptionalSingleIntegerArgument(input: {
  readonly attribute: ResolvedAttribute;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
  readonly minimum: number;
  readonly valueLabel: string;
}): number | null | undefined {
  if (input.attribute.args.some((arg) => arg.kind === 'named')) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} accepts zero or one positional integer argument.`,
    });
  }

  const positionalArguments = getPositionalArguments(input.attribute);
  if (positionalArguments.length > 1) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} accepts zero or one positional integer argument.`,
    });
  }
  if (positionalArguments.length === 0) {
    return null;
  }

  const parsed = Number(unquoteStringLiteral(positionalArguments[0] ?? ''));
  if (!Number.isInteger(parsed) || parsed < input.minimum) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} requires a ${input.valueLabel}.`,
    });
  }

  return parsed;
}

export function parseOptionalNumericArguments(input: {
  readonly attribute: ResolvedAttribute;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}): { precision: number; scale?: number } | null | undefined {
  if (input.attribute.args.some((arg) => arg.kind === 'named')) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} accepts zero, one, or two positional integer arguments.`,
    });
  }

  const positionalArguments = getPositionalArguments(input.attribute);
  if (positionalArguments.length > 2) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} accepts zero, one, or two positional integer arguments.`,
    });
  }
  if (positionalArguments.length === 0) {
    return null;
  }

  const precision = Number(unquoteStringLiteral(positionalArguments[0] ?? ''));
  if (!Number.isInteger(precision) || precision < 1) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} requires a positive integer precision.`,
    });
  }

  if (positionalArguments.length === 1) {
    return { precision };
  }

  const scale = Number(unquoteStringLiteral(positionalArguments[1] ?? ''));
  if (!Number.isInteger(scale) || scale < 0) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} @${input.attribute.name} requires a non-negative integer scale.`,
    });
  }

  return { precision, scale };
}

export function mapFieldNamesToColumns(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly mapping: { readonly fieldColumns: Map<string, string> };
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly span: PslSpan;
  readonly entityLabel: string;
}): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of input.fieldNames) {
    const columnName = input.mapping.fieldColumns.get(fieldName);
    if (!columnName) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${input.entityLabel} references unknown field "${input.modelName}.${fieldName}"`,
        sourceId: input.sourceId,
        span: input.span,
      });
      return undefined;
    }
    columns.push(columnName);
  }
  return columns;
}
