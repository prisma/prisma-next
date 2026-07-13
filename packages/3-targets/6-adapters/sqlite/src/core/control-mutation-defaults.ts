import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import { timestampNowControlDescriptor } from '@prisma-next/family-sql/control';
import type {
  ControlMutationDefaultEntry,
  MutationDefaultGeneratorDescriptor,
  TypedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';
import {
  builtinGeneratorRegistryMetadata,
  resolveBuiltinGeneratedColumnDescriptor,
} from '@prisma-next/ids';
import type { FuncCallSig } from '@prisma-next/psl-parser';
import { int, num, oneOf, optional, str } from '@prisma-next/psl-parser';
import type {
  DefaultFunctionLoweringContext,
  DefaultFunctionLoweringHandler,
} from '@prisma-next/sql-contract-psl';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '@prisma-next/target-sqlite/codec-ids';

type LoweredDefaultResult = ReturnType<DefaultFunctionLoweringHandler>;

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

/**
 * SQLite spellings that all denote the same wall-clock-now value. Anything
 * matching this set when passed through `dbgenerated("...")` is rewritten
 * to the canonical `now()` form before entering the contract — symmetric
 * with `parseSqliteDefault` on the introspection side, so the verifier
 * compares canonical-vs-canonical and a contract using
 * `dbgenerated("CURRENT_TIMESTAMP")` doesn't drift against the schema it
 * just produced.
 */
const NOW_SYNONYMS = new Set(['current_timestamp', "datetime('now')", 'datetime("now")', 'now()']);

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
  const raw = input.call.args['expression'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  const trimmed = raw.trim();
  const expression = NOW_SYNONYMS.has(trimmed.toLowerCase()) ? 'now()' : trimmed;
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

const sqliteDefaultFunctionRegistryEntries = [
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

const sqliteScalarTypeDescriptors = new Map<string, string>([
  ['String', SQLITE_TEXT_CODEC_ID],
  ['Int', SQLITE_INTEGER_CODEC_ID],
  ['BigInt', SQLITE_BIGINT_CODEC_ID],
  ['Float', SQLITE_REAL_CODEC_ID],
  ['Decimal', SQLITE_TEXT_CODEC_ID],
  ['DateTime', SQLITE_DATETIME_CODEC_ID],
  ['Json', SQLITE_JSON_CODEC_ID],
  ['Bytes', SQLITE_BLOB_CODEC_ID],
]);

export function createSqliteDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(sqliteDefaultFunctionRegistryEntries);
}

export function createSqliteMutationDefaultGeneratorDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
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

export function createSqliteScalarTypeDescriptors(): ReadonlyMap<string, string> {
  return new Map(sqliteScalarTypeDescriptors);
}
