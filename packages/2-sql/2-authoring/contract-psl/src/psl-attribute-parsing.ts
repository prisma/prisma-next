import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ControlPolicy } from '@prisma-next/contract/types';
import type { PslSpan, ResolvedAttribute } from '@prisma-next/psl-parser';
import { parseQuotedStringLiteral } from '@prisma-next/psl-parser';
import type { ExpressionAst } from '@prisma-next/psl-parser/syntax';

export { parseQuotedStringLiteral };

export function getPositionalArgument(attribute: ResolvedAttribute, index = 0): string | undefined {
  return attribute.args.filter((arg) => arg.kind === 'positional')[index]?.value;
}

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
  if (!entry || entry.kind !== 'named') {
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
  if (!entry || entry.kind !== 'positional') {
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
  readonly attribute: ResolvedAttribute | undefined;
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
  readonly attribute: ResolvedAttribute | undefined;
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

export function getPositionalArguments(attribute: ResolvedAttribute): readonly string[] {
  return attribute.args
    .filter((arg) => arg.kind === 'positional')
    .map((arg) => (arg.kind === 'positional' ? arg.value : ''));
}

/**
 * Parses a PSL object-literal attribute argument value of the form
 * `{ key1: "value1", key2: "value2" }` into a `Record<string, string>`.
 *
 * V1 admits string literals only as leaf values. Boolean and number
 * literals are rejected. Trailing commas are allowed.
 *
 * Returns the parsed record, or pushes a diagnostic and returns undefined
 * on malformed input or non-string leaves.
 */
export function parseObjectLiteralStringMap(input: {
  readonly raw: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly entityLabel: string;
}): Record<string, string> | undefined {
  const trimmed = input.raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.span,
      message: `${input.entityLabel} expected an object literal value of the form { key: "value", ... }`,
    });
  }
  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const part of splitObjectLiteralEntries(body)) {
    const colonAt = findTopLevelColon(part);
    if (colonAt === -1) {
      return pushInvalidAttributeArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: input.span,
        message: `${input.entityLabel} object-literal entry "${part}" is missing a "key: value" colon`,
      });
    }
    const key = part.slice(0, colonAt).trim();
    const rawValue = part.slice(colonAt + 1).trim();
    if (key.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return pushInvalidAttributeArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: input.span,
        message: `${input.entityLabel} object-literal key "${key}" must be a bare identifier`,
      });
    }
    const parsedString = parseQuotedStringLiteral(rawValue);
    if (parsedString === undefined) {
      return pushInvalidAttributeArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: input.span,
        message: `${input.entityLabel} object-literal value for "${key}" must be a quoted string literal (V1 PSL @@index options support string leaves only; use the TS authoring surface for non-string options)`,
      });
    }
    if (Object.hasOwn(result, key)) {
      return pushInvalidAttributeArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: input.span,
        message: `${input.entityLabel} object-literal key "${key}" appears more than once`,
      });
    }
    result[key] = parsedString;
  }
  return result;
}

function splitObjectLiteralEntries(body: string): readonly string[] {
  const parts: string[] = [];
  let depthBrace = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index] ?? '';
    if (quote) {
      if (ch === quote && body[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '[') depthBracket += 1;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === ',' && depthBrace === 0 && depthBracket === 0 && depthParen === 0) {
      const segment = body.slice(start, index).trim();
      if (segment.length > 0) parts.push(segment);
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

function findTopLevelColon(entry: string): number {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < entry.length; index += 1) {
    const ch = entry[index] ?? '';
    if (quote) {
      if (ch === quote && entry[index - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':') return index;
  }
  return -1;
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

export function parseAttributeFieldList(input: {
  readonly attribute: ResolvedAttribute;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly code: string;
  readonly entityLabel: string;
}): readonly string[] | undefined {
  const raw = getNamedArgument(input.attribute, 'fields') ?? getPositionalArgument(input.attribute);
  if (!raw) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.entityLabel} requires fields list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const fields = parseFieldList(raw);
  if (!fields || fields.length === 0) {
    input.diagnostics.push({
      code: input.code,
      message: `${input.entityLabel} requires bracketed field list argument`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  return fields;
}

export function findDuplicateFieldName(fieldNames: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const name of fieldNames) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
}

const CONTROL_POLICY_LITERALS = [
  'managed',
  'tolerated',
  'external',
  'observed',
] as const satisfies readonly ControlPolicy[];

const CONTROL_POLICY_LITERAL_SET = new Set<string>(CONTROL_POLICY_LITERALS);

function isControlPolicyLiteral(value: string): value is ControlPolicy {
  return CONTROL_POLICY_LITERAL_SET.has(value);
}

export function parseControlPolicyAttribute(input: {
  readonly attribute: ResolvedAttribute;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): ControlPolicy | undefined {
  const namedArgs = input.attribute.args.filter((arg) => arg.kind === 'named');
  if (namedArgs.length > 0) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message:
        '`@@control` does not accept named arguments; pass the policy positionally as `@@control(external)`.',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  const positionalArgs = getPositionalArguments(input.attribute);
  if (positionalArgs.length === 0) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message:
        '`@@control` requires exactly one positional argument: `managed`, `tolerated`, `external`, or `observed`.',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  if (positionalArgs.length > 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `\`@@control\` accepts exactly one positional argument; got ${positionalArgs.length}.`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  const token = unquoteStringLiteral(positionalArgs[0] ?? '').trim();
  if (!isControlPolicyLiteral(token)) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `\`@@control\` argument \`${token}\` is not a known policy. Allowed: \`managed\`, \`tolerated\`, \`external\`, \`observed\`.`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  return token;
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
