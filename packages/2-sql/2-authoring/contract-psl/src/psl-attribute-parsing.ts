import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { PslAttribute, PslSpan } from '@prisma-next/psl-parser';

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly PslAttribute[] | undefined,
  name: string,
): PslAttribute | undefined {
  return attributes?.find((attribute) => attribute.name === name);
}

export function getNamedArgument(attribute: PslAttribute, name: string): string | undefined {
  const entry = attribute.args.find((arg) => arg.kind === 'named' && arg.name === name);
  if (!entry || entry.kind !== 'named') {
    return undefined;
  }
  return entry.value;
}

export function getPositionalArgument(attribute: PslAttribute, index = 0): string | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (!entry || entry.kind !== 'positional') {
    return undefined;
  }
  return entry.value;
}

export function getPositionalArgumentEntry(
  attribute: PslAttribute,
  index = 0,
): { value: string; span: PslSpan } | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (!entry || entry.kind !== 'positional') {
    return undefined;
  }
  return {
    value: entry.value,
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

export function parseQuotedStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  // This intentionally accepts either '...' or "..." and relies on PSL's
  // own string literal rules to disallow unescaped interior delimiters.
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) {
    return undefined;
  }
  return match[2] ?? '';
}

export function parseFieldList(value: string): readonly string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return undefined;
  }
  const body = trimmed.slice(1, -1);
  const parts = body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts;
}

export function parseMapName(input: {
  readonly attribute: PslAttribute | undefined;
  readonly defaultValue: string;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly entityLabel: string;
  readonly span: PslSpan;
}): string {
  if (!input.attribute) {
    return input.defaultValue;
  }

  const value = getPositionalArgument(input.attribute);
  if (!value) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} @map requires a positional quoted string literal argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return input.defaultValue;
  }
  const parsed = parseQuotedStringLiteral(value);
  if (parsed === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} @map requires a positional quoted string literal argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return input.defaultValue;
  }
  return parsed;
}

export function parseConstraintMapArgument(input: {
  readonly attribute: PslAttribute | undefined;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly entityLabel: string;
  readonly span: PslSpan;
  readonly code: string;
}): string | undefined {
  if (!input.attribute) {
    return undefined;
  }

  const raw = getNamedArgument(input.attribute, 'map');
  if (!raw) {
    return undefined;
  }

  const parsed = parseQuotedStringLiteral(raw);
  if (parsed !== undefined) {
    return parsed;
  }

  input.diagnostics.push({
    code: input.code,
    message: `${input.entityLabel} map argument must be a quoted string literal`,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

export function getPositionalArguments(attribute: PslAttribute): readonly string[] {
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
  readonly attribute: PslAttribute;
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
  readonly attribute: PslAttribute;
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

export function parseAttributeFieldList(input: {
  readonly attribute: PslAttribute;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly code: string;
  readonly messagePrefix: string;
}): readonly string[] | undefined {
  const raw = getNamedArgument(input.attribute, 'fields') ?? getPositionalArgument(input.attribute);
  if (!raw) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.messagePrefix} requires fields list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const fields = parseFieldList(raw);
  if (!fields || fields.length === 0) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.messagePrefix} requires bracketed field list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  return fields;
}

export function mapFieldNamesToColumns(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly mapping: { readonly fieldColumns: Map<string, string> };
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly span: PslSpan;
  readonly contextLabel: string;
}): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of input.fieldNames) {
    const columnName = input.mapping.fieldColumns.get(fieldName);
    if (!columnName) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${input.contextLabel} references unknown field "${input.modelName}.${fieldName}"`,
        sourceId: input.sourceId,
        span: input.span,
      });
      return undefined;
    }
    columns.push(columnName);
  }
  return columns;
}
