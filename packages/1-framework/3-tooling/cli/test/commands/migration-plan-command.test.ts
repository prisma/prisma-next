import { errorUnfilledPlaceholder } from '@prisma-next/errors/migration';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { reconstructGraph } from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationPlanResult } from '../../src/commands/migration-plan';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateMigrationPlanCommand =
  typeof import('../../src/commands/migration-plan')['createMigrationPlanCommand'];

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readFile: vi.fn(),
  loadMigrationPackages: vi.fn(),
  readRefs: vi.fn(),
  readRefSnapshot: vi.fn(),
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
    loadMigrationPackages: mocks.loadMigrationPackages,
  };
});

vi.mock('@prisma-next/migration-tools/refs', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/refs')>(
    '@prisma-next/migration-tools/refs',
  );
  return { ...actual, readRefs: mocks.readRefs, readRefSnapshot: mocks.readRefSnapshot };
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

const SAME_HASH = `sha256:${'a'.repeat(64)}`;
const OLD_HASH = `sha256:${'b'.repeat(64)}`;
const NEW_HASH = `sha256:${'c'.repeat(64)}`;

function makeContractJson(storageHash: string, target = 'mongo'): string {
  return JSON.stringify({ storage: { storageHash }, target });
}

function sampleSnapshot(storageHash: string) {
  return {
    contract: JSON.parse(makeContractJson(storageHash)),
    contractDts: 'export type Contract = unknown;\n',
  };
}

function setupDbRefFromHash(hash: string): void {
  mocks.readRefs.mockResolvedValue({ db: { hash, invariants: [] } });
  mocks.readRefSnapshot.mockResolvedValue(sampleSnapshot(hash));
}

function setupGreenfieldRefs(): void {
  mocks.readRefs.mockResolvedValue({});
}

function makeBundle(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/tmp/test/migrations/${dirName}`,
    metadata: {
      from: from === EMPTY_CONTRACT_HASH ? null : from,
      to,
      migrationHash: 'sha256:prev-id',
      createdAt: '2026-03-01T09:00:00.000Z',
      labels: [],
      hints: { used: [], applied: ['additive_only'], plannerVersion: '0.0.1' },
      providedInvariants: [],
    },
    ops: [],
  };
}

function graphWithPriorMigration(fromHash: string): {
  bundles: OnDiskMigrationPackage[];
  graph: ReturnType<typeof reconstructGraph>;
} {
  const bundles = [makeBundle(EMPTY_CONTRACT_HASH, fromHash, '20260301T0900_prev')];
  return { bundles, graph: reconstructGraph(bundles) };
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
    family: {
      familyId: 'mongo',
      create: vi.fn().mockReturnValue({
        deserializeContract: (c: unknown) => c,
      }),
    },
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
  mocks.createControlStack.mockReturnValue({});
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
  // `command-helpers.loadMigrationPackages`, or `migration-tools/io.writeMigrationPackage`).
  // Use `doUnmock` (non-hoisted) here so subsequent files see the real modules.
  afterAll(() => {
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('../../src/config-loader');
    vi.doUnmock('../../src/utils/command-helpers');
    vi.doUnmock('@prisma-next/migration-tools/refs');
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
      const { bundles, graph } = graphWithPriorMigration(SAME_HASH);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      setupDbRefFromHash(SAME_HASH);

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
      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH));
      const { bundles, graph } = graphWithPriorMigration(OLD_HASH);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      setupDbRefFromHash(OLD_HASH);
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
      expect(result).not.toHaveProperty('migrationHash');
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
      const contractToSchemaMock = vi.fn().mockReturnValue({ tables: {} });

      mocks.loadConfig.mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue({
            deserializeContract: (c: unknown) => c,
          }),
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

      const NEW_HASH = `sha256:${'n'.repeat(64)}`;

      mocks.readFile.mockResolvedValue(makeContractJson(NEW_HASH, 'postgres'));
      const { bundles, graph } = graphWithPriorMigration(OLD_HASH);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      setupDbRefFromHash(OLD_HASH);
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

      mocks.readFile.mockResolvedValue(makeContractJson(`sha256:${'c'.repeat(64)}`, 'postgres'));
      const { bundles, graph } = graphWithPriorMigration(`sha256:${'b'.repeat(64)}`);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      setupDbRefFromHash(`sha256:${'b'.repeat(64)}`);
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
      mocks.loadMigrationPackages.mockResolvedValue({
        bundles: [],
        graph: new Map(),
      });
      setupGreenfieldRefs();
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

    it('copies both destination end-contract.* and start-contract.* when --from resolves via graph node', async () => {
      setupBaseConfig();
      mocks.readFile.mockImplementation(async (path: string) => {
        if (typeof path === 'string' && path.endsWith('end-contract.json')) {
          return makeContractJson(OLD_HASH);
        }
        return makeContractJson(NEW_HASH);
      });
      const { bundles, graph } = graphWithPriorMigration(OLD_HASH);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      mocks.readRefs.mockResolvedValue({});
      mocks.assertFrameworkComponentsCompatible.mockReturnValue([]);
      mocks.writeMigrationPackage.mockResolvedValue(undefined);
      mocks.copyFilesWithRename.mockResolvedValue(undefined);
      mocks.extractSqlDdl.mockReturnValue([]);

      const command = createMigrationPlanCommand();
      await executeCommand(command, ['--json', '--from', OLD_HASH]);

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

    it('surfaces a structured file-not-found error when the predecessor end-contract.json is missing', async () => {
      // Locks the spec acceptance criterion for TML-2512: `migration plan`
      // must surface a clear structured CLI error (not a raw ENOENT crash)
      // when it cannot read the previous migration's destination contract
      // snapshot.
      const { consoleErrors, consoleOutput: localConsoleOutput } = setupCommandMocks({
        isTTY: false,
      });
      setupBaseConfig();

      mocks.readFile.mockImplementation(async (path: string) => {
        if (typeof path === 'string' && path.endsWith('end-contract.json')) {
          const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & {
            code: string;
          };
          err.code = 'ENOENT';
          throw err;
        }
        return makeContractJson(NEW_HASH);
      });
      const { bundles, graph } = graphWithPriorMigration(OLD_HASH);
      mocks.loadMigrationPackages.mockResolvedValue({ bundles, graph });
      mocks.readRefs.mockResolvedValue({});

      const command = createMigrationPlanCommand();
      await expect(executeCommand(command, ['--json', '--from', OLD_HASH])).rejects.toThrow(
        'process.exit called',
      );

      const message = [...localConsoleOutput, ...consoleErrors].join('\n');
      expect(message).toContain('end-contract.json');
      expect(message).toContain('20260301T0900_prev');
      expect(message).toContain('Re-emit the predecessor migration');
    });
  });
});
