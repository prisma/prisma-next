import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  AuthoringArgumentDescriptor,
  AuthoringContributions,
  AuthoringTypeConstructorDescriptor,
} from '@prisma-next/framework-components/authoring';
import {
  instantiateAuthoringTypeConstructor,
  isAuthoringTypeConstructorDescriptor,
  validateAuthoringHelperArguments,
} from '@prisma-next/framework-components/authoring';
import type {
  PslAttribute,
  PslAttributeArgument,
  PslField,
  PslSpan,
  PslTypeConstructorCall,
} from '@prisma-next/psl-parser';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from './default-function-registry';
import {
  lowerDefaultFunctionWithRegistry,
  parseDefaultFunctionCall,
} from './default-function-registry';
import {
  getPositionalArgumentEntry,
  getPositionalArguments,
  parseOptionalNumericArguments,
  parseOptionalSingleIntegerArgument,
  pushInvalidAttributeArgument,
  unquoteStringLiteral,
} from './psl-attribute-parsing';

export type ColumnDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeRef?: string;
  readonly typeParams?: Record<string, unknown>;
};

export function toNamedTypeFieldDescriptor(
  typeRef: string,
  descriptor: Pick<ColumnDescriptor, 'codecId' | 'nativeType'>,
): ColumnDescriptor {
  return {
    codecId: descriptor.codecId,
    nativeType: descriptor.nativeType,
    typeRef,
  };
}

export function getAuthoringTypeConstructor(
  contributions: AuthoringContributions | undefined,
  path: readonly string[],
): AuthoringTypeConstructorDescriptor | undefined {
  let current: unknown = contributions?.type;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return isAuthoringTypeConstructorDescriptor(current) ? current : undefined;
}

export function checkUncomposedNamespace(
  attributeName: string,
  composedExtensions: ReadonlySet<string>,
): string | undefined {
  const dotIndex = attributeName.indexOf('.');
  if (dotIndex <= 0 || dotIndex === attributeName.length - 1) {
    return undefined;
  }
  const namespace = attributeName.slice(0, dotIndex);
  if (namespace === 'db' || composedExtensions.has(namespace)) {
    return undefined;
  }
  return namespace;
}

/**
 * Pushes the canonical `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` diagnostic for a
 * subject (attribute, model attribute, or type constructor) that references an
 * extension namespace which is not composed in the current contract.
 *
 * The `data` payload carries the missing namespace so machine consumers
 * (agents, IDE extensions, CLI auto-fix) don't have to parse the prose.
 */
export function reportUncomposedNamespace(input: {
  readonly subjectLabel: string;
  readonly namespace: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  input.diagnostics.push({
    code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
    message: `${input.subjectLabel} uses unrecognized namespace "${input.namespace}". Add extension pack "${input.namespace}" to extensionPacks in prisma-next.config.ts.`,
    sourceId: input.sourceId,
    span: input.span,
    data: { namespace: input.namespace, suggestedPack: input.namespace },
  });
}

const INVALID_AUTHORING_ARGUMENT = Symbol('invalidAuthoringArgument');

type ParsedPslLiteral =
  | string
  | number
  | boolean
  | null
  | ParsedPslLiteral[]
  | { [key: string]: ParsedPslLiteral };

function isIdentifierStartCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function parseJsLikeLiteral(value: string): ParsedPslLiteral | typeof INVALID_AUTHORING_ARGUMENT {
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(value[index] ?? '')) {
      index += 1;
    }
  }

  function parseIdentifier(): string | typeof INVALID_AUTHORING_ARGUMENT {
    const first = value[index];
    if (!isIdentifierStartCharacter(first)) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    let end = index + 1;
    while (isIdentifierCharacter(value[end])) {
      end += 1;
    }

    const identifier = value.slice(index, end);
    index = end;
    return identifier;
  }

  function parseString(): string | typeof INVALID_AUTHORING_ARGUMENT {
    const quote = value[index];
    if (quote !== '"' && quote !== "'") {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    let result = '';

    while (index < value.length) {
      const character = value[index];
      index += 1;

      if (character === undefined) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      if (character === quote) {
        return result;
      }

      if (character !== '\\') {
        result += character;
        continue;
      }

      const escaped = value[index];
      index += 1;

      if (escaped === undefined) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      switch (escaped) {
        case "'":
        case '"':
        case '\\':
        case '/':
          result += escaped;
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'u': {
          const hex = value.slice(index, index + 4);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
            return INVALID_AUTHORING_ARGUMENT;
          }
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
          break;
        }
        default:
          return INVALID_AUTHORING_ARGUMENT;
      }
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseNumber(): number | typeof INVALID_AUTHORING_ARGUMENT {
    const match = value.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    const raw = match?.[0];
    if (!raw) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += raw.length;
    return parsed;
  }

  function parseArray(): ParsedPslLiteral[] | typeof INVALID_AUTHORING_ARGUMENT {
    if (value[index] !== '[') {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    const result: ParsedPslLiteral[] = [];

    skipWhitespace();
    if (value[index] === ']') {
      index += 1;
      return result;
    }

    while (index < value.length) {
      const entry = parseValue();
      if (entry === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }
      result.push(entry);

      skipWhitespace();
      if (value[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }
      if (value[index] === ']') {
        index += 1;
        return result;
      }
      return INVALID_AUTHORING_ARGUMENT;
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseObject(): { [key: string]: ParsedPslLiteral } | typeof INVALID_AUTHORING_ARGUMENT {
    if (value[index] !== '{') {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    const result: { [key: string]: ParsedPslLiteral } = {};

    skipWhitespace();
    if (value[index] === '}') {
      index += 1;
      return result;
    }

    while (index < value.length) {
      skipWhitespace();
      const key = value[index] === '"' || value[index] === "'" ? parseString() : parseIdentifier();
      if (key === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      skipWhitespace();
      if (value[index] !== ':') {
        return INVALID_AUTHORING_ARGUMENT;
      }

      index += 1;
      const entry = parseValue();
      if (entry === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }
      result[key] = entry;

      skipWhitespace();
      if (value[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }
      if (value[index] === '}') {
        index += 1;
        return result;
      }
      return INVALID_AUTHORING_ARGUMENT;
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseValue(): ParsedPslLiteral | typeof INVALID_AUTHORING_ARGUMENT {
    skipWhitespace();
    const character = value[index];
    if (character === '{') {
      return parseObject();
    }
    if (character === '[') {
      return parseArray();
    }
    if (character === '"' || character === "'") {
      return parseString();
    }
    if (character === '-' || /\d/.test(character ?? '')) {
      return parseNumber();
    }

    const identifier = parseIdentifier();
    if (identifier === INVALID_AUTHORING_ARGUMENT) {
      return INVALID_AUTHORING_ARGUMENT;
    }
    if (identifier === 'true') {
      return true;
    }
    if (identifier === 'false') {
      return false;
    }
    if (identifier === 'null') {
      return null;
    }
    return INVALID_AUTHORING_ARGUMENT;
  }

  skipWhitespace();
  const parsed = parseValue();
  if (parsed === INVALID_AUTHORING_ARGUMENT) {
    return parsed;
  }

  skipWhitespace();
  return index === value.length ? parsed : INVALID_AUTHORING_ARGUMENT;
}

function parseStringArrayLiteral(
  value: string,
): readonly string[] | typeof INVALID_AUTHORING_ARGUMENT {
  const parsed = parseJsLikeLiteral(value);
  if (parsed === INVALID_AUTHORING_ARGUMENT || !Array.isArray(parsed)) {
    return INVALID_AUTHORING_ARGUMENT;
  }
  if (!parsed.every((item): item is string => typeof item === 'string')) {
    return INVALID_AUTHORING_ARGUMENT;
  }
  return parsed;
}

function parsePslObjectLiteral(
  value: string,
): Record<string, unknown> | typeof INVALID_AUTHORING_ARGUMENT {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return INVALID_AUTHORING_ARGUMENT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = parseJsLikeLiteral(trimmed);
    if (parsed === INVALID_AUTHORING_ARGUMENT) {
      return INVALID_AUTHORING_ARGUMENT;
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return INVALID_AUTHORING_ARGUMENT;
  }

  // Structural narrowing leaves `parsed` as `object`; key-validation in
  // `validateAuthoringArgument` (framework-authoring) enforces the record
  // shape downstream.
  return parsed as Record<string, unknown>;
}

function parsePslAuthoringArgumentValue(
  descriptor: AuthoringArgumentDescriptor,
  rawValue: string,
): unknown | typeof INVALID_AUTHORING_ARGUMENT {
  switch (descriptor.kind) {
    case 'string':
      return unquoteStringLiteral(rawValue);
    case 'number': {
      const parsed = Number(unquoteStringLiteral(rawValue));
      return Number.isNaN(parsed) ? INVALID_AUTHORING_ARGUMENT : parsed;
    }
    case 'stringArray':
      return parseStringArrayLiteral(rawValue);
    case 'object':
      return parsePslObjectLiteral(rawValue);
    default: {
      const _exhaustive: never = descriptor;
      void _exhaustive;
      return INVALID_AUTHORING_ARGUMENT;
    }
  }
}

function pushInvalidPslHelperArgument(input: {
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly entityLabel: string;
  readonly helperLabel: string;
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: `${input.entityLabel} ${input.helperLabel} ${input.message}`,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

function mapPslHelperArgs(input: {
  readonly args: readonly PslAttributeArgument[];
  readonly descriptors: readonly AuthoringArgumentDescriptor[];
  readonly helperLabel: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}): readonly unknown[] | undefined {
  const mappedArgs: unknown[] = input.descriptors.map(() => undefined);

  const positionalArgs = input.args.filter((arg) => arg.kind === 'positional');
  const namedArgs = input.args.filter((arg) => arg.kind === 'named');

  if (positionalArgs.length > input.descriptors.length) {
    return pushInvalidPslHelperArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.span,
      entityLabel: input.entityLabel,
      helperLabel: input.helperLabel,
      message: `accepts at most ${input.descriptors.length} argument(s), received ${positionalArgs.length}.`,
    });
  }

  for (const [index, argument] of positionalArgs.entries()) {
    const descriptor = input.descriptors[index];
    if (!descriptor) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `does not define positional argument #${index + 1}.`,
      });
    }

    const value = parsePslAuthoringArgumentValue(descriptor, argument.value);
    if (value === INVALID_AUTHORING_ARGUMENT) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `cannot parse argument #${index + 1} for descriptor kind "${descriptor.kind}".`,
      });
    }

    mappedArgs[index] = value;
  }

  for (const argument of namedArgs) {
    const descriptorIndex = input.descriptors.findIndex(
      (descriptor) => descriptor.name === argument.name,
    );
    if (descriptorIndex < 0) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `received unknown named argument "${argument.name}".`,
      });
    }

    if (mappedArgs[descriptorIndex] !== undefined) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `received duplicate value for argument "${argument.name}".`,
      });
    }

    const descriptor = input.descriptors[descriptorIndex];
    if (!descriptor) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `does not define named argument "${argument.name}".`,
      });
    }

    const value = parsePslAuthoringArgumentValue(descriptor, argument.value);
    if (value === INVALID_AUTHORING_ARGUMENT) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `cannot parse named argument "${argument.name}" for descriptor kind "${descriptor.kind}".`,
      });
    }

    mappedArgs[descriptorIndex] = value;
  }

  return mappedArgs;
}

export function instantiatePslTypeConstructor(input: {
  readonly call: PslTypeConstructorCall;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}):
  | {
      readonly codecId: string;
      readonly nativeType: string;
      readonly typeParams?: Record<string, unknown>;
    }
  | undefined {
  const helperPath = input.call.path.join('.');
  const args = mapPslHelperArgs({
    args: input.call.args,
    descriptors: input.descriptor.args ?? [],
    helperLabel: `constructor "${helperPath}"`,
    span: input.call.span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
    entityLabel: input.entityLabel,
  });
  if (!args) {
    return undefined;
  }

  try {
    validateAuthoringHelperArguments(helperPath, input.descriptor.args, args);
    return instantiateAuthoringTypeConstructor(input.descriptor, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} constructor "${helperPath}" ${message}`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return undefined;
  }
}

function pushUnsupportedTypeConstructorDiagnostic(input: {
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly code: 'PSL_UNSUPPORTED_FIELD_TYPE' | 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR';
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: input.code,
    message: input.message,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

export function resolvePslTypeConstructorDescriptor(input: {
  readonly call: PslTypeConstructorCall;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly unsupportedCode: 'PSL_UNSUPPORTED_FIELD_TYPE' | 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR';
  readonly unsupportedMessage: string;
}): AuthoringTypeConstructorDescriptor | undefined {
  const descriptor = getAuthoringTypeConstructor(input.authoringContributions, input.call.path);
  if (descriptor) {
    return descriptor;
  }

  const namespace = input.call.path.length > 1 ? input.call.path[0] : undefined;
  if (
    namespace &&
    namespace !== 'db' &&
    namespace !== input.familyId &&
    namespace !== input.targetId &&
    !input.composedExtensions.has(namespace)
  ) {
    reportUncomposedNamespace({
      subjectLabel: `Type constructor "${input.call.path.join('.')}"`,
      namespace,
      sourceId: input.sourceId,
      span: input.call.span,
      diagnostics: input.diagnostics,
    });
    return undefined;
  }

  return pushUnsupportedTypeConstructorDiagnostic({
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
    span: input.call.span,
    code: input.unsupportedCode,
    message: input.unsupportedMessage,
  });
}

export type ResolveFieldTypeResult =
  | { readonly ok: true; readonly descriptor: ColumnDescriptor }
  | { readonly ok: false; readonly alreadyReported: boolean };

export function resolveFieldTypeDescriptor(input: {
  readonly field: PslField;
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}): ResolveFieldTypeResult {
  if (input.field.typeConstructor) {
    const helperPath = input.field.typeConstructor.path.join('.');
    const descriptor = resolvePslTypeConstructorDescriptor({
      call: input.field.typeConstructor,
      authoringContributions: input.authoringContributions,
      composedExtensions: input.composedExtensions,
      familyId: input.familyId,
      targetId: input.targetId,
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      unsupportedCode: 'PSL_UNSUPPORTED_FIELD_TYPE',
      unsupportedMessage: `${input.entityLabel} type constructor "${helperPath}" is not supported in SQL PSL provider v1`,
    });
    if (!descriptor) {
      return { ok: false, alreadyReported: true };
    }

    const instantiated = instantiatePslTypeConstructor({
      call: input.field.typeConstructor,
      descriptor,
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      entityLabel: input.entityLabel,
    });
    if (!instantiated) {
      return { ok: false, alreadyReported: true };
    }
    return { ok: true, descriptor: instantiated };
  }

  const descriptor = resolveColumnDescriptor(
    input.field,
    input.enumTypeDescriptors,
    input.namedTypeDescriptors,
    input.scalarTypeDescriptors,
  );
  if (!descriptor) {
    return { ok: false, alreadyReported: false };
  }
  return { ok: true, descriptor };
}

/**
 * Declarative specification for @db.* native type attributes.
 *
 * Argument kinds:
 * - `noArgs`: No arguments accepted; `codecId: null` means inherit from baseDescriptor.
 * - `optionalLength`: Zero or one positional integer (minimum 1), stored as `{ length }`.
 * - `optionalPrecision`: Zero or one positional integer (minimum 0), stored as `{ precision }`.
 * - `optionalNumeric`: Zero, one, or two positional integers (precision + scale).
 */
export type NativeTypeSpec =
  | {
      readonly args: 'noArgs';
      readonly baseType: string;
      readonly codecId: string | null;
      readonly nativeType: string;
    }
  | {
      readonly args: 'optionalLength';
      readonly baseType: string;
      readonly codecId: string;
      readonly nativeType: string;
    }
  | {
      readonly args: 'optionalPrecision';
      readonly baseType: string;
      readonly codecId: string;
      readonly nativeType: string;
    }
  | {
      readonly args: 'optionalNumeric';
      readonly baseType: string;
      readonly codecId: string;
      readonly nativeType: string;
    };

export const NATIVE_TYPE_SPECS: Readonly<Record<string, NativeTypeSpec>> = {
  'db.VarChar': {
    args: 'optionalLength',
    baseType: 'String',
    codecId: 'sql/varchar@1',
    nativeType: 'character varying',
  },
  'db.Char': {
    args: 'optionalLength',
    baseType: 'String',
    codecId: 'sql/char@1',
    nativeType: 'character',
  },
  'db.Uuid': { args: 'noArgs', baseType: 'String', codecId: null, nativeType: 'uuid' },
  'db.SmallInt': { args: 'noArgs', baseType: 'Int', codecId: 'pg/int2@1', nativeType: 'int2' },
  'db.Real': { args: 'noArgs', baseType: 'Float', codecId: 'pg/float4@1', nativeType: 'float4' },
  'db.Numeric': {
    args: 'optionalNumeric',
    baseType: 'Decimal',
    codecId: 'pg/numeric@1',
    nativeType: 'numeric',
  },
  'db.Timestamp': {
    args: 'optionalPrecision',
    baseType: 'DateTime',
    codecId: 'pg/timestamp@1',
    nativeType: 'timestamp',
  },
  'db.Timestamptz': {
    args: 'optionalPrecision',
    baseType: 'DateTime',
    codecId: 'pg/timestamptz@1',
    nativeType: 'timestamptz',
  },
  'db.Date': { args: 'noArgs', baseType: 'DateTime', codecId: null, nativeType: 'date' },
  'db.Time': {
    args: 'optionalPrecision',
    baseType: 'DateTime',
    codecId: 'pg/time@1',
    nativeType: 'time',
  },
  'db.Timetz': {
    args: 'optionalPrecision',
    baseType: 'DateTime',
    codecId: 'pg/timetz@1',
    nativeType: 'timetz',
  },
  'db.Json': { args: 'noArgs', baseType: 'Json', codecId: 'pg/json@1', nativeType: 'json' },
};

export function resolveDbNativeTypeAttribute(input: {
  readonly attribute: PslAttribute;
  readonly baseType: string;
  readonly baseDescriptor: ColumnDescriptor;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}): ColumnDescriptor | undefined {
  const spec = NATIVE_TYPE_SPECS[input.attribute.name];
  if (!spec) {
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
      message: `${input.entityLabel} uses unsupported attribute "@${input.attribute.name}"`,
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }

  if (input.baseType !== spec.baseType) {
    return pushInvalidAttributeArgument({
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      span: input.attribute.span,
      message: `${input.entityLabel} uses @${input.attribute.name} on unsupported base type "${input.baseType}". Expected "${spec.baseType}".`,
    });
  }

  switch (spec.args) {
    case 'noArgs': {
      if (getPositionalArguments(input.attribute).length > 0 || input.attribute.args.length > 0) {
        return pushInvalidAttributeArgument({
          diagnostics: input.diagnostics,
          sourceId: input.sourceId,
          span: input.attribute.span,
          message: `${input.entityLabel} @${input.attribute.name} does not accept arguments.`,
        });
      }
      return {
        codecId: spec.codecId ?? input.baseDescriptor.codecId,
        nativeType: spec.nativeType,
      };
    }
    case 'optionalLength': {
      const length = parseOptionalSingleIntegerArgument({
        attribute: input.attribute,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: input.entityLabel,
        minimum: 1,
        valueLabel: 'positive integer length',
      });
      if (length === undefined) {
        return undefined;
      }
      return {
        codecId: spec.codecId,
        nativeType: spec.nativeType,
        ...(length === null ? {} : { typeParams: { length } }),
      };
    }
    case 'optionalPrecision': {
      const precision = parseOptionalSingleIntegerArgument({
        attribute: input.attribute,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: input.entityLabel,
        minimum: 0,
        valueLabel: 'non-negative integer precision',
      });
      if (precision === undefined) {
        return undefined;
      }
      return {
        codecId: spec.codecId,
        nativeType: spec.nativeType,
        ...(precision === null ? {} : { typeParams: { precision } }),
      };
    }
    case 'optionalNumeric': {
      const numeric = parseOptionalNumericArguments({
        attribute: input.attribute,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: input.entityLabel,
      });
      if (numeric === undefined) {
        return undefined;
      }
      return {
        codecId: spec.codecId,
        nativeType: spec.nativeType,
        ...(numeric === null ? {} : { typeParams: numeric }),
      };
    }
  }
}

export function parseDefaultLiteralValue(expression: string): ColumnDefault | undefined {
  const trimmed = expression.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return { kind: 'literal', value: trimmed === 'true' };
  }
  const numericValue = Number(trimmed);
  if (!Number.isNaN(numericValue) && trimmed.length > 0 && !/^(['"]).*\1$/.test(trimmed)) {
    return { kind: 'literal', value: numericValue };
  }
  if (/^(['"]).*\1$/.test(trimmed)) {
    return { kind: 'literal', value: unquoteStringLiteral(trimmed) };
  }
  return undefined;
}

export function lowerDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly defaultAttribute: PslAttribute;
  readonly columnDescriptor: ColumnDescriptor;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly sourceId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly defaultValue?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
} {
  const positionalEntries = input.defaultAttribute.args.filter((arg) => arg.kind === 'positional');
  const namedEntries = input.defaultAttribute.args.filter((arg) => arg.kind === 'named');

  if (namedEntries.length > 0 || positionalEntries.length !== 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: `Field "${input.modelName}.${input.fieldName}" requires exactly one positional @default(...) expression.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const expressionEntry = getPositionalArgumentEntry(input.defaultAttribute);
  if (!expressionEntry) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: `Field "${input.modelName}.${input.fieldName}" requires a positional @default(...) expression.`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const literalDefault = parseDefaultLiteralValue(expressionEntry.value);
  if (literalDefault) {
    return { defaultValue: literalDefault };
  }

  const defaultFunctionCall = parseDefaultFunctionCall(expressionEntry.value, expressionEntry.span);
  if (!defaultFunctionCall) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_VALUE',
      message: `Unsupported default value "${expressionEntry.value}"`,
      sourceId: input.sourceId,
      span: input.defaultAttribute.span,
    });
    return {};
  }

  const lowered = lowerDefaultFunctionWithRegistry({
    call: defaultFunctionCall,
    registry: input.defaultFunctionRegistry,
    context: {
      sourceId: input.sourceId,
      modelName: input.modelName,
      fieldName: input.fieldName,
      columnCodecId: input.columnDescriptor.codecId,
    },
  });

  if (!lowered.ok) {
    input.diagnostics.push(lowered.diagnostic);
    return {};
  }

  if (lowered.value.kind === 'storage') {
    return { defaultValue: lowered.value.defaultValue };
  }

  const generatorDescriptor = input.generatorDescriptorById.get(lowered.value.generated.id);
  if (!generatorDescriptor) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
      message: `Default generator "${lowered.value.generated.id}" is not available in the composed mutation default registry.`,
      sourceId: input.sourceId,
      span: expressionEntry.span,
    });
    return {};
  }

  if (!generatorDescriptor.applicableCodecIds.includes(input.columnDescriptor.codecId)) {
    input.diagnostics.push({
      code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
      message: `Default generator "${generatorDescriptor.id}" is not applicable to "${input.modelName}.${input.fieldName}" with codecId "${input.columnDescriptor.codecId}".`,
      sourceId: input.sourceId,
      span: expressionEntry.span,
    });
    return {};
  }

  return { executionDefault: lowered.value.generated };
}

export function resolveColumnDescriptor(
  field: PslField,
  enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
  namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
  scalarTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
): ColumnDescriptor | undefined {
  if (field.typeRef && namedTypeDescriptors.has(field.typeRef)) {
    return namedTypeDescriptors.get(field.typeRef);
  }
  if (namedTypeDescriptors.has(field.typeName)) {
    return namedTypeDescriptors.get(field.typeName);
  }
  if (enumTypeDescriptors.has(field.typeName)) {
    return enumTypeDescriptors.get(field.typeName);
  }
  return scalarTypeDescriptors.get(field.typeName);
}
