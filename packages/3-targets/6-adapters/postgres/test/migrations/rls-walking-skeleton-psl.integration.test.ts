import type { Contract } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@prisma-next/framework-components/control';
import { namespacePslExtensionBlocks } from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlNamespaceTablesInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import {
  computeContentHash,
  normalizePredicate,
} from '@prisma-next/target-postgres/rls-canonicalize';
import {
  PostgresRlsPolicy,
  PostgresRole,
  PostgresSchema,
} from '@prisma-next/target-postgres/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { createPostgresScalarTypeDescriptors } from '../../src/core/control-mutation-defaults';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

// ============================================================================
// PSL source — the author-facing input
// ============================================================================

const PSL = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

// ============================================================================
// PSL → contract helpers
// ============================================================================

function buildScalarTypeDescriptors(): ReadonlyMap<
  string,
  { codecId: string; nativeType: string }
> {
  const codecIdMap = createPostgresScalarTypeDescriptors();
  const codecLookup = createPostgresBuiltinCodecLookup();
  const result = new Map<string, { codecId: string; nativeType: string }>();
  for (const [typeName, codecId] of codecIdMap) {
    const nativeType = codecLookup.targetTypesFor(codecId)?.[0];
    if (nativeType !== undefined) {
      result.set(typeName, { codecId, nativeType });
    }
  }
  return result;
}

/**
 * Lower the `policy_select` extension blocks in the parsed namespace
 * into `PostgresRlsPolicy` instances, keyed by wire name.
 */
function lowerExtensionBlocksToRlsPolicies(
  namespaceId: string,
  extensionBlocks: ReturnType<typeof namespacePslExtensionBlocks>,
): Record<string, PostgresRlsPolicy> {
  const policies: Record<string, PostgresRlsPolicy> = {};

  for (const block of extensionBlocks) {
    if (block.kind !== 'postgres-rls-policy') {
      continue;
    }

    const prefix = block.name;

    const targetParam = block.parameters['target'];
    const targetModelName =
      targetParam && typeof targetParam === 'object' && 'kind' in targetParam
        ? (targetParam as { kind: string; identifier?: string }).kind === 'ref'
          ? ((targetParam as { identifier?: string }).identifier ?? '')
          : ''
        : '';
    const tableName = targetModelName.charAt(0).toLowerCase() + targetModelName.slice(1);

    const rolesParam = block.parameters['roles'];
    const roles: string[] =
      rolesParam &&
      typeof rolesParam === 'object' &&
      'kind' in rolesParam &&
      (rolesParam as { kind: string }).kind === 'list'
        ? ((rolesParam as { items?: unknown[] }).items ?? []).flatMap((item) => {
            const i = item as { kind?: string; identifier?: string };
            return i.kind === 'ref' && typeof i.identifier === 'string' ? [i.identifier] : [];
          })
        : [];

    const usingParam = block.parameters['using'];
    const usingRaw =
      usingParam && typeof usingParam === 'object' && 'kind' in usingParam
        ? (usingParam as { kind: string; raw?: string }).kind === 'value'
          ? ((usingParam as { raw?: string }).raw ?? '')
          : ''
        : '';
    const using =
      usingRaw.startsWith('"') && usingRaw.endsWith('"') && usingRaw.length >= 2
        ? usingRaw.slice(1, -1)
        : usingRaw;

    const wireHash = computeContentHash({
      using: normalizePredicate(using),
      roles: [...roles].sort(),
      operation: 'select',
      permissive: true,
    });
    const wireName = `${prefix}_${wireHash}`;

    policies[wireName] = new PostgresRlsPolicy({
      name: wireName,
      prefix,
      tableName,
      namespaceId,
      operation: 'select',
      roles: [...roles].sort(),
      using,
      permissive: true,
    });
  }

  return policies;
}

function buildPslContract() {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);

  const codecLookup = createPostgresBuiltinCodecLookup();
  const scalarTypeDescriptors = buildScalarTypeDescriptors();

  const document = parsePslDocument({
    schema: PSL,
    sourceId: 'schema.prisma',
    pslBlockDescriptors: assembled.pslBlockDescriptors,
    codecLookup,
  });

  // Pre-lower extension blocks per namespace so the createNamespace factory
  // can inject them into the PostgresSchema.
  const rlsPoliciesByNamespace = new Map<string, Record<string, PostgresRlsPolicy>>();
  for (const ns of document.ast.namespaces) {
    const blocks = namespacePslExtensionBlocks(ns);
    if (blocks.length > 0) {
      rlsPoliciesByNamespace.set(ns.name, lowerExtensionBlocksToRlsPolicies(ns.name, blocks));
    }
  }

  // The role entity is not yet declarable in PSL (no `role <name> {}` block
  // descriptor exists), so we construct it directly.
  const appUserRole = new PostgresRole({ name: 'app_user', namespaceId: 'public' });

  return interpretPslDocumentToSqlContract({
    document,
    target: postgresTargetDescriptor as unknown as TargetPackRef<'sql', 'postgres'>,
    scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: (input: SqlNamespaceTablesInput) => {
      const policies = rlsPoliciesByNamespace.get(input.id) ?? {};
      const role = input.id === 'public' ? { [appUserRole.name]: appUserRole } : {};
      return new PostgresSchema({
        id: input.id,
        entries: {
          table: input.entries.table,
          type: {},
          role,
          rlsPolicy: policies,
        },
      });
    },
  });
}

// ============================================================================
// PSL walking-skeleton test
// ============================================================================

describe.sequential('RLS walking skeleton — PSL author → plan → apply → filter → verify', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it('PSL lowers to a contract with rlsPolicy and role entries in the public namespace', () => {
    const result = buildPslContract();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.entries.rlsPolicy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.entries.rlsPolicy);
    const policy = ns.entries.rlsPolicy[policyKey!]!;
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);

    expect(Object.keys(ns.entries.role)).toHaveLength(1);
    const role = ns.entries.role['app_user']!;
    expect(role).toBeInstanceOf(PostgresRole);
    expect(role.name).toBe('app_user');
  });

  it(
    'applies an RLS policy authored in PSL, enforces row isolation under SET ROLE, and re-verifies clean',
    async () => {
      const result = buildPslContract();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contract = result.value as Contract<SqlStorage>;

      // Pre-create the role — role creation is out of scope for the planner.
      await driver.query('CREATE ROLE app_user');

      // Plan against empty schema.
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const planResult = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
      });

      expect(planResult.kind).toBe('success');
      if (planResult.kind !== 'success') return;

      const allSql = planResult.plan.operations
        .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
        .map((step) => step.sql);

      expect(allSql.some((s) => s.includes('CREATE TABLE'))).toBe(true);
      expect(allSql.some((s) => s.includes('ENABLE ROW LEVEL SECURITY'))).toBe(true);
      expect(allSql.some((s) => s.includes('CREATE POLICY'))).toBe(true);

      // Apply all operations.
      for (const op of planResult.plan.operations) {
        for (const step of [...op.precheck, ...op.execute, ...op.postcheck]) {
          await driver.query(step.sql, step.params ?? []);
        }
      }

      // Insert two rows with different owner_id values.
      await driver.query(`INSERT INTO "public"."profile" (id, owner_id) VALUES (1, 101), (2, 202)`);

      // Grant SELECT so app_user can read the table.
      await driver.query(`GRANT SELECT ON "public"."profile" TO app_user`);

      // Switch to app_user and set the GUC to owner of row 1.
      await driver.query('SET ROLE app_user');
      await driver.query(`SELECT set_config('app.uid', '101', false)`);

      const filtered = await driver.query<{ id: number; owner_id: number }>(
        `SELECT id, owner_id FROM "public"."profile"`,
      );

      await driver.query('RESET ROLE');

      // Only row 1 (owner_id=101) should be visible.
      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0]).toMatchObject({ id: 1, owner_id: 101 });

      // Re-verify clean — extensionIssues must be empty.
      const introspected = await familyInstance.introspect({ driver, contract });
      const verifyResult = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });

      expect(verifyResult.schema.extensionIssues).toEqual([]);
    },
    testTimeout,
  );
});
