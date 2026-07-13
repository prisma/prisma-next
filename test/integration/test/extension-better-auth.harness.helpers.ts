/**
 * Shared harness for the better-auth adapter integration suites: stands up
 * a PGlite database and a consuming app (the `better-auth-lifecycle`
 * fixture, whose `prisma-next.config.ts` lists the better-auth pack in
 * `extensionPacks`), migrates it exclusively through the framework CLI
 * path (contract emit → migration plan → db init — the managed-space
 * lifecycle mechanism), and exposes an ordinary prisma-next Postgres
 * client for `prismaNextAdapter`.
 *
 * `runMigrations` is an intentional no-op: `db init` already walked the
 * managed space to head once during setup (module scope — in-process CLI
 * mocks cannot run inside a vitest test body), and the fixture's schema
 * is fixed (plugin tables and `additionalFields` are project non-goals),
 * so repeated harness migration calls have nothing to do — exactly like
 * a real re-run of `db init` at head, as proven by the lifecycle test.
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
  // The dev server's 1s default idle timeout reaps pooled connections
  // between tests of the long-running conformance suites, surfacing as
  // async "Connection terminated unexpectedly" errors and a teardown
  // `client.close()` that cannot drain its pool. Keep idle connections
  // alive for the lifetime of the suite instead.
  const database = await createDevDatabase({ databaseIdleTimeoutMillis: 600_000 });
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
      // After the full conformance run's connection churn (hundreds of
      // pool acquisitions across 200+ tests), the dev server's close()
      // never resolves — the same teardown returns promptly after the
      // small betterauth-e2e run, so the leak scales with connection
      // volume inside @prisma/dev's socket server, not with anything the
      // harness holds open (the adapter client is already closed above).
      // Bound the wait: the per-file vitest worker exits right after
      // teardown, taking the in-memory PGlite with it. Tracked as
      // TML-3017.
      await Promise.race([
        database.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}
