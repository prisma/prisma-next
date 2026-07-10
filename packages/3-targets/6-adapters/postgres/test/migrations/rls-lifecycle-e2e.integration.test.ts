import type { Contract } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
  type MigrationOperationPolicy,
} from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema, postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { createPostgresScalarTypeDescriptors } from '../../src/core/control-mutation-defaults';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

// ============================================================================
// PSL sources
// ============================================================================

// PSL_A and PSL_B share the same table schema (deleted_at already present) so
// the edit step only changes the predicate — no column addition needed during
// the edit plan. This avoids triggering the rlsPolicy-before-column ordering
// issue in the planner (addColumn is bucketed after rlsPolicy).
const PSL_A = `
namespace public {
  model profile {
    id         Int @id
    owner_id   Int
    deleted_at String?

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

const PSL_B = `
namespace public {
  model profile {
    id         Int @id
    owner_id   Int
    deleted_at String?

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int AND deleted_at IS NULL"
  }
}
`;

// Same model as A/B; policy removed.
const PSL_NO_POLICY = `
namespace public {
  model profile {
    id         Int @id
    owner_id   Int
    deleted_at String?

    @@rls
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

function buildContractFromPsl(psl: string): Contract<SqlStorage> {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const scalarTypeDescriptors = buildScalarTypeDescriptors();

  const { document, sourceFile } = parse(psl);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeDescriptors.keys()],
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });

  const result = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
    },
    scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  return result.value as Contract<SqlStorage>;
}

// ============================================================================
// Apply helper — mirrors rls-verify-extension-issues.integration.test.ts
// ============================================================================

const ALLOW_DESTRUCTIVE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

async function applyContract(
  driver: PostgresControlDriver,
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy = INIT_ADDITIVE_POLICY,
): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const planResult = planner.plan({
    contract,
    schema,
    policy,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
  });
  if (planResult.kind !== 'success')
    throw new Error(`Planner failed: ${JSON.stringify(planResult)}`);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: planResult.plan.spaceId ?? APP_SPACE_ID,
        plan: planResult.plan,
        migrationEdges: synthEdges(planResult.plan),
        driver,
        destinationContract: contract,
        policy,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok)
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
}

// ============================================================================
// Test
// ============================================================================

describe.sequential('RLS lifecycle e2e — edit replaces, removal fails verify', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
    // Role must exist before any plan runs.
    await driver.query('CREATE ROLE app_user');
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  // --------------------------------------------------------------------------
  // Step 1 — apply predicate A, assert policy p_read_<hashA> exists
  // --------------------------------------------------------------------------

  it(
    'step 1: applies predicate-A contract; policy p_read_<hashA> is created',
    async () => {
      const contractA = buildContractFromPsl(PSL_A);

      await applyContract(driver, contractA, emptySchema);

      // The dict key in entries.policy is the PSL prefix ('p_read'), not the
      // hashed wire name. Access the wire name via policy.name.
      const nsA = contractA.storage.namespaces['public'];
      expect(nsA).toBeDefined();
      if (!isPostgresSchema(nsA)) throw new Error('expected PostgresSchema for public');
      const policies = Object.values(nsA.policy);
      expect(policies).toHaveLength(1);
      const nameA = policies[0]?.name ?? '';
      expect(nameA).toMatch(/^p_read_[0-9a-f]{8}$/);

      // pg_policies must contain exactly nameA for this table.
      const rows = await driver.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'profile' AND schemaname = 'public'`,
      );
      expect(rows.rows.map((r) => r.policyname)).toEqual([nameA]);
    },
    testTimeout,
  );

  // --------------------------------------------------------------------------
  // Step 2 — introspect + plan vs predicate B; assert create+drop in plan
  // --------------------------------------------------------------------------

  it(
    'step 2: edit plan contains create p_read_<hashB> AND drop p_read_<hashA>',
    async () => {
      const contractA = buildContractFromPsl(PSL_A);
      const contractB = buildContractFromPsl(PSL_B);

      const nsA = contractA.storage.namespaces['public'];
      const nsB = contractB.storage.namespaces['public'];
      if (!isPostgresSchema(nsA)) throw new Error('expected PostgresSchema for public (A)');
      if (!isPostgresSchema(nsB)) throw new Error('expected PostgresSchema for public (B)');

      // Wire names are on policy.name, not the dict key (which is the PSL prefix).
      const nameA = Object.values(nsA.policy)[0]?.name ?? '';
      const nameB = Object.values(nsB.policy)[0]?.name ?? '';
      expect(nameA).not.toBe(nameB);

      const introspected = await familyInstance.introspect({ driver, contract: contractA });

      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const planResult = planner.plan({
        contract: contractB,
        schema: introspected,
        policy: ALLOW_DESTRUCTIVE,
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
      });

      expect(planResult.kind).toBe('success');
      if (planResult.kind !== 'success') return;

      const resolvedOps = await Promise.all(planResult.plan.operations);
      const allSql = resolvedOps
        .flatMap((op) => [...op.precheck, ...op.execute, ...op.postcheck])
        .map((step) => step.sql);

      expect(allSql.some((s) => s.includes(`CREATE POLICY "${nameB}"`))).toBe(true);
      expect(allSql.some((s) => s.includes(`DROP POLICY "${nameA}"`))).toBe(true);
    },
    testTimeout,
  );

  // --------------------------------------------------------------------------
  // Step 3 — apply predicate B; assert exactly one policy, predicate B filters
  // --------------------------------------------------------------------------

  it(
    'step 3: after apply, exactly one policy (p_read_<hashB>) and predicate B filters soft-deleted rows',
    async () => {
      const contractB = buildContractFromPsl(PSL_B);

      const introspected = await familyInstance.introspect({ driver, contract: contractB });
      await applyContract(driver, contractB, introspected, ALLOW_DESTRUCTIVE);

      const nsB = contractB.storage.namespaces['public'];
      if (!isPostgresSchema(nsB)) throw new Error('expected PostgresSchema for public (B)');
      const nameB = Object.values(nsB.policy)[0]?.name ?? '';

      // Exactly one policy for profile.
      const policyRows = await driver.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'profile' AND schemaname = 'public'`,
      );
      expect(policyRows.rows).toHaveLength(1);
      expect(policyRows.rows[0]!.policyname).toBe(nameB);

      // Seed rows: row 1 is owned by uid=101, not soft-deleted; row 2 by uid=101, soft-deleted;
      // row 3 by uid=202, not soft-deleted.
      await driver.query(
        `INSERT INTO "public"."profile" (id, owner_id, deleted_at) VALUES (1, 101, NULL), (2, 101, '2024-01-01'), (3, 202, NULL)`,
      );

      await driver.query(`GRANT SELECT ON "public"."profile" TO app_user`);
      await driver.query('SET ROLE app_user');
      await driver.query(`SELECT set_config('app.uid', '101', false)`);

      const filtered = await driver.query<{ id: number }>(
        `SELECT id FROM "public"."profile" ORDER BY id`,
      );

      await driver.query('RESET ROLE');

      // Only row 1 — owned by 101 AND not soft-deleted.
      expect(filtered.rows.map((r) => r.id)).toEqual([1]);
    },
    testTimeout,
  );

  // --------------------------------------------------------------------------
  // Scenario 2 — removal fails verify
  // --------------------------------------------------------------------------

  it(
    'scenario 2: contract with policy removed → verify ok:false, extra schemaDiffIssue names orphaned p_read_<hashB>',
    async () => {
      const contractB = buildContractFromPsl(PSL_B);
      const contractNoPolicy = buildContractFromPsl(PSL_NO_POLICY);

      const nsB = contractB.storage.namespaces['public'];
      if (!isPostgresSchema(nsB)) throw new Error('expected PostgresSchema for public (B)');
      const nameB = Object.values(nsB.policy)[0]?.name ?? '';

      // Introspect the live DB (which still has p_read_<hashB> from step 3).
      const introspected = await familyInstance.introspect({ driver, contract: contractNoPolicy });

      const verifyResult = familyInstance.verifySchema({
        contract: contractNoPolicy,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });

      expect(verifyResult.ok).toBe(false);
      const extraIssues = verifyResult.schema.issues.filter((i) => i.reason === 'not-expected');
      expect(extraIssues.length).toBeGreaterThan(0);

      const issueMessages = extraIssues.map((i) => i.message);
      expect(issueMessages.some((m) => m.includes(nameB))).toBe(true);
    },
    testTimeout,
  );
});
