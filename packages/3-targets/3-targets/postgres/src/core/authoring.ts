import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import { PostgresRlsPolicySchema, PostgresRoleSchema } from './postgres-validators';
import { computeContentHash, normalizePredicate } from './rls/canonicalize';
import { PostgresRlsPolicy } from './schema-ir/postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './schema-ir/postgres-role';

export const postgresAuthoringTypes = {} as const satisfies AuthoringTypeNamespace;

export interface RlsPolicyExtensionBlock extends PslExtensionBlock {
  readonly namespaceId: string;
}

function readRefParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  return param?.kind === 'ref' ? param.identifier : undefined;
}

function readValueParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  return param?.kind === 'value' ? param.raw : undefined;
}

function readListRefParams(block: PslExtensionBlock, key: string): string[] {
  const param = block.parameters[key];
  if (param?.kind !== 'list') return [];
  return param.items.flatMap((item) => (item.kind === 'ref' ? [item.identifier] : []));
}

function unwrapQuotedString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
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
  role: {
    kind: 'entity',
    discriminator: 'role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: (input: PostgresRoleInput): PostgresRole => new PostgresRole(input),
    },
  },
  policy: {
    kind: 'entity',
    discriminator: 'policy',
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
    discriminator: 'policy',
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
