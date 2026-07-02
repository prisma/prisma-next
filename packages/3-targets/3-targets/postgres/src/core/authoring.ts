import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import {
  PostgresNativeEnumSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';
import { computeContentHash, normalizePredicate } from './rls/canonicalize';
import { PostgresNativeEnum } from './schema-ir/postgres-native-enum';
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

// TODO(TS-mirror parity): this diverges from `applyNaming(..., 'snake_case')`
// on acronym runs. The TS mirror (`field.column(pg.enum(handle))`) must reuse ONE
// canonical snake_case so PSL and TS lower to a byte-identical contract — pick
// the single source of truth then, don't leave two implementations.
function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Lowers a `native_enum { memberName = "value" … @@map("type_name") }` block
 * into a {@link PostgresNativeEnum}. Members must be authored as explicit
 * `key = "value"` pairs — a bare (value-less) member is a diagnostic, not
 * accepted (authoring-design.md §2.1). `typeName` comes from `@@map` or
 * defaults to `snake_case(block.name)`.
 */
function lowerNativeEnumFromBlock(
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresNativeEnum | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const mapAttr = block.blockAttributes.find((a) => a.name === 'map');
  let typeName = snakeCase(block.name);
  if (mapAttr) {
    const rawArg = mapAttr.args[0]?.value;
    const mapped = rawArg !== undefined ? unwrapQuotedString(rawArg) : undefined;
    if (mapped === undefined) {
      diagnostics?.push({
        code: 'PSL_NATIVE_ENUM_INVALID_MAP',
        message: `native_enum "${block.name}" @@map attribute must have a quoted type-name argument`,
        sourceId,
        span: mapAttr.span,
      });
      return undefined;
    }
    typeName = mapped;
  }

  let memberError = false;
  const seenValues = new Set<string>();
  const members: { name: string; value: string }[] = [];
  for (const [memberName, paramValue] of Object.entries(block.parameters)) {
    if (paramValue.kind === 'bare') {
      diagnostics?.push({
        code: 'PSL_NATIVE_ENUM_BARE_MEMBER',
        message: `native_enum "${block.name}" member "${memberName}" has no value; members must be authored as "${memberName} = \\"value\\""`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (paramValue.kind !== 'value') continue;

    let jsonValue: unknown;
    try {
      jsonValue = JSON.parse(paramValue.raw);
    } catch {
      diagnostics?.push({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `native_enum "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (typeof jsonValue !== 'string') {
      diagnostics?.push({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `native_enum "${block.name}" member "${memberName}" value must be a string`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (seenValues.has(jsonValue)) {
      diagnostics?.push({
        code: 'PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE',
        message: `native_enum "${block.name}": duplicate member value "${jsonValue}"`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    seenValues.add(jsonValue);
    members.push({ name: memberName, value: jsonValue });
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: 'PSL_NATIVE_ENUM_MISSING_MEMBERS',
      message: `native_enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  // `control` is left unset here — the effective grade (`external` for the
  // Supabase pack, `managed` by default) is resolved at read time via
  // `effectiveControlPolicy(node.control, contract.defaultControlPolicy)`,
  // exactly as `StorageTable`/`StorageColumn` leave `control` unset and rely
  // on the contract-level default (see `applySpecifierDefaultControlPolicy`).
  return new PostgresNativeEnum({ typeName, members });
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
  native_enum: {
    kind: 'entity',
    discriminator: 'native_enum',
    validatorSchema: PostgresNativeEnumSchema,
    output: {
      factory: lowerNativeEnumFromBlock,
      deriveValueSet: (entity: PostgresNativeEnum) => ({
        kind: 'valueSet',
        values: entity.members.map((m) => m.value),
      }),
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
  /**
   * PSL block descriptor for `native_enum`.
   *
   * Reuses the existing variadic-block mechanism (the same shape the SQL
   * family's `enum` block ships): the body is an open `memberName = "value"`
   * list. `variadicParameters: true` opens the block to arbitrary keys
   * beyond the declared (empty) `parameters` set — the lowering factory
   * (`lowerNativeEnumFromBlock`) turns the variadic entries into ordered
   * members and rejects a bare (value-less) member.
   */
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    discriminator: 'native_enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
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
