import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@prisma-next/config/config-types';
import type { Contract, JsonValue } from '@prisma-next/contract/types';
import {
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
} from '@prisma-next/contract/types';
import {
  type AuthoringContributions,
  type AuthoringEntityContext,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type AuthoringTypeNamespace,
  type PslExtensionBlock,
  resolveEnumCodecId,
} from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
  DefaultFunctionLoweringContext,
  TypedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';
import type { FuncCallSig, SymbolTable } from '@prisma-next/psl-parser';
import {
  buildSymbolTable,
  int,
  num,
  oneOf,
  optional,
  rangeToPslSpan,
  str,
} from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@prisma-next/sql-contract/types';
import { type EnumTypeHandle, enumType } from '@prisma-next/sql-contract-ts/contract-builder';
import { blindCast } from '@prisma-next/utils/casts';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';

function testEnumFactory(
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): EnumTypeHandle | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const resolved = resolveEnumCodecId(block, ctx);
  if (resolved === undefined) {
    return undefined;
  }
  const { codecId, codecSpan } = resolved;

  const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
  if (nativeType === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
      sourceId,
      span: codecSpan,
    });
    return undefined;
  }

  const codec = ctx.codecLookup?.get(codecId);
  if (codec === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type codec "${codecId}" resolves in targetTypesFor but is absent from codecLookup.get`,
      sourceId,
      span: codecSpan,
    });
    return undefined;
  }
  const members: { name: string; value: unknown }[] = [];
  let memberError = false;
  const seenValues = new Set<string>();

  for (const [memberName, paramValue] of Object.entries(block.parameters)) {
    let value: unknown;
    if (paramValue.kind === 'bare') {
      try {
        value = codec.decodeJson(memberName as unknown as JsonValue);
      } catch {
        diagnostics?.push({
          code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
          message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
    } else if (paramValue.kind === 'value') {
      let jsonValue: unknown;
      try {
        jsonValue = JSON.parse(paramValue.raw);
      } catch {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
      try {
        value = codec.decodeJson(
          blindCast<JsonValue, 'JSON.parse returns JsonValue-compatible value'>(jsonValue),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${reason}`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
    } else {
      continue;
    }
    const valueKey = String(value);
    if (seenValues.has(valueKey)) {
      diagnostics?.push({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: `enum "${block.name}": duplicate member value "${valueKey}"`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    seenValues.add(valueKey);
    members.push({ name: memberName, value });
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  return enumType(
    block.name,
    { codecId, nativeType },
    ...members.map((m) => ({ name: m.name, value: m.value })),
  );
}

export const testEnumEntityContributions = {
  enum: {
    kind: 'entity' as const,
    discriminator: 'enum',
    output: { factory: testEnumFactory },
  },
} as const satisfies AuthoringEntityTypeNamespace;

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: TypedDefaultFunctionCall['span'];
  readonly message: string;
}) {
  return {
    ok: false as const,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(id: string, params?: Record<string, unknown>) {
  return {
    ok: true as const,
    value: {
      kind: 'execution' as const,
      generated: {
        kind: 'generator' as const,
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

export const postgresEnumInferenceCodecs = {
  text: 'pg/text@1',
  int: 'pg/int@1',
} as const;

export const sqliteEnumInferenceCodecs = {
  text: 'sqlite/text@1',
  int: 'sqlite/integer@1',
} as const;

export const postgresTarget: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

export const sqliteTarget: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: '__unbound__',
};

export const pgvectorExtensionPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'pgvector',
  version: '1.2.3-test',
};

export const postgresScalarTypeDescriptors = new Map([
  ['String', { codecId: 'pg/text@1', nativeType: 'text', baseScalar: true }],
  ['Boolean', { codecId: 'pg/bool@1', nativeType: 'bool', baseScalar: true }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4', baseScalar: true }],
  ['BigInt', { codecId: 'pg/int8@1', nativeType: 'int8', baseScalar: true }],
  ['Float', { codecId: 'pg/float8@1', nativeType: 'float8', baseScalar: true }],
  ['Decimal', { codecId: 'pg/numeric@1', nativeType: 'numeric', baseScalar: true }],
  ['DateTime', { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz', baseScalar: true }],
  ['Json', { codecId: 'pg/json@1', nativeType: 'json', baseScalar: true }],
  ['Jsonb', { codecId: 'pg/jsonb@1', nativeType: 'jsonb', baseScalar: true }],
  ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea', baseScalar: true }],
] as const);

/** The postgres base scalars in unified-namespace form: top-level zero-arg baseScalar-marked type constructors. */
export const postgresScalarAuthoringTypes: AuthoringTypeNamespace = Object.fromEntries(
  [...postgresScalarTypeDescriptors].map(([name, { codecId, nativeType }]) => [
    name,
    {
      kind: 'typeConstructor' as const,
      baseScalar: true as const,
      output: { codecId, nativeType },
    },
  ]),
);

/**
 * Controlled test-only descriptor — intentionally uses pg/vector@1 with maximum: 2000 rather than importing the real pgvector pack, so interpreter unit tests stay layer-isolated. Real-pack parity is covered by `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`.
 */
export const pgvectorAuthoringContributions = {
  entityTypes: {},
  field: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: {
    ...postgresScalarAuthoringTypes,
    pgvector: {
      Vector: {
        kind: 'typeConstructor',
        args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
        output: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: {
            length: { kind: 'arg', index: 0 },
          },
        },
      },
    },
  },
} satisfies AuthoringContributions;

export function buildSymbolTableInput(
  schema: string,
  options?: {
    readonly sourceId?: string;
    readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  },
): {
  symbolTable: SymbolTable;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  const sourceId = options?.sourceId ?? 'schema.prisma';
  const pslBlockDescriptors = options?.pslBlockDescriptors ?? {};
  const { document, sourceFile } = parse(schema);
  const { table, diagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors,
  });
  const seedDiagnostics: ContractSourceDiagnostic[] = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
  return {
    symbolTable: table,
    sourceFile,
    sourceId,
    seedDiagnostics,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
  };
}

export function symbolTableInputFromParseArgs(args: {
  readonly schema: string;
  readonly sourceId?: string;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
}): {
  symbolTable: SymbolTable;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  return buildSymbolTableInput(args.schema, {
    ...(args.sourceId !== undefined ? { sourceId: args.sourceId } : {}),
    ...(args.pslBlockDescriptors !== undefined
      ? { pslBlockDescriptors: args.pslBlockDescriptors }
      : {}),
  });
}

export const sqliteScalarColumnDescriptors = new Map([
  ['String', { codecId: 'sqlite/text@1', nativeType: 'text', baseScalar: true }],
  ['Boolean', { codecId: 'sqlite/integer@1', nativeType: 'integer', baseScalar: true }],
  ['Int', { codecId: 'sqlite/integer@1', nativeType: 'integer', baseScalar: true }],
  ['BigInt', { codecId: 'sqlite/bigint@1', nativeType: 'integer', baseScalar: true }],
  ['Float', { codecId: 'sqlite/real@1', nativeType: 'real', baseScalar: true }],
  ['Decimal', { codecId: 'sqlite/text@1', nativeType: 'text', baseScalar: true }],
  ['DateTime', { codecId: 'sqlite/datetime@1', nativeType: 'text', baseScalar: true }],
  ['Json', { codecId: 'sqlite/json@1', nativeType: 'text', baseScalar: true }],
  ['Bytes', { codecId: 'sqlite/blob@1', nativeType: 'blob', baseScalar: true }],
] as const);

const targetTypesByCodecId: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/int@1': ['int4'],
  'pg/bool@1': ['bool'],
  'pg/int4@1': ['int4'],
  'pg/int8@1': ['int8'],
  'pg/float8@1': ['float8'],
  'pg/numeric@1': ['numeric'],
  'pg/timestamptz@1': ['timestamptz'],
  'pg/jsonb@1': ['jsonb'],
  'pg/bytea@1': ['bytea'],
  'sql/char@1': ['character'],
  'sql/varchar@1': ['character varying'],
  'pg/int2@1': ['int2'],
  'pg/float4@1': ['float4'],
  'pg/timestamp@1': ['timestamp'],
  'pg/time@1': ['time'],
  'pg/timetz@1': ['timetz'],
  'pg/json@1': ['json'],
  'pg/vector@1': ['vector'],
};

export const postgresCodecLookup: CodecLookup = {
  get: (id: string) => {
    if (!targetTypesByCodecId[id]) return undefined;
    return { id } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => targetTypesByCodecId[id],
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

export function createPostgresTestContext(
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensionPacks: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      field: {},
      type: postgresScalarAuthoringTypes,
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
    },
    codecLookup: postgresCodecLookup,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    resolvedInputs: [],
    capabilities: { sql: { scalarList: true } },
    ...overrides,
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

export function createBuiltinLikeControlMutationDefaults(): ControlMutationDefaults {
  return {
    defaultFunctionRegistry: new Map<string, ControlMutationDefaultEntry>([
      [
        'autoincrement',
        {
          signature: autoincrementSig,
          lower: () => ({
            ok: true as const,
            value: {
              kind: 'storage' as const,
              defaultValue: { kind: 'function' as const, expression: 'autoincrement()' },
            },
          }),
          usageSignatures: ['autoincrement()'],
        },
      ],
      [
        'now',
        {
          signature: nowSig,
          lower: () => ({
            ok: true as const,
            value: {
              kind: 'storage' as const,
              defaultValue: { kind: 'function' as const, expression: 'now()' },
            },
          }),
          usageSignatures: ['now()'],
        },
      ],
      [
        'uuid',
        {
          signature: uuidSig,
          lower: ({ call }) =>
            call.args['version'] === 7
              ? executionGenerator('uuidv7')
              : executionGenerator('uuidv4'),
          usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'],
        },
      ],
      [
        'cuid',
        {
          signature: cuidSig,
          lower: () => executionGenerator('cuid2'),
          usageSignatures: ['cuid(2)'],
        },
      ],
      [
        'ulid',
        {
          signature: ulidSig,
          lower: () => executionGenerator('ulid'),
          usageSignatures: ['ulid()'],
        },
      ],
      [
        'nanoid',
        {
          signature: nanoidSig,
          lower: ({ call }) => {
            const size = call.args['size'];
            return typeof size === 'number'
              ? executionGenerator('nanoid', { size })
              : executionGenerator('nanoid');
          },
          usageSignatures: ['nanoid()', 'nanoid(<2-255>)'],
        },
      ],
      [
        'dbgenerated',
        {
          signature: dbgeneratedSig,
          lower: ({ call, context }) => {
            const expression = call.args['expression'];
            if (typeof expression !== 'string' || expression.trim().length === 0) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message: 'Default function "dbgenerated" argument cannot be empty.',
              });
            }
            return {
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression },
              },
            };
          },
          usageSignatures: ['dbgenerated("...")'],
        },
      ],
    ]),
    generatorDescriptors: [
      {
        id: 'uuidv4',
        applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) =>
          generated.kind === 'generator' && generated.id === 'uuidv4'
            ? { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length: 36 } }
            : undefined,
      },
      {
        id: 'uuidv7',
        applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) =>
          generated.kind === 'generator' && generated.id === 'uuidv7'
            ? { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length: 36 } }
            : undefined,
      },
      {
        id: 'cuid2',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) =>
          generated.kind === 'generator' && generated.id === 'cuid2'
            ? { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length: 24 } }
            : undefined,
      },
      {
        id: 'ulid',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) =>
          generated.kind === 'generator' && generated.id === 'ulid'
            ? { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length: 26 } }
            : undefined,
      },
      {
        id: 'nanoid',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) => {
          if (generated.kind !== 'generator' || generated.id !== 'nanoid') {
            return undefined;
          }
          const rawSize = generated.params?.['size'];
          const length =
            typeof rawSize === 'number' &&
            Number.isInteger(rawSize) &&
            rawSize >= 2 &&
            rawSize <= 255
              ? rawSize
              : 21;
          return { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length } };
        },
      },
      {
        id: 'timestampNow',
        applicableCodecIds: ['pg/timestamp@1', 'pg/timestamptz@1', 'sqlite/datetime@1'],
        buildPhases: () => ({
          onCreate: { kind: 'generator', id: 'timestampNow' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        }),
      },
    ],
  };
}

export function modelsOf(contract: Contract) {
  return domainModelsAtDefaultNamespace(contract.domain);
}

export function valueObjectsOf(contract: Contract) {
  return domainValueObjectsAtDefaultNamespace(contract.domain);
}

export function documentScopedTypes(contract: { readonly storage?: unknown }) {
  return (contract.storage as { readonly types?: Record<string, unknown> } | undefined)?.types;
}

/**
 * Returns a `createNamespace` factory that captures enum types keyed by namespace id,
 * plus the accumulated map. Useful for asserting on postgres enum routing without
 * depending on the postgres target pack's concrete namespace class.
 */
export function buildEnumCapturingFactory(): {
  createNamespace: (
    input: SqlNamespaceInput,
    enumTypes?: Readonly<Record<string, unknown>>,
  ) => SqlNamespaceBase;
  capturedEnumTypes: Record<string, Record<string, unknown>>;
} {
  const capturedEnumTypes: Record<string, Record<string, unknown>> = {};
  const createNamespace = (
    input: SqlNamespaceInput,
    enumTypes?: Readonly<Record<string, unknown>>,
  ): SqlNamespaceBase => {
    if (enumTypes && Object.keys(enumTypes).length > 0) {
      capturedEnumTypes[input.id] = { ...(capturedEnumTypes[input.id] ?? {}), ...enumTypes };
    }
    return createTestSqlNamespace(input);
  };
  return { createNamespace, capturedEnumTypes };
}
