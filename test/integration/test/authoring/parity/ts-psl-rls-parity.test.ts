/**
 * TS/PSL RLS authoring parity (real packs): the walking-skeleton policies,
 * all five operations, a single-predicate update, and an @@map'd model,
 * authored in both surfaces, lower to structurally identical contracts —
 * identical `entries.policy` / `entries.rls` keys, identical content-hash
 * wire names, JSON-equal entities. Roles are referenced via the supabase
 * pack's `anon`/`authenticated` handles on the TS side and bare identifiers
 * on the PSL side. TS-only: a `role(...)` declared in `entities` lands in
 * `entries.role` (PSL has no role block, so that half is asserted directly).
 */
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { anon, authenticated } from '@prisma-next/extension-supabase/contract';
import sqlFamilyControl from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  defineContract,
  field,
  model,
  policyAll,
  policyDelete,
  policyInsert,
  policySelect,
  policyUpdate,
  rlsEnabled,
  role,
} from '@prisma-next/postgres/contract-builder';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import postgresControl from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import type { PostgresSchema } from '@prisma-next/target-postgres/types';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
  extensionPacks: [],
});

function buildColumnDescriptorMap() {
  const result = new Map<string, { codecId: string; nativeType: string }>();
  for (const [typeName, codecId] of stack.scalarTypeDescriptors) {
    const targetTypes = stack.codecLookup.targetTypesFor(codecId);
    const nativeType = targetTypes?.[0] ?? codecId;
    result.set(typeName, { codecId, nativeType });
  }
  return result;
}

function interpretWithRealPacks(schema: string) {
  const scalarTypeDescriptors = buildColumnDescriptorMap();
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeDescriptors.keys()],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable: table,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresPack,
    scalarTypeDescriptors,
    controlMutationDefaults: stack.controlMutationDefaults,
    authoringContributions: stack.authoringContributions,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: stack.capabilities,
    codecLookup: stack.codecLookup,
  });
}

const OWNER_PREDICATE = '"userId"::uuid = auth.uid()';

function buildTsModels() {
  return {
    Profile: model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(textColumn),
      },
    }).sql({ table: 'profile' }),
    AuditLog: model('AuditLog', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'audit_log' }),
  };
}

function buildTsEntities(models: ReturnType<typeof buildTsModels>) {
  const { Profile, AuditLog } = models;
  return [
    rlsEnabled(Profile),
    rlsEnabled(AuditLog),
    // Walking-skeleton policies.
    policySelect(Profile, {
      name: 'profile_owner_read',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    policySelect(Profile, { name: 'profile_public_read', roles: [anon], using: 'true' }),
    policyUpdate(Profile, {
      name: 'profile_owner_write',
      roles: [authenticated],
      using: OWNER_PREDICATE,
      withCheck: OWNER_PREDICATE,
    }),
    // Remaining operations.
    policyInsert(Profile, {
      name: 'profile_owner_insert',
      roles: [authenticated],
      withCheck: OWNER_PREDICATE,
    }),
    policyDelete(Profile, {
      name: 'profile_owner_delete',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    policyAll(Profile, {
      name: 'profile_admin_all',
      roles: [anon, authenticated],
      using: 'true',
      withCheck: 'true',
    }),
    // Single-predicate update (PSL accepts using-only; hash omits withCheck).
    policyUpdate(Profile, {
      name: 'profile_touch_write',
      roles: [authenticated],
      using: OWNER_PREDICATE,
    }),
    // Policy on the @@map'd model (storage name not derivable from the name).
    policySelect(AuditLog, { name: 'audit_read', roles: [authenticated], using: 'true' }),
  ];
}

const PSL_SOURCE = `namespace public {
  model Profile {
    id     Int    @id
    userId String

    @@map("profile")
    @@rls
  }

  model AuditLog {
    id Int @id

    @@map("audit_log")
    @@rls
  }

  policy_select profile_owner_read {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_select profile_public_read {
    target = Profile
    roles  = [anon]
    using  = "true"
  }

  policy_update profile_owner_write {
    target    = Profile
    roles     = [authenticated]
    using     = "\\"userId\\"::uuid = auth.uid()"
    withCheck = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_insert profile_owner_insert {
    target    = Profile
    roles     = [authenticated]
    withCheck = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_delete profile_owner_delete {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_all profile_admin_all {
    target    = Profile
    roles     = [anon, authenticated]
    using     = "true"
    withCheck = "true"
  }

  policy_update profile_touch_write {
    target = Profile
    roles  = [authenticated]
    using  = "\\"userId\\"::uuid = auth.uid()"
  }

  policy_select audit_read {
    target = AuditLog
    roles  = [authenticated]
    using  = "true"
  }
}
`;

const EXPECTED_POLICY_PREFIXES = [
  'audit_read',
  'profile_admin_all',
  'profile_owner_delete',
  'profile_owner_insert',
  'profile_owner_read',
  'profile_owner_write',
  'profile_public_read',
  'profile_touch_write',
];

function publicNamespace(contract: {
  storage: { namespaces: Record<string, unknown> };
}): PostgresSchema {
  const ns = contract.storage.namespaces['public'] as PostgresSchema | undefined;
  if (ns === undefined) throw new Error('expected the public namespace to be declared');
  return ns;
}

describe('TS and PSL RLS authoring parity with real packs', () => {
  const models = buildTsModels();
  const tsContract = defineContract({
    models,
    entities: buildTsEntities(models),
  });

  const interpreted = interpretWithRealPacks(PSL_SOURCE);

  it('lowers both surfaces to identical contracts', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;
    expect(interpreted.value).toEqual(tsContract);
  });

  it('keys entries.policy by prefix and entries.rls by table name, identically', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    const tsNs = publicNamespace(tsContract);
    const pslNs = publicNamespace(interpreted.value);

    expect(Object.keys(tsNs.policy).sort()).toEqual(EXPECTED_POLICY_PREFIXES);
    expect(Object.keys(pslNs.policy).sort()).toEqual(EXPECTED_POLICY_PREFIXES);
    expect(Object.keys(tsNs.rls).sort()).toEqual(['audit_log', 'profile']);
    expect(Object.keys(pslNs.rls).sort()).toEqual(['audit_log', 'profile']);
  });

  it('produces identical content-hash wire names and JSON-equal entities per prefix', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    const tsNs = publicNamespace(tsContract);
    const pslNs = publicNamespace(interpreted.value);

    for (const prefix of EXPECTED_POLICY_PREFIXES) {
      const tsPolicy = tsNs.policy[prefix];
      const pslPolicy = pslNs.policy[prefix];
      expect(tsPolicy?.name).toBe(pslPolicy?.name);
      expect(tsPolicy?.name).toMatch(new RegExp(`^${prefix}_[0-9a-f]{8}$`));
      expect(JSON.parse(JSON.stringify(tsPolicy))).toEqual(JSON.parse(JSON.stringify(pslPolicy)));
    }

    // The @@map'd model's policy and enablement agree on the real table name.
    expect(tsNs.policy['audit_read']?.tableName).toBe('audit_log');
    expect(pslNs.policy['audit_read']?.tableName).toBe('audit_log');
  });

  it('single-predicate update carries no withCheck on either surface', () => {
    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(publicNamespace(tsContract).policy['profile_touch_write']?.withCheck).toBeUndefined();
    expect(
      publicNamespace(interpreted.value).policy['profile_touch_write']?.withCheck,
    ).toBeUndefined();
  });

  it('TS-only: a role declared in entities lands in entries.role', () => {
    const declaredModels = buildTsModels();
    const contract = defineContract({
      models: declaredModels,
      entities: [...buildTsEntities(declaredModels), role('app_user')],
    });

    const ns = publicNamespace(contract);
    expect(Object.keys(ns.role)).toEqual(['app_user']);
    expect(JSON.parse(JSON.stringify(ns.role['app_user']))).toEqual({
      kind: 'role',
      name: 'app_user',
      namespaceId: 'public',
      control: 'external',
    });
    // Referenced-but-undeclared roles stay bare names on the policies.
    expect(ns.policy['profile_owner_read']?.roles).toEqual(['authenticated']);
  });
});
