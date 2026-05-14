import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@prisma-next/framework-components/authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';

export const postgresAuthoringTypes = {} as const satisfies AuthoringTypeNamespace;

/**
 * Entity type contributions surface through the runtime `helpers.entities.*`
 * helpers (merged from each pack's `authoring.entityTypes`).
 *
 * `enum` is the first real consumer of the entities-namespace mechanism:
 * the factory constructs a `PostgresEnumType` IR-class instance from
 * the user-supplied input. Both authoring runtimes (TS DSL and PSL)
 * dispatch through this single contribution — PSL `enum Status { … }`
 * declarations are lowered by the interpreter into a factory call
 * with the parsed name + value list; TS DSL `helpers.entities.enum({...})`
 * resolves through the same path. Removing this contribution makes
 * both surfaces fail with a "no entity helper named `enum`" type
 * error at the contract-definition site.
 */
/**
 * Factory return type erases the concrete `PostgresEnumType<TName,
 * TValues>` to `StorageTypeInstance` for the contract-builder's
 * declarative type inference. The runtime instance is still a
 * `PostgresEnumType` (so `instanceof SqlEnumType` checks in the
 * verifier / planner / serializer dispatch correctly); the type
 * erasure exists so contracts referencing `helpers.entities.enum(...)`
 * results in `storage.types` keep their inferred type expressible
 * without needing to import a target-internal class declaration.
 * Sharpening this to surface enum-specific narrowing in the
 * inferred contract type is a separable refinement to the
 * `EntityHelperFunction` shape without changing the contribution wiring.
 */
export const postgresAuthoringEntityTypes = {
  enum: {
    kind: 'entity',
    output: {
      factory: (input: PostgresEnumTypeInput): StorageTypeInstance =>
        new PostgresEnumType(input) as unknown as StorageTypeInstance,
    },
  },
} as const satisfies AuthoringEntityTypeNamespace;

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
  temporal: temporalAuthoringPresets({
    codecId: 'pg/timestamptz@1',
    nativeType: 'timestamptz',
  }),
} as const satisfies AuthoringFieldNamespace;
