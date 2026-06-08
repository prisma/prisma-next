import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringTypeNamespace,
} from '@prisma-next/framework-components/authoring';
import type { PostgresEnumStorageEntry } from '@prisma-next/sql-contract/types';
import {
  PostgresEnumTypeSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from '@prisma-next/sql-contract/validators';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';
import { PostgresRlsPolicy, type PostgresRlsPolicyInput } from './postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './postgres-role';

export const postgresAuthoringTypes = {} as const satisfies AuthoringTypeNamespace;

/**
 * Entity type contributions surface as top-level helpers on the
 * composed-helpers shape (e.g. `helpers.enum({...})`), flattened
 * alongside the built-in `model` / `rel` helpers. Pack contributions
 * still ship via the contribution data structure
 * `authoring.entityTypes.<name>`; the composed-helpers template
 * performs the rename in the type system.
 *
 * `enum` is the first real consumer of the entities-namespace mechanism:
 * the factory constructs a `PostgresEnumType` IR-class instance from
 * the user-supplied input. Both authoring runtimes (TS DSL and PSL)
 * dispatch through this single contribution — PSL `enum Status { … }`
 * declarations are lowered by the interpreter into a factory call
 * with the parsed name + value list; TS DSL `helpers.enum({...})`
 * resolves through the same path. Removing this contribution makes
 * both surfaces fail with a "no entity helper named `enum`" type
 * error at the contract-definition site.
 */
/**
 * The factory constructs a `PostgresEnumType` instance natively — the
 * `SqlStorage.types` slot accepts polymorphic IR (the framework
 * `StorageType` alphabet), so no cast is needed at the contribution
 * surface. The declared return type is the structural
 * `PostgresEnumStorageEntry` so the inferred contract type stays
 * portable (it names a type exported from
 * `@prisma-next/sql-contract/types`, a public surface every consumer
 * already imports). Sharpening the inferred contract type to surface
 * enum-specific narrowing through `EntityHelperFunction` is a
 * separable refinement and lives outside this PR.
 */
export const postgresAuthoringEntityTypes = {
  enum: {
    kind: 'entity',
    discriminator: 'postgres-enum',
    validatorSchema: PostgresEnumTypeSchema,
    output: {
      factory: (input: PostgresEnumTypeInput): PostgresEnumStorageEntry =>
        new PostgresEnumType(input),
    },
  },
  role: {
    kind: 'entity',
    discriminator: 'postgres-role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: (input: PostgresRoleInput): PostgresRole => new PostgresRole(input),
    },
  },
  rlsPolicy: {
    kind: 'entity',
    discriminator: 'postgres-rls-policy',
    validatorSchema: PostgresRlsPolicySchema,
    output: {
      factory: (input: PostgresRlsPolicyInput): PostgresRlsPolicy => new PostgresRlsPolicy(input),
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
  temporal: /* @__PURE__ */ temporalAuthoringPresets({
    codecId: 'pg/timestamptz@1',
    nativeType: 'timestamptz',
  }),
} as const satisfies AuthoringFieldNamespace;
