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
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression },
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
  // Keyed by the full `@db.*` attribute name, not a PSL base type — every
  // other entry above answers "what's the codec for a bare `DateTime`
  // field", but `@db.Date`'s own codec (`pg/date@1`) is deliberately
  // different from its `DateTime` base's (`pg/timestamptz@1`), so it can't
  // reuse that lookup. contract-psl's `resolveDbNativeTypeAttribute`
  // consults this same map by attribute name for a `noArgs` spec whose
  // `codecId` is `null`, keeping the concrete `pg/date@1` id out of 2-sql.
  ['db.Date', 'pg/date@1'],
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
