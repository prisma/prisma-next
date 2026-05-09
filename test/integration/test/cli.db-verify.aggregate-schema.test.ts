import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createDbVerifyCommand } from '@prisma-next/cli/commands/db-verify';
import type { Contract } from '@prisma-next/contract/types';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { materialiseMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import testContractSpaceExtension from './contract-space-fixture/control';
import {
  executeCommand,
  getExitCode,
  loadContractFromDisk,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

/**
 * F23 lock — `db verify` against a multi-member aggregate (app +
 * extension, both claiming live tables) returns zero schema issues.
 *
 * Pre-aggregate (M2 R6 R1), `db verify` projected the live schema only
 * through the app contract. Tables claimed by extensions surfaced as
 * `extras` and tripped lenient/strict schema diffs, polluting the
 * verify output. The aggregate verifier (M2.5) pre-projects the live
 * schema per member before running the family's schema-verify, so each
 * member only sees the elements it owns.
 *
 * Setup mirrors the spec's intent (sub-spec § "Commit 6"):
 * - app contract claims `user`
 * - extension `test-contract-space` claims `test_box`
 * - both tables exist in the live DB and both markers match the
 *   pinned contracts
 *
 * Expected: `db verify` exits 0 with `ok: true` and zero schema issues.
 */

const EXT = testContractSpaceExtension;
const extContractJson = EXT.contractSpace!.contractJson;
const extHeadRef = EXT.contractSpace!.headRef;
const extMigrations = EXT.contractSpace!.migrations;
const EXT_SPACE_ID = EXT.id;

async function writePinnedExtensionDir(testDir: string): Promise<string> {
  const migrationsDir = join(testDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  // The on-disk head ref's invariants must be derivable from the
  // on-disk ops (`deriveProvidedInvariants`) — that derivation only
  // counts data-class ops. The test extension's baseline op is
  // additive, so its declared invariants live in memory only and do
  // not survive a disk round-trip. For the F23 verify test we drop
  // the pinned invariants (the schema verifier doesn't consult them).
  await emitContractSpaceArtefacts(migrationsDir, EXT_SPACE_ID, {
    contract: extContractJson,
    contractDts: '// placeholder for test\nexport {};\n',
    headRef: { hash: extHeadRef.hash, invariants: [] },
  });

  const spaceDir = join(migrationsDir, EXT_SPACE_ID);
  for (const pkg of extMigrations) {
    const ops = [...pkg.ops];
    const baseMeta = { ...pkg.metadata, providedInvariants: [] };
    const migrationHash = computeMigrationHash(baseMeta, ops);
    await materialiseMigrationPackage(spaceDir, {
      dirName: pkg.dirName,
      metadata: { ...baseMeta, migrationHash },
      ops,
    });
  }

  return migrationsDir;
}

withTempDir(({ createTempDir }) => {
  describe('db verify command - aggregate schema verification (F23)', () => {
    let consoleOutput: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it(
      'returns zero schema issues when app and extension both claim live tables',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-init-with-contract-space',
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { testDir, configPath } = testSetup;

          // Pre-emit pinned migrations for the test extension so the
          // aggregate loader's layout / integrity / drift checks pass.
          await writePinnedExtensionDir(testDir);

          // Emit the app contract so `db verify` has a contract.json to
          // compare against. The fixture's `contract.output` points at
          // `src/prisma/contract.json`.
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const appContractPath = join(testDir, 'src/prisma/contract.json');
          const appContract = loadContractFromDisk<Contract<SqlStorage>>(appContractPath);

          // Live DB: create both tables and both markers.
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id integer NOT NULL,
                email text NOT NULL,
                PRIMARY KEY (id)
              )
            `);
            await client.query(`
              CREATE TABLE IF NOT EXISTS test_box (
                x integer NOT NULL,
                y integer NOT NULL
              )
            `);

            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            const appMarker = writeContractMarker({
              space: APP_SPACE_ID,
              storageHash: appContract.storage.storageHash,
              profileHash: appContract.profileHash ?? appContract.storage.storageHash,
              contractJson: appContract,
              canonicalVersion: 1,
            });
            await executeStatement(client, appMarker.insert);

            const extMarker = writeContractMarker({
              space: EXT_SPACE_ID,
              storageHash: extContractJson.storage.storageHash,
              profileHash: extContractJson.profileHash ?? extContractJson.storage.storageHash,
              contractJson: extContractJson,
              canonicalVersion: 1,
              invariants: [...extHeadRef.invariants],
            });
            await executeStatement(client, extMarker.insert);
          });

          consoleOutput.length = 0;

          const command = createDbVerifyCommand();
          const verifyCwd = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(command, ['--config', configPath, '--json', '--no-color']);
          } finally {
            process.chdir(verifyCwd);
          }

          expect(getExitCode()).toBe(0);

          const joined = consoleOutput.join('\n');
          const start = joined.indexOf('{');
          const end = joined.lastIndexOf('}');
          expect(start).toBeGreaterThanOrEqual(0);
          const parsed = JSON.parse(joined.slice(start, end + 1)) as Record<string, unknown>;

          expect(parsed).toMatchObject({
            ok: true,
            mode: 'full',
          });
          const schema = parsed['schema'] as
            | { counts?: { fail?: number; warn?: number } }
            | undefined;
          expect(schema?.counts?.fail ?? -1).toBe(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
