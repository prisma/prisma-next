/**
 * Shared harness for the better-auth adapter integration suites: stands up
 * a PGlite database and a consuming app (the `better-auth-lifecycle`
 * fixture, whose `prisma-next.config.ts` lists the better-auth pack in
 * `extensionPacks`), migrates it exclusively through the framework CLI
 * path (contract emit → migration plan → db init — the managed-space
 * lifecycle mechanism), and exposes an ordinary prisma-next Postgres
 * client for `prismaNextAdapter`.
 *
 * `runMigrations` re-runs `db init`, which is a no-op at head — matching
 * the BetterAuth test harness's expectation that migrations are safely
 * repeatable. The fixture's schema is fixed (plugin tables and
 * `additionalFields` are project non-goals), so no schema-mutating
 * migration path is needed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Contract } from '@prisma-next/extension-better-auth/contract';
import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import postgres from '@prisma-next/postgres/runtime';
import { createDevDatabase } from '@prisma-next/test-utils';
import { fixtureAppDir, setupTestDirectoryFromFixtures } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runMigrationPlan,
} from './utils/journey-test-helpers';

export interface BetterAuthTestApp {
  readonly connectionString: string;
  readonly client: ReturnType<typeof postgres<Contract>>;
  readonly ctx: JourneyContext;
  runMigrations(): Promise<void>;
  teardown(): Promise<void>;
}

export async function setupBetterAuthTestApp(): Promise<BetterAuthTestApp> {
  const database = await createDevDatabase();
  const tempRoot = mkdtempSync(join(fixtureAppDir, 'better-auth-harness-'));

  const testSetup = setupTestDirectoryFromFixtures(
    () => tempRoot,
    'better-auth-lifecycle',
    'prisma-next.config.with-db.ts',
    { '{{DB_URL}}': database.connectionString },
  );
  const ctx: JourneyContext = {
    testDir: testSetup.testDir,
    configPath: testSetup.configPath,
    outputDir: testSetup.outputDir,
  };

  const emit = await runContractEmit(ctx);
  if (emit.exitCode !== 0) {
    throw new Error(`contract emit failed:\n${emit.stdout}\n${emit.stderr}`);
  }
  const plan = await runMigrationPlan(ctx, ['--name', 'app_init']);
  if (plan.exitCode !== 0) {
    throw new Error(`migration plan failed:\n${plan.stdout}\n${plan.stderr}`);
  }

  // `db init` walks the managed space to head once, up front (module scope —
  // in-process CLI mocks cannot run inside a vitest test body). The schema is
  // fixed, so the harness's repeated `runMigrations` calls are no-ops at
  // head, exactly like a real re-run of `db init` (proven by the lifecycle
  // integration test).
  const init = await runDbInit(ctx);
  if (init.exitCode !== 0) {
    throw new Error(`db init failed:\n${init.stdout}\n${init.stderr}`);
  }
  const runMigrations = async (): Promise<void> => {};

  // The adapter needs only the four contract-space collections; the space's
  // own contract (shipped on the pack) is the minimal client view. The
  // database itself carries the full aggregate created by `db init` above.
  const client = postgres<Contract>({
    contractJson: betterAuthPack.contractSpace?.contractJson,
    url: database.connectionString,
    verifyMarker: false,
  });

  return {
    connectionString: database.connectionString,
    client,
    ctx,
    runMigrations,
    async teardown() {
      await client.close();
      await database.close();
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}
