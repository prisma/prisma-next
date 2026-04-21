import type { ContractSourceContext } from '@prisma-next/config/config-types';
import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ControlMutationDefaults,
  DefaultFunctionLoweringContext,
  ParsedDefaultFunctionCall,
} from '@prisma-next/framework-components/control';

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: ParsedDefaultFunctionCall['span'];
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

function expectNoArgs(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
  readonly usage: string;
}) {
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
  return match?.[2];
}

export const postgresTarget: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
};

export const pgvectorExtensionPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'pgvector',
  version: '1.2.3-test',
};

/** Controlled test-only descriptor — intentionally uses pg/vector@1 with maximum: 2000 rather
 *  than importing the real pgvector pack, so interpreter unit tests stay layer-isolated.
 *  Real-pack parity is covered by
 *  `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`. */
export const pgvectorAuthoringContributions = {
  field: {},
  type: {
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
} as const satisfies AuthoringContributions;

export const postgresScalarTypeDescriptors = new Map([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Boolean', { codecId: 'pg/bool@1', nativeType: 'bool' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['BigInt', { codecId: 'pg/int8@1', nativeType: 'int8' }],
  ['Float', { codecId: 'pg/float8@1', nativeType: 'float8' }],
  ['Decimal', { codecId: 'pg/numeric@1', nativeType: 'numeric' }],
  ['DateTime', { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' }],
  ['Json', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
  ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea' }],
] as const);

export const postgresCodecIdOnlyDescriptors = new Map<string, string>([
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

const targetTypesByCodecId: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
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
    const targetTypes = targetTypesByCodecId[id];
    if (!targetTypes) return undefined;
    return { id, targetTypes } as ReturnType<CodecLookup['get']>;
  },
};

export function createPostgresTestContext(
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensionPacks: [],
    scalarTypeDescriptors: postgresCodecIdOnlyDescriptors,
    authoringContributions: { field: {}, type: {} },
    codecLookup: postgresCodecLookup,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    resolvedInputs: [],
    ...overrides,
  };
}

export function createBuiltinLikeControlMutationDefaults(): ControlMutationDefaults {
  return {
    defaultFunctionRegistry: new Map([
      [
        'autoincrement',
        {
          lower: ({ call, context }) => {
            const noArgs = expectNoArgs({ call, context, usage: '`autoincrement()`' });
            if (noArgs) return noArgs;
            return {
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'autoincrement()' },
              },
            };
          },
          usageSignatures: ['autoincrement()'],
        },
      ],
      [
        'now',
        {
          lower: ({ call, context }) => {
            const noArgs = expectNoArgs({ call, context, usage: '`now()`' });
            if (noArgs) return noArgs;
            return {
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression: 'now()' },
              },
            };
          },
          usageSignatures: ['now()'],
        },
      ],
      [
        'uuid',
        {
          lower: ({ call, context }) => {
            if (call.args.length === 0) return executionGenerator('uuidv4');
            if (call.args.length !== 1) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message:
                  'Default function "uuid" accepts at most one version argument: `uuid()`, `uuid(4)`, or `uuid(7)`.',
              });
            }
            const version = parseIntegerArgument(call.args[0]?.raw ?? '');
            if (version === 4) return executionGenerator('uuidv4');
            if (version === 7) return executionGenerator('uuidv7');
            return invalidArgumentDiagnostic({
              context,
              span: call.args[0]?.span ?? call.span,
              message:
                'Default function "uuid" supports only `uuid()`, `uuid(4)`, or `uuid(7)` in SQL PSL provider v1.',
            });
          },
          usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'],
        },
      ],
      [
        'cuid',
        {
          lower: ({ call, context }) => {
            if (call.args.length === 0) {
              return {
                ok: false as const,
                diagnostic: {
                  code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
                  message:
                    'Default function "cuid()" is not supported in SQL PSL provider v1. Use `cuid(2)` instead.',
                  sourceId: context.sourceId,
                  span: call.span,
                },
              };
            }
            if (call.args.length !== 1) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message: 'Default function "cuid" accepts exactly one version argument: `cuid(2)`.',
              });
            }
            const version = parseIntegerArgument(call.args[0]?.raw ?? '');
            if (version === 2) return executionGenerator('cuid2');
            return invalidArgumentDiagnostic({
              context,
              span: call.args[0]?.span ?? call.span,
              message: 'Default function "cuid" supports only `cuid(2)` in SQL PSL provider v1.',
            });
          },
          usageSignatures: ['cuid(2)'],
        },
      ],
      [
        'ulid',
        {
          lower: ({ call, context }) => {
            const noArgs = expectNoArgs({ call, context, usage: '`ulid()`' });
            if (noArgs) return noArgs;
            return executionGenerator('ulid');
          },
          usageSignatures: ['ulid()'],
        },
      ],
      [
        'nanoid',
        {
          lower: ({ call, context }) => {
            if (call.args.length === 0) return executionGenerator('nanoid');
            if (call.args.length !== 1) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message:
                  'Default function "nanoid" accepts at most one size argument: `nanoid()` or `nanoid(<2-255>)`.',
              });
            }
            const size = parseIntegerArgument(call.args[0]?.raw ?? '');
            if (size !== undefined && size >= 2 && size <= 255) {
              return executionGenerator('nanoid', { size });
            }
            return invalidArgumentDiagnostic({
              context,
              span: call.args[0]?.span ?? call.span,
              message:
                'Default function "nanoid" size argument must be an integer between 2 and 255.',
            });
          },
          usageSignatures: ['nanoid()', 'nanoid(<2-255>)'],
        },
      ],
      [
        'dbgenerated',
        {
          lower: ({ call, context }) => {
            if (call.args.length !== 1) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message:
                  'Default function "dbgenerated" requires exactly one string argument: `dbgenerated("...")`.',
              });
            }
            const rawExpression = parseStringLiteral(call.args[0]?.raw ?? '');
            if (rawExpression === undefined) {
              return invalidArgumentDiagnostic({
                context,
                span: call.args[0]?.span ?? call.span,
                message: 'Default function "dbgenerated" argument must be a string literal.',
              });
            }
            if (rawExpression.trim().length === 0) {
              return invalidArgumentDiagnostic({
                context,
                span: call.args[0]?.span ?? call.span,
                message: 'Default function "dbgenerated" argument cannot be empty.',
              });
            }
            return {
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: {
                  kind: 'function' as const,
                  expression: rawExpression,
                },
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
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
        resolveGeneratedColumnDescriptor: ({ generated }) =>
          generated.kind === 'generator' && generated.id === 'uuidv4'
            ? { codecId: 'sql/char@1', nativeType: 'character', typeParams: { length: 36 } }
            : undefined,
      },
      {
        id: 'uuidv7',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
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
    ],
  };
}
