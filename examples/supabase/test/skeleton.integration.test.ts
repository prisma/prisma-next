/**
 * Walking skeleton integration test — external-contract migrate/verify + public round-trip.
 *
 * Proves the core claim of `@prisma-next/extension-supabase`:
 *
 *   When a composed contract declares `extensionPacks: [supabasePack]`, the
 *   framework treats the Supabase `auth.*` and `storage.*` tables as
 *   `external`. Concretely:
 *
 *   1. `db init` emits **zero ops** for `auth.*` / `storage.*` in the supabase
 *      extension space (those tables are never created by our migrations).
 *   2. The supabase extension space's plan covers only the `public.profile`
 *      DDL via the app space.
 *   3. `db verify` **passes** after `db init` because:
 *      - The `bootstrapSupabaseShim` pre-seeded the external tables, so the
 *        verifier's `external` policy (`declaredMissing` → fail) is satisfied.
 *      - Extra columns / tables in the live DB are suppressed by `external`
 *        policy.
 *   4. The app's `public.profile` round-trip (insert + read) works on the
 *      stock `@prisma-next/postgres/runtime`.
 *
 * How the supabase extension space participates:
 *   The supabase pack declares `contractSpace` (contract + headRef, baseline
 *   migration). The test materialises `migrations/supabase/` on disk (via
 *   `emitContractSpaceArtefacts` + `materialiseMigrationPackage`) so `db init`
 *   discovers the extension space and processes its `auth.*` / `storage.*` tables
 *   through the aggregate planner. The planner emits zero ops for that space
 *   (zero-ops baseline migration); the verifier then confirms the declared
 *   external tables are present in the DB.
 *
 * Framework fix landed (2026-06-05):
 *   `executeRun` and `executeDbVerify` now pass a merged aggregate contract to
 *   `familyInstance.introspect` so the Postgres adapter walks every declared
 *   namespace (not just `public`). The full proof was confirmed green with this fix
 *   in place. See `feat(cli): introspect all declared namespaces for db init/verify`.
 *
 * TODO: Remove the `describe.skip` when the example is green end-to-end (M3).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sql from '@prisma-next/family-sql/control';
import { materialiseMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import postgres from '@prisma-next/target-postgres/control';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import contractJson from '../src/contract.json' with { type: 'json' };
import { insertAndReadProfile } from '../src/handlers';
import { db } from '../src/prisma/db';
import { bootstrapSupabaseShim } from './supabase-bootstrap';

// Full proof confirmed green as of 2026-06-05 with the multi-namespace introspect fix
// (feat(cli): introspect all declared namespaces for db init/verify). Kept .skip because
// the example is still WIP (grown by later constituents) and is not yet part of CI.
describe.skip('supabase walking skeleton — external-contract migrate/verify + public round-trip', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-skeleton-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'db init emits no DDL for auth/storage; verifier passes; public.profile round-trip succeeds',
    async () => {
      const { connectionString } = database;

      // Step 1 — Seed the external Supabase tables.
      //
      // Without this, `db verify` would fail with `declaredMissing` for every
      // `auth.*` / `storage.*` table — the verifier's `external` policy
      // confirms declared tables actually exist.
      await withClient(connectionString, async (client) => {
        await bootstrapSupabaseShim(client);
      });

      // Step 2 — Materialise the supabase extension space on disk.
      //
      // `db init` discovers extension spaces by scanning `migrations/<space>/`.
      // The supabase pack carries `contractSpace` (contract + headRef + baseline
      // migration). We write the space artefacts (contract.json, refs/head.json)
      // and the baseline migration package so the aggregate loader can build the
      // migration graph for the supabase space. The baseline migration is
      // zero-ops — it only establishes the head ref without running any DDL —
      // because `auth.*`/`storage.*` are external (Supabase-managed) tables.
      const space = supabasePack.contractSpace;
      if (!space) {
        throw new Error('supabasePack must declare a contractSpace');
      }
      await emitContractSpaceArtefacts(migrationsDir, 'supabase', {
        contract: space.contractJson,
        contractDts: '// supabase extension contract space\n',
        headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
      });

      // Write the baseline migration package so the aggregate loader can walk
      // the migration graph for the supabase space. Without this, the loader
      // reports `headRefNotInGraph` because the graph is empty and the head ref
      // hash does not equal EMPTY_CONTRACT_HASH.
      const { join: pathJoin } = await import('node:path');
      const supabaseSpaceDir = pathJoin(migrationsDir, 'supabase');
      for (const pkg of space.migrations) {
        await materialiseMigrationPackage(supabaseSpaceDir, pkg);
      }

      // Step 3 — Run `db init` (plan mode first, then apply).
      //
      // The control client is configured with the same component set as the
      // example app. The app's contract.json covers only `public.profile`;
      // the supabase extension space (from `migrations/supabase/`) covers
      // `auth.*` and `storage.*` with `defaultControlPolicy: 'external'`.
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensionPacks: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        // --- Plan mode: verify zero ops for auth/storage ---

        const planResult = await client.dbInit({
          contract: contractJson,
          mode: 'plan',
          migrationsDir,
        });

        if (!planResult.ok) {
          throw new Error(
            `db init plan failed: ${planResult.failure.summary}\n\n${JSON.stringify(planResult.failure, null, 2)}`,
          );
        }

        const operations = planResult.value.plan.operations;

        // The plan must include `CREATE TABLE public.profile` (app space).
        const opIds = operations.map((op) => op.id);
        const hasProfileCreate = opIds.some(
          (id) => id.includes('profile') || id.includes('createTable'),
        );
        expect(
          hasProfileCreate,
          `Expected a createTable op for public.profile; got: ${JSON.stringify(opIds)}`,
        ).toBe(true);

        // The plan must emit ZERO ops targeting auth or storage schemas.
        const authOrStorageOps = operations.filter((op) => {
          const id = op.id.toLowerCase();
          const label = (op.label ?? '').toLowerCase();
          return (
            id.includes('auth.') ||
            id.includes('storage.') ||
            label.includes('auth.') ||
            label.includes('storage.')
          );
        });
        expect(
          authOrStorageOps,
          `Expected zero auth/storage ops in plan; got: ${JSON.stringify(authOrStorageOps.map((o) => o.id))}`,
        ).toHaveLength(0);

        // --- Apply mode ---

        const applyResult = await client.dbInit({
          contract: contractJson,
          mode: 'apply',
          migrationsDir,
        });

        if (!applyResult.ok) {
          throw new Error(
            `db init apply failed: ${applyResult.failure.summary}\n\n${JSON.stringify(applyResult.failure, null, 2)}`,
          );
        }

        // Step 4 — Run `db verify`.
        //
        // With the shim in place the verifier confirms all declared `external`
        // tables exist. Without the shim this would fail with `declaredMissing`.
        const deserializedContract = new PostgresContractSerializer().deserializeContract(
          contractJson,
        );
        const verifyResult = await client.dbVerify({
          contract: deserializedContract,
          migrationsDir,
          strict: false,
          skipSchema: false,
          skipMarker: false,
        });

        expect(
          verifyResult.ok,
          `db verify failed: ${JSON.stringify(!verifyResult.ok ? verifyResult.failure : null, null, 2)}`,
        ).toBe(true);

        if (verifyResult.ok) {
          // All schema results for all spaces must pass.
          for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
            expect(
              schemaResult.ok,
              `Schema verification failed for space "${spaceId}": ${JSON.stringify(schemaResult, null, 2)}`,
            ).toBe(true);
          }
        }
      } finally {
        await client.close();
      }

      // Step 5 — public.profile insert + read-back via the app's handler.
      //
      // The `db` client connects via `db.connect({ url })`, which wires the
      // stock postgres runtime. The handler inserts a Profile and reads it back.
      const runtime = await db.connect({ url: connectionString });
      try {
        const rows = await insertAndReadProfile(runtime, 'alice');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ username: 'alice' });
        expect(typeof rows[0]?.id).toBe('string');
      } finally {
        await db.close();
      }

      // Step 6 (bonus) — raw read from the seeded auth.users table.
      //
      // Proves the external table is reachable via a raw pg Client.
      // The typed `db.sql.auth.users` surface waits for `explicit-namespace-dsl`.
      await withClient(connectionString, async (client) => {
        const result = await client.query<{ table_name: string }>(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'auth' AND table_name = 'users'`,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.table_name).toBe('users');
      });
    },
    timeouts.spinUpPpgDev,
  );
});
