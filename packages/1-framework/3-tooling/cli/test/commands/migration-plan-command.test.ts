import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationPlanResult } from '../../src/commands/migration-plan';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateMigrationPlanCommand =
  typeof import('../../src/commands/migration-plan')['createMigrationPlanCommand'];

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readFile: vi.fn(),
  loadAllBundles: vi.fn(),
  findLatestMigration: vi.fn(),
  emitMigration: vi.fn(),
  writeMigrationPackage: vi.fn(),
  copyContractToMigrationDir: vi.fn(),
  writeMigrationTs: vi.fn(),
  assertFrameworkComponentsCompatible: vi.fn(),
  extractSqlDdl: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: mocks.readFile };
});

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../src/utils/command-helpers', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/command-helpers')>(
    '../../src/utils/command-helpers',
  );
  return {
    ...actual,
    loadAllBundles: mocks.loadAllBundles,
  };
});

vi.mock('@prisma-next/migration-tools/dag', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/dag')>(
    '@prisma-next/migration-tools/dag',
  );
  return { ...actual, findLatestMigration: mocks.findLatestMigration };
});

vi.mock('@prisma-next/migration-tools/io', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/io')>(
    '@prisma-next/migration-tools/io',
  );
  return {
    ...actual,
    writeMigrationPackage: mocks.writeMigrationPackage,
    copyContractToMigrationDir: mocks.copyContractToMigrationDir,
  };
});

vi.mock('@prisma-next/migration-tools/migration-ts', () => ({
  writeMigrationTs: mocks.writeMigrationTs,
}));

vi.mock('../../src/lib/migration-emit', () => ({
  emitMigration: mocks.emitMigration,
}));

vi.mock('../../src/utils/framework-components', () => ({
  assertFrameworkComponentsCompatible: mocks.assertFrameworkComponentsCompatible,
}));

vi.mock('../../src/control-api/operations/extract-sql-ddl', () => ({
  extractSqlDdl: mocks.extractSqlDdl,
}));

const SAME_HASH = 'sha256:same-hash';

function makeContractJson(storageHash: string): string {
  return JSON.stringify({ storage: { storageHash } });
}

function setupBaseConfig(): void {
  mocks.loadConfig.mockResolvedValue({
    family: { familyId: 'mongo' },
    target: {
      id: 'mongo',
      familyId: 'mongo',
      targetId: 'mongo',
      kind: 'target',
      migrations: {
        planWithDescriptors: vi.fn().mockReturnValue({
          ok: true,
          descriptors: [{ kind: 'createTable', tableName: 'user' }],
        }),
        renderDescriptorTypeScript: vi.fn().mockReturnValue('// migration.ts'),
        resolveDescriptors: vi.fn().mockReturnValue([]),
      },
    },
    adapter: { kind: 'adapter', familyId: 'mongo', targetId: 'mongo' },
    contract: { output: '/tmp/test/contract.json' },
    migrations: { dir: '/tmp/test/migrations' },
  });
}

describe('migration plan command', () => {
  let consoleOutput: string[];
  let cleanupMocks: () => void;
  let createMigrationPlanCommand: CreateMigrationPlanCommand;

  beforeEach(async () => {
    vi.resetModules();
    ({ createMigrationPlanCommand } = await import('../../src/commands/migration-plan'));

    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    cleanupMocks = commandMocks.cleanup;

    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  }, timeouts.typeScriptCompilation);

  afterEach(() => {
    cleanupMocks();
    vi.clearAllMocks();
  });

  describe('no-op short-circuit', () => {
    it('returns noOp envelope without migrationId or dir when hashes match', async () => {
      setupBaseConfig();
      mocks.readFile.mockResolvedValue(makeContractJson(SAME_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        attested: [],
        drafts: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: SAME_HASH,
        migrationId: 'sha256:prev',
      });

      const command = createMigrationPlanCommand();
      const exitCode = await executeCommand(command, ['--json']);

      expect(exitCode).toBe(0);

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as MigrationPlanResult;
      expect(result).toMatchObject({
        ok: true,
        noOp: true,
        from: SAME_HASH,
        to: SAME_HASH,
        operations: [],
        summary: 'No changes detected between contracts',
      });
      expect(result).not.toHaveProperty('migrationId');
      expect(result).not.toHaveProperty('dir');
      expect(mocks.emitMigration).not.toHaveBeenCalled();
      expect(mocks.writeMigrationTs).not.toHaveBeenCalled();
    });
  });

  describe('emit-after-scaffold ordering', () => {
    it('calls emitMigration after writeMigrationTs in non-no-op path', async () => {
      setupBaseConfig();
      const OLD_HASH = 'sha256:old-hash';
      const NEW_HASH = 'sha256:new-hash';

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        attested: [],
        drafts: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: OLD_HASH,
        migrationId: 'sha256:prev-id',
      });
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyContractToMigrationDir.mockResolvedValue(undefined);
      mocks.extractSqlDdl.mockReturnValue([]);

      const callOrder: string[] = [];
      mocks.writeMigrationTs.mockImplementation(async () => {
        callOrder.push('writeMigrationTs');
      });
      mocks.emitMigration.mockImplementation(async () => {
        callOrder.push('emitMigration');
        return {
          operations: [
            { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
          ],
          migrationId: 'sha256:new-id',
        };
      });

      const command = createMigrationPlanCommand();
      const exitCode = await executeCommand(command, ['--json']);

      expect(exitCode).toBe(0);
      expect(callOrder).toEqual(['writeMigrationTs', 'emitMigration']);
      expect(mocks.emitMigration).toHaveBeenCalledTimes(1);
    });
  });
});
