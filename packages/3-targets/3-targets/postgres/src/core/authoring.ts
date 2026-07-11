import { temporalAuthoringPresets } from '@prisma-next/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import { modelAttribute } from '@prisma-next/psl-parser';
import type { SqlValueSetDerivingEntityTypeOutput } from '@prisma-next/sql-contract/value-set-derivation-hook';
import { PG_ENUM_CODEC_ID } from './codec-ids';
import { PostgresNativeEnum } from './postgres-native-enum';
import { PostgresRlsEnablement, type PostgresRlsEnablementInput } from './postgres-rls-enablement';
import { PostgresRlsPolicy } from './postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './postgres-role';
import {
  PostgresNativeEnumSchema,
  PostgresRlsEnablementSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';
import { computeContentHash, normalizePredicate } from './rls/canonicalize';
import { formatRlsPolicyWireName } from './rls/wire-name';

/**
 * `pg.enum(<ref>)` registers as an ordinary type constructor whose sole
 * positional argument names a `native_enum` entity instead of carrying a
 * literal value. The interpreter resolves the ref to the `native_enum`
 * entity generically (driven by `entityRefArg`); the `pg/enum@1` codec
 * descriptor's `columnFromEntity` hook (see `codecs.ts`) converts that
 * entity into the column's `typeParams` and native type.
 */
export const postgresAuthoringTypes = {
  pg: {
    enum: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: 'native_enum' },
      output: {
        codecId: PG_ENUM_CODEC_ID,
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

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

/**
 * Unwraps a quoted PSL string argument, inverting the printer's
 * `escapePslString` escapes (`\\`, `\"`, `\n`, `\r`). An unknown escape
 * sequence is kept verbatim, matching the printer-side `unescapePslString`
 * convention.
 */
function unwrapQuotedString(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    return raw;
  }
  const inner = raw.slice(1, -1);
  let result = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\' || i + 1 >= inner.length) {
      result += inner[i];
      continue;
    }
    const next = inner[i + 1];
    if (next === '\\' || next === '"') {
      result += next;
    } else if (next === 'n') {
      result += '\n';
    } else if (next === 'r') {
      result += '\r';
    } else {
      result += '\\';
      result += next;
    }
    i++;
  }
  return result;
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
  const wireName = formatRlsPolicyWireName(prefix, wireHash);

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

/**
 * Lowers a `native_enum { memberName = "value" … @@map("type_name") }` block
 * into a {@link PostgresNativeEnum}. Members must be authored as explicit
 * `key = "value"` pairs — a bare (value-less) member is a diagnostic, not
 * accepted (authoring-design.md §2.1). The parsed `memberName` is only used
 * to duplicate-check and report diagnostics; the lowered entity carries just
 * the member values (a native enum is value-only — the member "name" isn't
 * a separate authoring concept from the value). `typeName` comes from
 * `@@map` or defaults to the block name verbatim.
 */
function lowerNativeEnumFromBlock(
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresNativeEnum | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const mapAttr = block.blockAttributes.find((a) => a.name === 'map');
  let typeName = block.name;
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
  const members: string[] = [];
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
    members.push(jsonValue);
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

  // `control` stays unset — the effective grade is resolved at read time via `effectiveControlPolicy`, like `StorageTable`/`StorageColumn`.
  return new PostgresNativeEnum({ typeName, members });
}

/**
 * `native_enum`'s entity-type factory output, checked separately from the assembled
 * `postgresAuthoringEntityTypes` map below: `deriveValueSet` is SQL-family surface
 * ({@link SqlValueSetDerivingEntityTypeOutput}), not part of the framework
 * `AuthoringEntityTypeFactoryOutput` shape, so folding it directly into the map's single
 * `satisfies AuthoringEntityTypeNamespace` check would trip an excess-property error. Checking it
 * here against the intersection of both shapes keeps it structurally valid against each without
 * widening the map's own check.
 */
const nativeEnumEntityTypeOutput = {
  factory: lowerNativeEnumFromBlock,
  deriveValueSet: (entity: PostgresNativeEnum) => ({
    kind: 'valueSet' as const,
    values: [...entity.members],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<PslExtensionBlock, PostgresNativeEnum | undefined> &
  SqlValueSetDerivingEntityTypeOutput;

export const postgresAuthoringEntityTypes = {
  role: {
    kind: 'entity',
    discriminator: 'role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: (input: PostgresRoleInput): PostgresRole => new PostgresRole(input),
    },
  },
  rls: {
    kind: 'entity',
    discriminator: 'rls',
    validatorSchema: PostgresRlsEnablementSchema,
    output: {
      factory: (input: PostgresRlsEnablementInput): PostgresRlsEnablement =>
        new PostgresRlsEnablement(input),
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
    output: nativeEnumEntityTypeOutput,
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
    // A policy may only target an RLS-controlled model: the model named by
    // `target` must declare `@@rls`, or the load fails with a diagnostic
    // naming the model and the policy prefix.
    requiresModelAttribute: { parameter: 'target', attribute: 'rls' },
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

/**
 * `@@` model attributes contributed by the Postgres target pack.
 *
 * `@@rls` is argument-less: presence marks the model's table
 * RLS-controlled. It lowers to a {@link PostgresRlsEnablement} marker in
 * the namespace's `entries.rls`, keyed by the model's table name — the
 * marker (never the policy set) is what drives
 * `ENABLE`/`DISABLE ROW LEVEL SECURITY` planning.
 */
export const postgresAuthoringModelAttributes = {
  rls: {
    kind: 'modelAttribute',
    attribute: 'rls',
    spec: modelAttribute('rls', {}),
    lower: (_parsed: Record<never, never>, ctx: AuthoringModelAttributeContext) => ({
      key: ctx.storageName,
      entity: new PostgresRlsEnablement({
        tableName: ctx.storageName,
        namespaceId: ctx.namespaceId,
      }),
    }),
  },
} as const satisfies AuthoringModelAttributeDescriptorNamespace;

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
