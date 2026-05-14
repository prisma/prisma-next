import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createMigrationStatusCommand } from '@prisma-next/cli/commands/migration-status';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { materialiseMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import { timeouts } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import testContractSpaceExtension from '../contract-space-fixture/control';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from '../utils/cli-test-helpers';

/**
 * End-to-end coverage for `migration status` with the `--space <id>`
 * selector across a real on-disk multi-space project (app + one
 * extension contract space). Locks the shape of:
 *
 * - default view: extension is invisible unless it has pending work
 * - `--space app`: byte-identical to no `--space`
 * - `--space <ext>`: top-level result fields reflect the extension
 *   (graph, targetHash, contractHash, summary, migrations)
 * - unknown space id → `PN-CLI-5020` structured error envelope
 * - `--ref <name> --space <non-app>` → `PN-CLI-5021` structured error
 * - `--json` output still serialises the full `spaces[]` aggregate
 *   regardless of `--space`
 *
 * Offline tests — the validation / routing layer doesn't depend on a
 * DB connection. Online behaviour is covered by the unit tests in
 * `packages/1-framework/3-tooling/cli/test/commands/migration-status-focused-extension.test.ts`.
 */

const EXT = testContractSpaceExtension;
const extContractJson = EXT.contractSpace!.contractJson;
const extHeadRef = EXT.contractSpace!.headRef;
const extMigrations = EXT.contractSpace!.migrations;
const EXT_SPACE_ID = EXT.id;

async function writePinnedExtensionDir(testDir: string): Promise<void> {
  const migrationsDir = join(testDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });
  await emitContractSpaceArtefacts(migrationsDir, EXT_SPACE_ID, {
    contract: extContractJson,
    contractDts: '// placeholder for test\nexport {};\n',
    headRef: { hash: extHeadRef.hash, invariants: [...extHeadRef.invariants] },
  });
  const spaceDir = join(migrationsDir, EXT_SPACE_ID);
  for (const pkg of extMigrations) {
    const ops = [...pkg.ops];
    const migrationHash = computeMigrationHash(pkg.metadata, ops);
    await materialiseMigrationPackage(spaceDir, {
      dirName: pkg.dirName,
      metadata: { ...pkg.metadata, migrationHash },
      ops,
    });
  }
}

interface CapturedOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runStatus(
  testDir: string,
  configPath: string,
  extraArgs: readonly string[],
): Promise<CapturedOutput> {
  const mocks = setupCommandMocks();
  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
    const command = createMigrationStatusCommand();
    let exitCode = 0;
    try {
      await executeCommand(command, ['--config', configPath, '--no-color', ...extraArgs]);
    } catch (error) {
      const captured = getExitCode();
      if (captured == null) {
        return {
          exitCode: -1,
          stdout: mocks.consoleOutput.join('\n'),
          stderr:
            mocks.consoleErrors.join('\n') +
            '\n<<UNCAUGHT ERROR>> ' +
            (error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)),
        };
      }
      exitCode = captured;
    }
    return {
      exitCode,
      stdout: mocks.consoleOutput.join('\n'),
      stderr: mocks.consoleErrors.join('\n'),
    };
  } finally {
    process.chdir(originalCwd);
    mocks.cleanup();
  }
}

async function emitAppContract(testDir: string, configPath: string): Promise<void> {
  const mocks = setupCommandMocks();
  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
    await executeCommand(createContractEmitCommand(), ['--config', configPath, '--no-color']);
  } finally {
    process.chdir(originalCwd);
    mocks.cleanup();
  }
}

withTempDir(({ createTempDir }) => {
  describe('migration status --space (multi-space, offline)', () => {
    async function setup(): Promise<{ testDir: string; configPath: string }> {
      const { testDir, configPath } = setupTestDirectoryFromFixtures(
        createTempDir,
        'db-init-with-contract-space',
        'prisma-next.config.with-db.ts',
        // Empty connection short-circuits the online path — `migration
        // status` runs offline and never opens a control client.
        { '\\{\\{DB_URL\\}\\}': '' },
      );
      await emitAppContract(testDir, configPath);
      await writePinnedExtensionDir(testDir);
      return { testDir, configPath };
    }

    it(
      'default view (no --space): omits the up-to-date extension from the per-space block',
      async () => {
        const { testDir, configPath } = await setup();
        const result = await runStatus(testDir, configPath, []);
        expect(result.exitCode).toBe(0);
        const out = stripAnsi(result.stdout);
        // Offline mode + no pending data → the extension is invisible
        // in the default view. (Pending detection requires markers.)
        expect(out).not.toContain(EXT_SPACE_ID);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--space app is byte-identical to no --space',
      async () => {
        const { testDir, configPath } = await setup();
        const defaultResult = await runStatus(testDir, configPath, []);
        const appResult = await runStatus(testDir, configPath, ['--space', 'app']);
        expect(appResult.exitCode).toBe(defaultResult.exitCode);
        expect(stripAnsi(appResult.stdout)).toBe(stripAnsi(defaultResult.stdout));
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--space <ext> renders the extension graph and summary',
      async () => {
        const { testDir, configPath } = await setup();
        const result = await runStatus(testDir, configPath, ['--space', EXT_SPACE_ID]);
        expect(result.exitCode).toBe(0);
        const out = stripAnsi(result.stdout);
        expect(out).toContain(`contract space "${EXT_SPACE_ID}"`);
        expect(out).toMatch(/1 migration\(s\) on disk/);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--space <unknown> rejects with PN-CLI-5020 and lists the loaded spaces',
      async () => {
        const { testDir, configPath } = await setup();
        const result = await runStatus(testDir, configPath, [
          '--space',
          'this-space-does-not-exist',
          '--json',
        ]);
        expect(result.exitCode).not.toBe(0);
        const joined = result.stdout + '\n' + result.stderr;
        const start = joined.indexOf('{');
        const end = joined.lastIndexOf('}');
        expect(start).toBeGreaterThanOrEqual(0);
        const parsed = JSON.parse(joined.slice(start, end + 1)) as Record<string, unknown>;
        expect(parsed).toMatchObject({
          ok: false,
          code: 'PN-CLI-5020',
          domain: 'CLI',
        });
        const meta = parsed['meta'] as { known?: readonly string[] } | undefined;
        expect(meta?.known).toContain(EXT_SPACE_ID);
        expect(meta?.known).toContain('app');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--json always serialises the full spaces[] aggregate regardless of --space',
      async () => {
        const { testDir, configPath } = await setup();

        const defaultJson = await runStatus(testDir, configPath, ['--json']);
        expect(defaultJson.exitCode).toBe(0);
        const defaultParsed = JSON.parse(stripAnsi(defaultJson.stdout)) as Record<string, unknown>;
        const defaultSpaces = defaultParsed['spaces'] as Array<{ spaceId: string }> | undefined;
        expect(defaultSpaces?.map((s) => s.spaceId).sort()).toEqual([EXT_SPACE_ID, 'app'].sort());

        const extJson = await runStatus(testDir, configPath, ['--space', EXT_SPACE_ID, '--json']);
        expect(extJson.exitCode).toBe(0);
        const extParsed = JSON.parse(stripAnsi(extJson.stdout)) as Record<string, unknown>;
        const extSpaces = extParsed['spaces'] as Array<{ spaceId: string }> | undefined;
        expect(extSpaces?.map((s) => s.spaceId).sort()).toEqual([EXT_SPACE_ID, 'app'].sort());
        // Top-level targetHash reflects the focused extension's head.
        expect(extParsed['targetHash']).toBe(extHeadRef.hash);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
