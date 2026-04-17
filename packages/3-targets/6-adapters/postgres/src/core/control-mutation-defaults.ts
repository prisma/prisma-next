import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  ControlMutationDefaultEntry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  MutationDefaultGeneratorDescriptor,
  ParsedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';
import {
  builtinGeneratorRegistryMetadata,
  resolveBuiltinGeneratedColumnDescriptor,
} from '@prisma-next/ids';

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: ParsedDefaultFunctionCall['span'];
  readonly message: string;
}): LoweredDefaultResult {
  return {
    ok: false,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(
  id: ExecutionMutationDefaultValue['id'],
  params?: Record<string, unknown>,
): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

function expectNoArgs(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
  readonly usage: string;
}): LoweredDefaultResult | undefined {
  if (input.call.args.length === 0) {
    return undefined;
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.span,
    message: `Default function "${input.call.name}" does not accept arguments. Use ${input.usage}.`,
  });
}

function parseIntegerArgument(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function parseStringLiteral(raw: string): string | undefined {
  const match = raw.trim().match(/^(['"])(.*)\1$/s);
  if (!match) {
    return undefined;
  }
  return match[2] ?? '';
}

function lowerAutoincrement(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`autoincrement()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: 'autoincrement()',
      },
    },
  };
}

function lowerNow(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`now()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: 'now()',
      },
    },
  };
}

function lowerUuid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return executionGenerator('uuidv4');
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "uuid" accepts at most one version argument: `uuid()`, `uuid(4)`, or `uuid(7)`.',
    });
  }
  const version = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (version === 4) {
    return executionGenerator('uuidv4');
  }
  if (version === 7) {
    return executionGenerator('uuidv7');
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message:
      'Default function "uuid" supports only `uuid()`, `uuid(4)`, or `uuid(7)` in SQL PSL provider v1.',
  });
}

function lowerCuid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
        message:
          'Default function "cuid()" is not supported in SQL PSL provider v1. Use `cuid(2)` instead.',
        sourceId: input.context.sourceId,
        span: input.call.span,
      },
    };
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "cuid" accepts exactly one version argument: `cuid(2)`.',
    });
  }
  const version = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (version === 2) {
    return executionGenerator('cuid2');
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message: 'Default function "cuid" supports only `cuid(2)` in SQL PSL provider v1.',
  });
}

function lowerUlid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const maybeNoArgs = expectNoArgs({
    call: input.call,
    context: input.context,
    usage: '`ulid()`',
  });
  if (maybeNoArgs) {
    return maybeNoArgs;
  }
  return executionGenerator('ulid');
}

function lowerNanoid(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length === 0) {
    return executionGenerator('nanoid');
  }
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "nanoid" accepts at most one size argument: `nanoid()` or `nanoid(<2-255>)`.',
    });
  }
  const size = parseIntegerArgument(input.call.args[0]?.raw ?? '');
  if (size !== undefined && size >= 2 && size <= 255) {
    return executionGenerator('nanoid', { size });
  }
  return invalidArgumentDiagnostic({
    context: input.context,
    span: input.call.args[0]?.span ?? input.call.span,
    message: 'Default function "nanoid" size argument must be an integer between 2 and 255.',
  });
}

function lowerDbgenerated(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  if (input.call.args.length !== 1) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message:
        'Default function "dbgenerated" requires exactly one string argument: `dbgenerated("...")`.',
    });
  }
  const rawExpression = parseStringLiteral(input.call.args[0]?.raw ?? '');
  if (rawExpression === undefined) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.args[0]?.span ?? input.call.span,
      message: 'Default function "dbgenerated" argument must be a string literal.',
    });
  }
  if (rawExpression.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.args[0]?.span ?? input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: {
        kind: 'function',
        expression: rawExpression,
      },
    },
  };
}

const postgresDefaultFunctionRegistryEntries = [
  ['autoincrement', { lower: lowerAutoincrement, usageSignatures: ['autoincrement()'] }],
  ['now', { lower: lowerNow, usageSignatures: ['now()'] }],
  ['uuid', { lower: lowerUuid, usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'] }],
  ['cuid', { lower: lowerCuid, usageSignatures: ['cuid(2)'] }],
  ['ulid', { lower: lowerUlid, usageSignatures: ['ulid()'] }],
  ['nanoid', { lower: lowerNanoid, usageSignatures: ['nanoid()', 'nanoid(<2-255>)'] }],
  ['dbgenerated', { lower: lowerDbgenerated, usageSignatures: ['dbgenerated("...")'] }],
] satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

const postgresScalarTypeDescriptors = new Map<string, string>([
  ['String', 'pg/text@1'],
  ['Boolean', 'pg/bool@1'],
  ['Int', 'pg/int4@1'],
  ['BigInt', 'pg/int8@1'],
  ['Float', 'pg/float8@1'],
  ['Decimal', 'pg/numeric@1'],
  ['DateTime', 'pg/timestamptz@1'],
  ['Json', 'pg/jsonb@1'],
  ['Bytes', 'pg/bytea@1'],
]);

export function createPostgresDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(postgresDefaultFunctionRegistryEntries);
}

export function createPostgresMutationDefaultGeneratorDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return builtinGeneratorRegistryMetadata.map(({ id, applicableCodecIds }) => ({
    id,
    applicableCodecIds,
    resolveGeneratedColumnDescriptor: ({ generated }) => {
      if (generated.kind !== 'generator' || generated.id !== id) {
        return undefined;
      }
      const descriptor = resolveBuiltinGeneratedColumnDescriptor({
        id,
        ...(generated.params ? { params: generated.params } : {}),
      });
      return {
        codecId: descriptor.type.codecId,
        nativeType: descriptor.type.nativeType,
        ...(descriptor.type.typeRef ? { typeRef: descriptor.type.typeRef } : {}),
        ...(descriptor.typeParams ? { typeParams: descriptor.typeParams } : {}),
      };
    },
  }));
}

export function createPostgresScalarTypeDescriptors(): ReadonlyMap<string, string> {
  return new Map(postgresScalarTypeDescriptors);
}
