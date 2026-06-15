import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  PslExtensionBlock,
  PslExtensionBlockParamList,
  PslExtensionBlockParamRef,
  PslExtensionBlockParamScalarValue,
} from '@prisma-next/framework-components/authoring';
import type { PostgresEnumStorageEntry } from '@prisma-next/sql-contract/types';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';
import { PostgresEnumTypeSchema } from './postgres-enum-type-schema';
import { PostgresRlsPolicy } from './postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './postgres-role';
import { PostgresRlsPolicySchema, PostgresRoleSchema } from './postgres-validators';
import { computeContentHash, normalizePredicate } from './rls/canonicalize';

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
/**
 * The PSL interpreter attaches the enclosing namespace id to the extension
 * block before calling this factory, so the policy can record its schema
 * coordinate without the interpreter containing any RLS-specific knowledge.
 */
export interface RlsPolicyExtensionBlock extends PslExtensionBlock {
  readonly namespaceId: string;
}

function readRefParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  if (param === undefined) return undefined;
  const p = param as PslExtensionBlockParamRef;
  return p.kind === 'ref' ? p.identifier : undefined;
}

function readValueParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  if (param === undefined) return undefined;
  const p = param as PslExtensionBlockParamScalarValue;
  return p.kind === 'value' ? p.raw : undefined;
}

function readListRefParams(block: PslExtensionBlock, key: string): string[] {
  const param = block.parameters[key];
  if (param === undefined) return [];
  const p = param as PslExtensionBlockParamList;
  if (p.kind !== 'list') return [];
  return p.items.flatMap((item) => {
    const ref = item as PslExtensionBlockParamRef;
    return ref.kind === 'ref' ? [ref.identifier] : [];
  });
}

function unwrapQuotedString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

function lowerRlsPolicyFromBlock(
  block: RlsPolicyExtensionBlock,
  _ctx: AuthoringEntityContext,
): PostgresRlsPolicy {
  const prefix = block.name;
  const targetModelName = readRefParam(block, 'target') ?? '';
  const tableName = targetModelName.charAt(0).toLowerCase() + targetModelName.slice(1);
  const roles = [...readListRefParams(block, 'roles')].sort();
  const using = unwrapQuotedString(readValueParam(block, 'using') ?? '');

  const wireHash = computeContentHash({
    using: normalizePredicate(using),
    roles,
    operation: 'select',
    permissive: true,
  });
  const wireName = `${prefix}_${wireHash}`;

  return new PostgresRlsPolicy({
    name: wireName,
    prefix,
    tableName,
    namespaceId: block.namespaceId,
    operation: 'select',
    roles,
    using,
    permissive: true,
  });
}

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
    discriminator: 'role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: (input: PostgresRoleInput): PostgresRole => new PostgresRole(input),
    },
  },
  rlsPolicy: {
    kind: 'entity',
    discriminator: 'rlsPolicy',
    validatorSchema: PostgresRlsPolicySchema,
    output: {
      factory: lowerRlsPolicyFromBlock,
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
 *
 * The `uuidNative` / `id.uuidv4Native` / `id.uuidv7Native` presets use the
 * native Postgres `uuid` type (codecId `pg/uuid@1`). For cross-target
 * portability use `uuidString` / `id.uuidv4String` / `id.uuidv7String` from
 * the family pack instead.
 */
/**
 * PSL block descriptor for `policy_select`.
 *
 * The parser learns the block shape from this descriptor; lowering from
 * `PslExtensionBlock` to `PostgresRlsPolicy` is wired in the PSL
 * interpreter (a later dispatch). The `discriminator` matches
 * `PostgresRlsPolicy.kind` so the parsed block node carries the same
 * discriminant as the IR class it will lower to.
 *
 * The `roles` list uses `scope:'cross-space'` because same-namespace
 * role ref resolution requires PSL namespace entries keyed by `refKind`
 * (i.e. `'role'`), which in turn requires the role block discriminator to
 * equal `'role'`. Aligning discriminator with refKind is tracked for
 * slice 4 (cross-space roles). Until then cross-space passes validation
 * unconditionally and the authored role names flow through unchanged.
 */
export const postgresAuthoringPslBlockDescriptors = {
  policy_select: {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'rlsPolicy',
    name: { required: true },
    parameters: {
      target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
      roles: {
        kind: 'list',
        of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
      },
      using: { kind: 'value', codecId: 'pg/text@1', required: true },
    },
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;

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
  uuidNative: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    },
  },
  id: {
    uuidv4Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv4',
          },
        },
        id: true,
      },
    },
    uuidv7Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv7',
          },
        },
        id: true,
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;
