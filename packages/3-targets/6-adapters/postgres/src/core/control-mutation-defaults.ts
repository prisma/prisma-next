import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import { timestampNowControlDescriptor } from '@prisma-next/family-sql/control';
import type {
  ControlMutationDefaultEntry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  MutationDefaultGeneratorDescriptor,
  TypedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';
import {
  builtinGeneratorRegistryMetadata,
  resolveBuiltinGeneratedColumnDescriptor,
} from '@prisma-next/ids';
import type { FuncCallSig } from '@prisma-next/psl-parser';
import { int, num, oneOf, optional, str } from '@prisma-next/psl-parser';
import { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: TypedDefaultFunctionCall['span'];
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

function lowerAutoincrement(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'autoincrement()' },
    },
  };
}

function lowerNow(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'now()' },
    },
  };
}

function lowerUlid(): LoweredDefaultResult {
  return executionGenerator('ulid');
}

function lowerUuid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  return input.call.args['version'] === 7
    ? executionGenerator('uuidv7')
    : executionGenerator('uuidv4');
}

function lowerCuid(): LoweredDefaultResult {
  return executionGenerator('cuid2');
}

function lowerNanoid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const size = input.call.args['size'];
  return typeof size === 'number'
    ? executionGenerator('nanoid', { size })
    : executionGenerator('nanoid');
}

function lowerDbgenerated(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const expression = input.call.args['expression'];
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  // Resolve the raw SQL text through the same normalizer introspection uses,
  // so a `dbgenerated(...)` default that is actually a literal (e.g.
  // `'{}'::jsonb`) is recognized as one here too. Without this, the two
  // sides disagree on `kind` and `resolvedDefaultsEqual` reports drift
  // forever even when the database matches the contract exactly. Anything
  // the normalizer doesn't recognize as a literal falls through to its own
  // `kind: 'function'` fallback, which preserves the raw expression text.
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: parsePostgresDefault(expression, input.context.nativeType) ?? {
        kind: 'function',
        expression,
      },
    },
  };
}

const nowSig: FuncCallSig = {};
const autoincrementSig: FuncCallSig = {};
const ulidSig: FuncCallSig = {};
const uuidSig: FuncCallSig = {
  positional: [{ key: 'version', type: optional(oneOf(num(4), num(7))) }],
};
const cuidSig: FuncCallSig = { positional: [{ key: 'version', type: num(2) }] };
const nanoidSig: FuncCallSig = {
  positional: [{ key: 'size', type: optional(int({ min: 2, max: 255 })) }],
};
const dbgeneratedSig: FuncCallSig = { positional: [{ key: 'expression', type: str() }] };

const postgresDefaultFunctionRegistryEntries = [
  [
    'autoincrement',
    {
      signature: autoincrementSig,
      lower: lowerAutoincrement,
      usageSignatures: ['autoincrement()'],
    },
  ],
  ['now', { signature: nowSig, lower: lowerNow, usageSignatures: ['now()'] }],
  [
    'uuid',
    { signature: uuidSig, lower: lowerUuid, usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'] },
  ],
  ['cuid', { signature: cuidSig, lower: lowerCuid, usageSignatures: ['cuid(2)'] }],
  ['ulid', { signature: ulidSig, lower: lowerUlid, usageSignatures: ['ulid()'] }],
  [
    'nanoid',
    { signature: nanoidSig, lower: lowerNanoid, usageSignatures: ['nanoid()', 'nanoid(<2-255>)'] },
  ],
  [
    'dbgenerated',
    { signature: dbgeneratedSig, lower: lowerDbgenerated, usageSignatures: ['dbgenerated("...")'] },
  ],
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
  return [
    ...builtinGeneratorRegistryMetadata.map(
      ({ id, applicableCodecIds }): MutationDefaultGeneratorDescriptor => ({
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
      }),
    ),
    timestampNowControlDescriptor(),
  ];
}

export function createPostgresScalarTypeDescriptors(): ReadonlyMap<string, string> {
  return new Map(postgresScalarTypeDescriptors);
}
