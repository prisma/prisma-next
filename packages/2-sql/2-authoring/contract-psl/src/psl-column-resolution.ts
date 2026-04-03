import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  AuthoringContributions,
  AuthoringTypeConstructorDescriptor,
} from '@prisma-next/framework-components/authoring';
import { isAuthoringTypeConstructorDescriptor } from '@prisma-next/framework-components/authoring';
import type { PslAttribute, PslField } from '@prisma-next/psl-parser';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from './default-function-registry';
import {
  lowerDefaultFunctionWithRegistry,
  parseDefaultFunctionCall,
} from './default-function-registry';
import {
  getNamedArgument,
  getPositionalArgument,
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

export function parsePgvectorLength(input: {
  readonly attribute: PslAttribute;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}): number | undefined {
  const namedLength = getNamedArgument(input.attribute, 'length');
  const namedDim = getNamedArgument(input.attribute, 'dim');
  const positional = getPositionalArgument(input.attribute);
  const raw = namedLength ?? namedDim ?? positional;
  if (!raw) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: '@pgvector.column requires length/dim argument',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  const parsed = Number(unquoteStringLiteral(raw));
  if (!Number.isInteger(parsed) || parsed < 1) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: '@pgvector.column length/dim must be a positive integer',
      sourceId: input.sourceId,
      span: input.attribute.span,
    });
    return undefined;
  }
  return parsed;
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
  enumTypeDescriptors: Map<string, ColumnDescriptor>,
  namedTypeDescriptors: Map<string, ColumnDescriptor>,
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
