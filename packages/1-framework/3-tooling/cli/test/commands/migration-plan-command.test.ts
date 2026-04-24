import { errorUnfilledPlaceholder } from '@prisma-next/errors/migration';
import { timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationPlanResult } from '../../src/commands/migration-plan';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateMigrationPlanCommand =
  typeof import('../../src/commands/migration-plan')['createMigrationPlanCommand'];

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readFile: vi.fn(),
  loadAllBundles: vi.fn(),
  findLatestMigration: vi.fn(),
  writeMigrationPackage: vi.fn(),
  copyFilesWithRename: vi.fn(),
  writeMigrationTs: vi.fn(),
  assertFrameworkComponentsCompatible: vi.fn(),
  extractSqlDdl: vi.fn(),
  createControlStack: vi.fn(),
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
    copyFilesWithRename: mocks.copyFilesWithRename,
  };
});

vi.mock('@prisma-next/migration-tools/migration-ts', () => ({
  writeMigrationTs: mocks.writeMigrationTs,
}));

vi.mock('../../src/utils/framework-components', () => ({
  assertFrameworkComponentsCompatible: mocks.assertFrameworkComponentsCompatible,
}));

vi.mock('../../src/control-api/operations/extract-sql-ddl', () => ({
  extractSqlDdl: mocks.extractSqlDdl,
}));

vi.mock('@prisma-next/framework-components/control', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/framework-components/control')>(
    '@prisma-next/framework-components/control',
  );
  return { ...actual, createControlStack: mocks.createControlStack };
});

const SAME_HASH = 'sha256:same-hash';

function makeContractJson(storageHash: string): string {
  return JSON.stringify({ storage: { storageHash } });
}

function setupBaseConfig(): void {
  const planner = {
    plan: vi.fn().mockReturnValue({
      kind: 'success',
      plan: {
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        renderTypeScript: vi.fn().mockReturnValue('// migration.ts'),
      },
    }),
  };
  mocks.loadConfig.mockResolvedValue({
    family: { familyId: 'mongo', create: vi.fn().mockReturnValue({}) },
    target: {
      id: 'mongo',
      familyId: 'mongo',
      targetId: 'mongo',
      kind: 'target',
      migrations: {
        createPlanner: vi.fn().mockReturnValue(planner),
        contractToSchema: vi.fn().mockReturnValue({}),
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

  // The repo-wide vitest config uses `isolate: false`, so every `vi.mock(...)`
  // registered above leaks into the next test file in the same worker (which
  // breaks anything that does real fs I/O against `node:fs/promises.readFile`,
  // `command-helpers.loadAllBundles`, or `migration-tools/io.writeMigrationPackage`).
  // Use `doUnmock` (non-hoisted) here so subsequent files see the real modules.
  afterAll(() => {
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('../../src/config-loader');
    vi.doUnmock('../../src/utils/command-helpers');
    vi.doUnmock('@prisma-next/migration-tools/dag');
    vi.doUnmock('@prisma-next/migration-tools/io');
    vi.doUnmock('@prisma-next/migration-tools/migration-ts');
    vi.doUnmock('../../src/utils/framework-components');
    vi.doUnmock('../../src/control-api/operations/extract-sql-ddl');
    vi.doUnmock('@prisma-next/framework-components/control');
    vi.resetModules();
  });

  describe('no-op short-circuit', () => {
    it('returns noOp envelope without dir when hashes match', async () => {
      setupBaseConfig();
      mocks.readFile.mockResolvedValue(makeContractJson(SAME_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [],
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
      expect(result).not.toHaveProperty('dir');
      expect(mocks.writeMigrationTs).not.toHaveBeenCalled();
    });
  });

  describe('non-no-op plan', () => {
    it('scaffolds migration.ts from the planner result and reports operations', async () => {
      setupBaseConfig();
      const OLD_HASH = 'sha256:old-hash';
      const NEW_HASH = 'sha256:new-hash';

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: OLD_HASH,
        migrationId: 'sha256:prev-id',
      });
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);
      mocks.extractSqlDdl.mockReturnValue([]);

      const command = createMigrationPlanCommand();
      const exitCode = await executeCommand(command, ['--json']);

      expect(exitCode).toBe(0);
      expect(mocks.writeMigrationTs).toHaveBeenCalledTimes(1);

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as MigrationPlanResult;
      expect(result).toMatchObject({
        ok: true,
        noOp: false,
        from: OLD_HASH,
        to: NEW_HASH,
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
      });
      expect(result).not.toHaveProperty('migrationId');
    });
  });

  describe('placeholder handling', () => {
    function setupClassBasedConfig(planOperationsGetter: () => unknown[]): void {
      const planMock = vi.fn().mockReturnValue({
        kind: 'success',
        plan: {
          get operations() {
            return planOperationsGetter();
          },
          renderTypeScript: () => '// migration.ts with placeholder',
        },
      });
      const createPlannerMock = vi.fn().mockReturnValue({ plan: planMock });
      const contractToSchemaMock = vi.fn().mockReturnValue({ tables: {}, dependencies: [] });

      mocks.loadConfig.mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue({}),
        },
        target: {
          id: 'postgres',
          familyId: 'sql',
          targetId: 'postgres',
          kind: 'target',
          migrations: {
            createPlanner: createPlannerMock,
            createRunner: vi.fn(),
            contractToSchema: contractToSchemaMock,
            emit: vi.fn(),
          },
        },
        adapter: { kind: 'adapter', familyId: 'sql', targetId: 'postgres' },
        contract: { output: '/tmp/test/contract.json' },
        migrations: { dir: '/tmp/test/migrations' },
      });
      mocks.createControlStack.mockReturnValue({});
    }

    it('returns pendingPlaceholders result when plan.operations throws PN-MIG-2001', async () => {
      setupClassBasedConfig(() => {
        throw errorUnfilledPlaceholder('backfill-users-status:check');
      });

      const OLD_HASH = 'sha256:old-hash';
      const NEW_HASH = 'sha256:new-hash';

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: OLD_HASH,
        migrationId: 'sha256:prev-id',
      });
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);

      const command = createMigrationPlanCommand();
      const exitCode = await executeCommand(command, ['--json']);

      expect(exitCode).toBe(0);

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const result = JSON.parse(jsonLine!) as MigrationPlanResult;
      expect(result).toMatchObject({
        ok: true,
        noOp: false,
        from: OLD_HASH,
        to: NEW_HASH,
        pendingPlaceholders: true,
      });
      expect(result.summary).toContain('placeholder');
      expect(result.dir).toBeDefined();
    });

    it('writes migration.ts and returns pendingPlaceholders when placeholders are present', async () => {
      setupClassBasedConfig(() => {
        throw errorUnfilledPlaceholder('backfill-users-status:run');
      });

      mocks.readFile.mockResolvedValue(makeContractJson('sha256:new'));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: 'sha256:old',
        migrationId: 'sha256:prev',
      });
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);

      const command = createMigrationPlanCommand();
      await executeCommand(command, ['--json']);

      expect(mocks.writeMigrationTs).toHaveBeenCalledTimes(1);
    });
  });

  describe('contract artifact copying', () => {
    it('copies destination contract only when there is no prior migration', async () => {
      setupBaseConfig();
      const NEW_HASH = 'sha256:new-hash';

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue(null);
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);
      mocks.extractSqlDdl.mockReturnValue([]);

      const command = createMigrationPlanCommand();
      await executeCommand(command, ['--json']);

      expect(mocks.copyFilesWithRename).toHaveBeenCalledTimes(1);
      const [, destinationFiles] = mocks.copyFilesWithRename.mock.calls[0]!;
      expect(destinationFiles).toEqual([
        { sourcePath: '/tmp/test/contract.json', destName: 'end-contract.json' },
        { sourcePath: '/tmp/test/contract.d.ts', destName: 'end-contract.d.ts' },
      ]);
    });

    it('copies both destination end-contract.* and start-contract.* when there is a prior migration', async () => {
      setupBaseConfig();
      const OLD_HASH = 'sha256:old-hash';
      const NEW_HASH = 'sha256:new-hash';

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      mocks.loadAllBundles.mockResolvedValue({
        bundles: [
          {
            manifest: { migrationId: 'sha256:prev-id', to: OLD_HASH, toContract: {} },
            dirPath: '/tmp/test/migrations/20260301T0900_prev',
            dirName: '20260301T0900_prev',
          },
        ],
        graph: new Map(),
      });
      mocks.findLatestMigration.mockReturnValue({
        to: OLD_HASH,
        migrationId: 'sha256:prev-id',
      });
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);
      mocks.extractSqlDdl.mockReturnValue([]);

      const command = createMigrationPlanCommand();
      await executeCommand(command, ['--json']);

      expect(mocks.copyFilesWithRename).toHaveBeenCalledTimes(2);
      const [, destinationFiles] = mocks.copyFilesWithRename.mock.calls[0]!;
      const [, sourceFiles] = mocks.copyFilesWithRename.mock.calls[1]!;
      expect(destinationFiles).toEqual([
        { sourcePath: '/tmp/test/contract.json', destName: 'end-contract.json' },
        { sourcePath: '/tmp/test/contract.d.ts', destName: 'end-contract.d.ts' },
      ]);
      expect(sourceFiles).toEqual([
        {
          sourcePath: '/tmp/test/migrations/20260301T0900_prev/end-contract.json',
          destName: 'start-contract.json',
        },
        {
          sourcePath: '/tmp/test/migrations/20260301T0900_prev/end-contract.d.ts',
          destName: 'start-contract.d.ts',
        },
      ]);
    });
  });
});
