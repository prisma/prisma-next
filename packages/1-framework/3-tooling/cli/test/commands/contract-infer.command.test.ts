import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateContractInferCommand =
  typeof import('../../src/commands/contract-infer')['createContractInferCommand'];

const mocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const introspectMock = vi.fn();
  const toSchemaViewMock = vi.fn();
  const closeMock = vi.fn();
  const createControlClientMock = vi.fn(() => ({
    introspect: introspectMock,
    toSchemaView: toSchemaViewMock,
    close: closeMock,
  }));

  return {
    loadConfigMock,
    introspectMock,
    toSchemaViewMock,
    closeMock,
    createControlClientMock,
  };
});

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClientMock,
}));

const baseConfig = {
  family: { familyId: 'sql' },
  target: { targetId: 'postgres' },
  adapter: {},
  driver: {},
  extensionPacks: [],
  contract: {
    output: 'output/contract.json',
  },
  db: {
    connection: 'postgres://user:pass@localhost:5432/prisma_next',
  },
} as const;

const schemaIR = {
  tables: {
    user: {
      name: 'user',
      columns: {
        id: {
          name: 'id',
          nativeType: 'int4',
          nullable: false,
        },
        email: {
          name: 'email',
          nativeType: 'text',
          nullable: false,
        },
      },
      primaryKey: {
        columns: ['id'],
      },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    },
  },
  dependencies: [],
} as const;

describe('createContractInferCommand', () => {
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void = () => {};
  let testDir: string;
  let createContractInferCommand: CreateContractInferCommand;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    vi.resetModules();
    ({ createContractInferCommand } = await import('../../src/commands/contract-infer'));

    testDir = mkdtempSync(join(tmpdir(), 'prisma-next-contract-infer-'));
    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    consoleErrors = commandMocks.consoleErrors;
    cleanupMocks = commandMocks.cleanup;

    mocks.loadConfigMock.mockResolvedValue(baseConfig);
    mocks.introspectMock.mockResolvedValue(schemaIR);
    mocks.toSchemaViewMock.mockReturnValue(undefined);
    mocks.closeMock.mockResolvedValue(undefined);
    mocks.createControlClientMock.mockClear();
  }, timeouts.typeScriptCompilation);

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupMocks();
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes to a custom output path when --output is provided', async () => {
    process.chdir(testDir);

    await executeCommand(createContractInferCommand(), [
      '--config',
      'prisma-next.config.ts',
      '--output',
      'prisma/custom-contract.prisma',
      '--no-color',
    ]);

    const customOutputPath = join(testDir, 'prisma/custom-contract.prisma');
    expect(existsSync(customOutputPath)).toBe(true);
    expect(readFileSync(customOutputPath, 'utf-8')).toContain('model User');
    expect(consoleErrors.join('\n')).toContain('Contract written to prisma/custom-contract.prisma');
  });

  it('warns before overwriting an existing inferred PSL file', async () => {
    process.chdir(testDir);

    const command = createContractInferCommand();
    await executeCommand(command, ['--config', 'prisma-next.config.ts', '--no-color']);
    consoleOutput.length = 0;
    consoleErrors.length = 0;

    await executeCommand(command, ['--config', 'prisma-next.config.ts', '--no-color']);

    const stderrOutput = consoleErrors.join('\n');
    expect(stderrOutput).toContain('Overwriting existing file: output/contract.prisma');
    expect(stderrOutput).toContain('Contract written to output/contract.prisma');
  });

  it('writes the default inferred PSL next to the config file when --config points to a nested project', async () => {
    process.chdir(testDir);

    await executeCommand(createContractInferCommand(), [
      '--config',
      'apps/web/prisma-next.config.ts',
      '--no-color',
    ]);

    expect(existsSync(join(testDir, 'apps/web/output/contract.prisma'))).toBe(true);
    expect(existsSync(join(testDir, 'output/contract.prisma'))).toBe(false);
    expect(consoleErrors.join('\n')).toContain(
      'Contract written to apps/web/output/contract.prisma',
    );
  });

  it('suppresses overwrite warnings and success output in quiet mode', async () => {
    process.chdir(testDir);

    const command = createContractInferCommand();
    await executeCommand(command, ['--config', 'prisma-next.config.ts', '--no-color']);
    consoleOutput.length = 0;
    consoleErrors.length = 0;

    await executeCommand(command, ['--config', 'prisma-next.config.ts', '--quiet', '--no-color']);

    const stderrOutput = consoleErrors.join('\n');
    expect(stderrOutput).not.toContain('Overwriting existing file');
    expect(stderrOutput).not.toContain('Contract written to');
  });

  it('prints JSON output in --json mode while still writing the inferred PSL file', async () => {
    process.chdir(testDir);

    await executeCommand(createContractInferCommand(), [
      '--config',
      'prisma-next.config.ts',
      '--json',
      '--no-color',
    ]);

    const parsed = JSON.parse(consoleOutput.join('\n')) as {
      readonly summary: string;
      readonly psl: { readonly path: string };
      readonly meta: { readonly configPath: string; readonly dbUrl: string };
    };
    expect(parsed).toMatchObject({
      summary: 'Contract inferred successfully',
      psl: { path: 'output/contract.prisma' },
      meta: {
        configPath: 'prisma-next.config.ts',
        dbUrl: 'postgres://****:****@localhost:5432/prisma_next',
      },
    });
    expect(consoleErrors).toEqual([]);
    expect(existsSync(join(testDir, 'output/contract.prisma'))).toBe(true);
  });

  it('returns inspect errors without writing an inferred PSL file', async () => {
    process.chdir(testDir);
    mocks.loadConfigMock.mockResolvedValue({
      ...baseConfig,
      driver: undefined,
    });

    await expect(
      executeCommand(createContractInferCommand(), [
        '--config',
        'prisma-next.config.ts',
        '--no-color',
      ]),
    ).rejects.toThrow('process.exit called');

    expect(existsSync(join(testDir, 'output/contract.prisma'))).toBe(false);
    expect(consoleErrors.join('\n')).toContain('Driver is required for DB-connected commands');
  });
});
