import type {
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@prisma-next/framework-components/authoring';

export const postgresAuthoringTypes = {
  enum: {
    kind: 'typeConstructor',
    args: [{ kind: 'string' }, { kind: 'stringArray' }],
    output: {
      codecId: 'pg/enum@1',
      nativeType: { kind: 'arg', index: 0 },
      typeParams: {
        values: { kind: 'arg', index: 1 },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * Field presets contributed by the Postgres target pack.
 *
 * These mirror the PSL scalar-to-codec mapping used by the Postgres adapter
 * (see `createPostgresPslScalarTypeDescriptors`), so that authoring a field
 * via the TS callback surface (e.g. `field.int()`) and via the PSL scalar
 * surface (e.g. `Int`) lowers to byte-identical contracts.
 */
export const postgresAuthoringFieldPresets = {
  text: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/text@1',
      nativeType: 'text',
    },
  },
  int: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int4@1',
      nativeType: 'int4',
    },
  },
  bigint: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int8@1',
      nativeType: 'int8',
    },
  },
  float: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/float8@1',
      nativeType: 'float8',
    },
  },
  decimal: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
    },
  },
  boolean: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bool@1',
      nativeType: 'bool',
    },
  },
  json: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/jsonb@1',
      nativeType: 'jsonb',
    },
  },
  bytes: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bytea@1',
      nativeType: 'bytea',
    },
  },
  dateTime: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/timestamptz@1',
      nativeType: 'timestamptz',
    },
  },
  createdAt: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/timestamptz@1',
      nativeType: 'timestamptz',
      default: {
        kind: 'function',
        expression: 'now()',
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;
