import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  executeContractEmitMock: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock('../../src/control-api/operations/contract-emit', () => ({
  executeContractEmit: mocks.executeContractEmitMock,
}));

type CreateContractEmitCommand =
  typeof import('../../src/commands/contract-emit')['createContractEmitCommand'];

describe('contract emit command', () => {
  let consoleOutput: string[] = [];
  let cleanupMocks: () => void = () => {};
  let createContractEmitCommand: CreateContractEmitCommand;
  let tmpDir = '';

  beforeEach(async () => {
    vi.resetModules();
    ({ createContractEmitCommand } = await import('../../src/commands/contract-emit'));
    tmpDir = await mkdtemp(join(tmpdir(), 'prisma-next-contract-emit-'));

    const commandMocks = setupCommandMocks({ isTTY: false });
    consoleOutput = commandMocks.consoleOutput;
    cleanupMocks = commandMocks.cleanup;

    mocks.loadConfigMock.mockReset();
    mocks.executeContractEmitMock.mockReset();
  }, timeouts.typeScriptCompilation);

  afterEach(async () => {
    cleanupMocks();
    if (tmpDir.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
    vi.clearAllMocks();
  });

  function configWithOutput(outputJsonPath: string) {
    return {
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: {},
      extensionPacks: [],
      contract: {
        source: { load: vi.fn() },
        output: outputJsonPath,
      },
    };
  }

  function emitResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      storageHash: 'storage-hash',
      profileHash: 'profile-hash',
      files: {
        json: join(tmpDir, 'contract.json'),
        dts: join(tmpDir, 'contract.d.ts'),
      },
      ...overrides,
    };
  }

  it('delegates to executeContractEmit and exits successfully', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--json'])).resolves.toBe(0);

    expect(mocks.executeContractEmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: 'prisma-next.config.ts',
        onProgress: expect.any(Function),
      }),
    );
  });

  it('surfaces validationWarning via the terminal UI', async () => {
    cleanupMocks();
    // ui.warn is a no-op when not interactive; promote to TTY so the warning surfaces.
    const interactiveMocks = setupCommandMocks({ isTTY: true });
    consoleOutput = interactiveMocks.consoleOutput;
    cleanupMocks = interactiveMocks.cleanup;

    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(
      emitResult({ validationWarning: 'sample dependency warning' }),
    );

    const command = createContractEmitCommand();
    await expect(executeCommand(command, [])).resolves.toBe(0);

    expect(consoleOutput.some((line) => line.includes('sample dependency warning'))).toBe(true);
  });
});
