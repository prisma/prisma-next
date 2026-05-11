import {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { ParamRef, TableSource, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { AST_BOUND_SENTINEL } from '@prisma-next/target-postgres/data-transform';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe.sequential('PostgresMigrationRunner - AST-bound step resolution', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  async function applySchemaAndSeedData(d: PostgresControlDriver): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    if (planResult.kind !== 'success') throw new Error('expected planner success');

    const execResult = await runner.execute({
      plan: planResult.plan,
      driver: d,
      destinationContract: contract,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });
    if (!execResult.ok)
      throw new Error(`schema apply failed: ${formatRunnerFailure(execResult.failure)}`);

    await d.query(
      `INSERT INTO public."user" (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'old@example.com')`,
    );
  }

  it(
    'resolves AST-bound execute steps at apply time and executes the lowered SQL',
    { timeout: testTimeout },
    async () => {
      await applySchemaAndSeedData(driver!);

      const updateAst = UpdateAst.table(TableSource.named('user')).withSet({
        email: ParamRef.of('updated@example.com', { codec: { codecId: 'pg/text@1' } }),
      });

      const astBoundOp: SqlMigrationPlanOperation<PostgresPlanTargetDetails> = {
        id: 'data_migration_ast.email-update',
        label: 'Data transform (AST): email-update',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: 'Update user emails',
            sql: AST_BOUND_SENTINEL,
            meta: { ast: JSON.parse(JSON.stringify(updateAst)) as Record<string, unknown> },
          },
        ],
        postcheck: [],
      };

      const plan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: toPlanContractInfo(contract),
        destination: toPlanContractInfo(contract),
        operations: [astBoundOp],
        providedInvariants: [],
      });

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const result = await runner.execute({
        plan,
        driver: driver!,
        destinationContract: contract,
        policy: { allowedOperationClasses: ['data'] },
        frameworkComponents,
      });

      expect(result.ok, result.ok ? '' : formatRunnerFailure(result.failure)).toBe(true);
      if (!result.ok) return;
      expect(result.value.operationsExecuted).toBe(1);

      const rows = await driver!.query<{ email: string }>(
        `SELECT email FROM public."user" WHERE id = '00000000-0000-0000-0000-000000000001'`,
      );
      expect(rows.rows[0]?.email).toBe('updated@example.com');
    },
  );

  it(
    'resolves AST-bound precheck/postcheck steps at apply time',
    { timeout: testTimeout },
    async () => {
      await applySchemaAndSeedData(driver!);

      const updateAst = UpdateAst.table(TableSource.named('user')).withSet({
        email: ParamRef.of('checked@example.com', { codec: { codecId: 'pg/text@1' } }),
      });

      const astBoundOp: SqlMigrationPlanOperation<PostgresPlanTargetDetails> = {
        id: 'data_migration_ast.checked-update',
        label: 'Data transform (AST): checked-update',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [
          {
            description: 'Precheck always true',
            sql: 'SELECT true',
          },
        ],
        execute: [
          {
            description: 'Update user emails',
            sql: AST_BOUND_SENTINEL,
            meta: { ast: JSON.parse(JSON.stringify(updateAst)) as Record<string, unknown> },
          },
        ],
        postcheck: [],
      };

      const plan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: APP_SPACE_ID,
        origin: toPlanContractInfo(contract),
        destination: toPlanContractInfo(contract),
        operations: [astBoundOp],
        providedInvariants: [],
      });

      const runner = postgresTargetDescriptor.createRunner(familyInstance);
      const result = await runner.execute({
        plan,
        driver: driver!,
        destinationContract: contract,
        policy: { allowedOperationClasses: ['data'] },
        frameworkComponents,
      });

      expect(result.ok, result.ok ? '' : formatRunnerFailure(result.failure)).toBe(true);
    },
  );
});
