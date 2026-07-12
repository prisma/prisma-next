/**
 * Managed native-enum lifecycle end-to-end against a live (PGlite) database
 * (Phase 2 Slice A DoD):
 *
 *  - Create: a managed `native_enum` + `pg.enum` column migrates from empty —
 *    `CREATE TYPE` is ordered BEFORE the table that uses it (an out-of-order
 *    plan fails at apply on Postgres, so a clean apply is itself the ordering
 *    proof), then `db verify` is clean.
 *  - Drop: removing the block + column plans `DROP TYPE` after the column is
 *    gone; apply succeeds; re-verify clean.
 *  - Verify drift (R10): a managed enum reports missing / extra / value-mismatch.
 *  - External untouched (R5): an external native enum yields ZERO enum ops and
 *    no drift.
 */
import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
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
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

// ============================================================================
// PSL sources
// ============================================================================

const PSL_WITH_ENUM = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "review"
    done   = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

const PSL_WITHOUT_ENUM = `
namespace public {
  model orders {
    id Int @id
  }
}
`;

// Named (non-`public`) schema: this is the shape that exercises the
// schema-qualified, per-segment-quoted enum type name in CREATE TABLE DDL
// (`"auth"."aal_level"`). The `auth` schema is not in the default search_path,
// so a mis-quoted / bare type name fails at apply.
const PSL_AUTH_WITH_ENUM = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model sessions {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;

const PSL_AUTH_WITHOUT_ENUM = `
namespace auth {
  model sessions {
    id Int @id
  }
}
`;

// ============================================================================
// PSL → contract helpers (mirrors rls-lifecycle-e2e.integration.test.ts)
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

function buildContractFromPsl(psl: string, control: ControlPolicy): Contract<SqlStorage> {
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
    // Carries the REAL Postgres target pack's authoring contributions
    // (`postgresTargetDescriptor.authoring`, including `qualifyColumnType` =
    // `postgresQualifyColumnType`), which schema-qualifies a `pg.enum` column's
    // native type for a named (non-default) schema (`aal_level` → `auth.aal_level`).
    // A hand-built target that omits it silently leaves the column bare — the
    // exact contrived-harness gap that let D3-F1 hide — so the authoring object
    // here is the production one, not a fabricated hook.
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
      ...ifDefined('authoring', postgresTargetDescriptor.authoring),
    },
    scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: createPostgresBuiltinCodecLookup(),
    capabilities: { sql: { scalarList: true } },
  });

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  // `native_enum` leaves per-node control unset; the effective grade resolves
  // from the contract-level default policy — set it to model the managed /
  // external grade under test.
  return { ...(result.value as Contract<SqlStorage>), defaultControlPolicy: control };
}

const ALLOW_DESTRUCTIVE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

async function planContract(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy,
) {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
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
  return planResult.plan;
}

async function applyPlan(
  driver: PostgresControlDriver,
  plan: Awaited<ReturnType<typeof planContract>>,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy,
): Promise<void> {
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: plan.spaceId ?? APP_SPACE_ID,
        plan,
        migrationEdges: synthEdges(plan),
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

async function opIds(plan: Awaited<ReturnType<typeof planContract>>): Promise<readonly string[]> {
  const ops = await Promise.all(plan.operations);
  return ops.map((op) => op.id);
}

// ============================================================================
// Tests
// ============================================================================

interface LifecycleConfig {
  readonly label: string;
  readonly schemaName: string;
  readonly typeName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly createPsl: string;
  readonly dropPsl: string;
  /** The per-segment-quoted enum type name the CREATE TABLE column must carry. */
  readonly expectedColumnTypeSql: string;
}

function lifecycleSuite(cfg: LifecycleConfig): void {
  describe.sequential(`managed native-enum lifecycle e2e — ${cfg.label}`, () => {
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

    it(
      'create: CREATE TYPE is planned before the table, applies cleanly, verify is clean',
      async () => {
        const contract = buildContractFromPsl(cfg.createPsl, 'managed');
        const plan = await planContract(contract, emptySchema, INIT_ADDITIVE_POLICY);

        const ids = await opIds(plan);
        const createTypeIdx = ids.indexOf(`createNativeEnumType.${cfg.typeName}`);
        const createTableIdx = ids.indexOf(`table.${cfg.tableName}`);
        expect(createTypeIdx).toBeGreaterThanOrEqual(0);
        expect(createTableIdx).toBeGreaterThanOrEqual(0);
        // Ordering: the type must exist before the table that references it.
        expect(createTypeIdx).toBeLessThan(createTableIdx);

        // The CREATE TABLE column renders the enum type as a per-segment-quoted
        // (schema-qualified) identifier — not bare, not whole-string-quoted.
        const createTableOp = (await Promise.all(plan.operations)).find(
          (op) => op.id === `table.${cfg.tableName}`,
        );
        const createTableSql = createTableOp?.execute.map((s) => s.sql).join('\n') ?? '';
        expect(createTableSql).toContain(`"${cfg.columnName}" ${cfg.expectedColumnTypeSql}`);

        // Apply — an out-of-order plan (or a mis-quoted qualified type name for
        // a named schema) would fail here on Postgres.
        await applyPlan(driver, plan, contract, INIT_ADDITIVE_POLICY);

        // The type and the enum-typed column both exist.
        const typeRow = await driver.query<{ typname: string }>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = $1 AND n.nspname = $2`,
          [cfg.typeName, cfg.schemaName],
        );
        expect(typeRow.rows.map((r) => r.typname)).toEqual([cfg.typeName]);
        const colRow = await driver.query<{ udt_name: string }>(
          `SELECT udt_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [cfg.schemaName, cfg.tableName, cfg.columnName],
        );
        expect(colRow.rows[0]?.udt_name).toBe(cfg.typeName);

        const introspected = await familyInstance.introspect({ driver, contract });
        const verify = familyInstance.verifySchema({
          contract,
          schema: introspected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      testTimeout,
    );

    it(
      'drop: DROP TYPE is planned after the dependent column is gone, applies cleanly, verify is clean',
      async () => {
        const contract = buildContractFromPsl(cfg.dropPsl, 'managed');
        const introspected = await familyInstance.introspect({ driver, contract });
        const plan = await planContract(contract, introspected, ALLOW_DESTRUCTIVE);

        const ids = await opIds(plan);
        const dropTypeIdx = ids.indexOf(`dropNativeEnumType.${cfg.typeName}`);
        const dropColumnIdx = ids.findIndex((id) => id.startsWith('dropColumn.'));
        expect(dropTypeIdx).toBeGreaterThanOrEqual(0);
        expect(dropColumnIdx).toBeGreaterThanOrEqual(0);
        // Ordering: the dependent column must be dropped before its type.
        expect(dropColumnIdx).toBeLessThan(dropTypeIdx);

        await applyPlan(driver, plan, contract, ALLOW_DESTRUCTIVE);

        const typeRow = await driver.query<{ typname: string }>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = $1 AND n.nspname = $2`,
          [cfg.typeName, cfg.schemaName],
        );
        expect(typeRow.rows).toHaveLength(0);

        const reintrospected = await familyInstance.introspect({ driver, contract });
        const verify = familyInstance.verifySchema({
          contract,
          schema: reintrospected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      testTimeout,
    );
  });
}

lifecycleSuite({
  label: 'public schema',
  schemaName: 'public',
  typeName: 'order_status',
  tableName: 'orders',
  columnName: 'status',
  createPsl: PSL_WITH_ENUM,
  dropPsl: PSL_WITHOUT_ENUM,
  expectedColumnTypeSql: '"order_status"',
});

lifecycleSuite({
  label: 'named (auth) schema — qualified quoted type name',
  schemaName: 'auth',
  typeName: 'aal_level',
  tableName: 'sessions',
  columnName: 'aal',
  createPsl: PSL_AUTH_WITH_ENUM,
  dropPsl: PSL_AUTH_WITHOUT_ENUM,
  expectedColumnTypeSql: '"auth"."aal_level"',
});

describe.sequential('managed native-enum verify drift (R10)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    // The managed contract declares an `orders` table too; give the DB the
    // table so the only drift under test is the enum type itself.
    await driver.query('CREATE TABLE "public"."orders" (id int PRIMARY KEY)');
  }, testTimeout);

  function verifyManaged(schema: SqlSchemaIRNode) {
    const contract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
    return familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
  }

  it(
    'missing: contract declares the managed enum, the DB lacks it → verify fails',
    async () => {
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const missing = verify.schema.issues.filter(
        (i) => i.reason === 'not-found' && i.path.some((p) => p.includes('order_status')),
      );
      expect(missing.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'extra: the DB has an undeclared managed enum → verify fails (strict)',
    async () => {
      // The contract's own type present (so it is not "missing"), plus a stray.
      await driver!.query(`CREATE TYPE order_status AS ENUM ('draft', 'review', 'done')`);
      await driver!.query(`CREATE TYPE stray_mood AS ENUM ('happy', 'sad')`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const extra = verify.schema.issues.filter(
        (i) => i.reason === 'not-expected' && i.path.some((p) => p.includes('stray_mood')),
      );
      expect(extra.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'value-mismatch: same type name, different ordered members → verify fails',
    async () => {
      await driver!.query(`CREATE TYPE order_status AS ENUM ('review', 'draft', 'done')`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(false);
      const mismatch = verify.schema.issues.filter(
        (i) => i.reason === 'not-equal' && i.path.some((p) => p.includes('order_status')),
      );
      expect(mismatch.length).toBeGreaterThan(0);
    },
    testTimeout,
  );

  it(
    'clean: the DB matches the declared managed enum exactly → verify passes',
    async () => {
      await driver!.query(`CREATE TYPE order_status AS ENUM ('draft', 'review', 'done')`);
      await driver!.query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status NOT NULL`);
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = verifyManaged(introspected);
      expect(verify.ok).toBe(true);
    },
    testTimeout,
  );
});

describe.sequential('external native enum stays untouched (R5)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  it(
    'migrate from empty produces ZERO enum ops for an external enum',
    async () => {
      const contract = buildContractFromPsl(PSL_WITH_ENUM, 'external');
      const plan = await planContract(contract, emptySchema, INIT_ADDITIVE_POLICY);
      const ids = await opIds(plan);
      expect(ids.some((id) => id.startsWith('createNativeEnumType.'))).toBe(false);
      expect(ids.some((id) => id.startsWith('dropNativeEnumType.'))).toBe(false);
    },
    testTimeout,
  );

  it(
    'verify FAILS on external enum member drift (strict — no valueDrift forgiveness)',
    async () => {
      // Live DB has the type with REORDERED members. Post-#949 the enum rides
      // the DEFAULT reason→category path: a member-drifted enum is a plain
      // `not-equal` → `declaredIncompatible`, which `external` does NOT forgive
      // (it only suppresses EXTRA objects). Strict verify: a drifted enum
      // fails regardless of grade.
      await driver!.query(`CREATE TYPE order_status AS ENUM ('review', 'draft', 'done')`);
      await driver!
        .query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status`)
        .catch(async () => {
          await driver!.query('CREATE TABLE "public"."orders" (id int PRIMARY KEY)');
          await driver!.query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status`);
        });

      const contract = buildContractFromPsl(PSL_WITH_ENUM, 'external');
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: true,
        frameworkComponents,
      });

      expect(verify.ok).toBe(false);
      const mismatch = verify.schema.issues.filter(
        (i) => i.reason === 'not-equal' && i.path.some((p) => p.includes('order_status')),
      );
      expect(mismatch.length).toBeGreaterThan(0);
    },
    testTimeout,
  );
});
