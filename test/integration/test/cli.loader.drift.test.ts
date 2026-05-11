import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import testContractSpaceExtension from './contract-space-fixture/control';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';
import { runDbInit } from './utils/db-init-test-helpers';

/**
 * Loader drift-as-fatal lock — when the pinned `refs/head.json.hash`
 * for an extension diverges from the live descriptor's published
 * contract hash, `db init` rejects with a `driftViolation`-coded
 * error envelope (`PN-MIG-5002`, `meta.violations[0].kind === 'drift'`)
 * naming the spaceId and suggesting the user run `prisma-next migrate`.
 *
 * The unit-level lock for the same drift detection lives in
 * `migration-tools/test/aggregate/loader.drift.test.ts`; this file is
 * the integration-level lock that exercises the same path through the
 * CLI surface.
 */

const EXT = testContractSpaceExtension;
const EXT_SPACE_ID = EXT.id;
const extContractJson = EXT.contractSpace!.contractJson;

withTempDir(({ createTempDir }) => {
  describe('aggregate loader - drift detection (db init)', () => {
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
      'rejects db init with driftViolation when pinned head-ref hash differs from descriptor hash',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-init-with-contract-space',
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { testDir, configPath } = testSetup;

          // Emit the app contract so `db init` finds `output/contract.json`.
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Pre-populate the pinned space dir with a structurally valid
          // contract.json (the descriptor's contract, so validation
          // passes) but a `refs/head.json.hash` that differs from the
          // descriptor's `contractSpace.headRef.hash`. Drift fires
          // before the migration-package integrity check, so we don't
          // need any migration packages on disk.
          const migrationsDir = join(testDir, 'migrations');
          const spaceDir = join(migrationsDir, EXT_SPACE_ID);
          await mkdir(join(spaceDir, 'refs'), { recursive: true });
          await writeFile(
            join(spaceDir, 'contract.json'),
            `${JSON.stringify(extContractJson, null, 2)}\n`,
            'utf-8',
          );
          await writeFile(
            join(spaceDir, 'contract.d.ts'),
            '// placeholder for test\nexport {};\n',
            'utf-8',
          );
          await writeFile(
            join(spaceDir, 'refs', 'head.json'),
            `${JSON.stringify(
              { hash: 'sha256:drifted-pinned-hash-for-loader-drift-test', invariants: [] },
              null,
              2,
            )}\n`,
            'utf-8',
          );

          consoleOutput.length = 0;

          await expect(
            runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']),
          ).rejects.toThrow();

          const errorText = consoleOutput.join('\n').trim();
          const start = errorText.indexOf('{');
          const end = errorText.lastIndexOf('}');
          expect(start).toBeGreaterThanOrEqual(0);
          const errorJson = JSON.parse(errorText.slice(start, end + 1)) as Record<string, unknown>;

          expect(errorJson).toMatchObject({
            code: 'PN-MIG-5002',
            domain: 'MIG',
          });
          expect(String(errorJson['summary'])).toContain(EXT_SPACE_ID);
          expect(String(errorJson['fix'])).toMatch(/prisma-next migrate/);
          const meta = errorJson['meta'] as
            | { violations?: Array<{ kind: string; spaceId: string }> }
            | undefined;
          const kinds = (meta?.violations ?? []).map((v) => v.kind);
          const spaces = (meta?.violations ?? []).map((v) => v.spaceId);
          expect(kinds).toContain('drift');
          expect(spaces).toContain(EXT_SPACE_ID);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
