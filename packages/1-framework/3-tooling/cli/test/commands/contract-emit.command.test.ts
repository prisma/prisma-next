import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, getExitCode, setupCommandMocks } from '../utils/test-helpers';

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

  it('emits human-readable success output on piped stdout with --format pretty', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--format', 'pretty'])).resolves.toBe(0);

    const combined = consoleOutput.join('\n');
    expect(combined).toMatch(/Emitted contract\.json/i);
  });

  it('rejects --format pretty together with --json via structured error', async () => {
    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--format', 'pretty', '--json'])).rejects.toThrow(
      'process.exit called',
    );
    expect(getExitCode()).toBe(2);
    const combined = consoleOutput.join('\n');
    expect(combined).toContain('PN-CLI-4015');
    expect(combined).not.toContain('at resolveOutputFormat');
  });

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

  it('forwards --output to executeContractEmit as outputOverride resolved against cwd', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(
      executeCommand(command, ['--output', './custom/out.json', '--json']),
    ).resolves.toBe(0);

    expect(mocks.executeContractEmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputOverride: expect.stringContaining('custom/out.json'),
      }),
    );
  });

  it('CLI --output wins over config output (CLI > config precedence)', async () => {
    const configOutputPath = join(tmpDir, 'config-contract.json');
    const cliOutputPath = join(tmpDir, 'cli-contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(configOutputPath));
    mocks.executeContractEmitMock.mockResolvedValue(
      emitResult({ files: { json: cliOutputPath, dts: cliOutputPath.replace('.json', '.d.ts') } }),
    );

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--output', cliOutputPath, '--json'])).resolves.toBe(0);

    expect(mocks.executeContractEmitMock).toHaveBeenCalledWith(
      expect.objectContaining({ outputOverride: cliOutputPath }),
    );
  });

  it('resolves relative --output against cwd', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(
      executeCommand(command, ['--output', 'relative/out.json', '--json']),
    ).resolves.toBe(0);

    const call = mocks.executeContractEmitMock.mock.calls[0]?.[0] as { outputOverride?: string };
    expect(call?.outputOverride).toMatch(/^\/.*relative\/out\.json$/);
  });

  it('passes absolute --output verbatim', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    const absoluteOut = join(tmpDir, 'abs/out.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--output', absoluteOut, '--json'])).resolves.toBe(0);

    expect(mocks.executeContractEmitMock).toHaveBeenCalledWith(
      expect.objectContaining({ outputOverride: absoluteOut }),
    );
  });

  it('emits soft warning when --output has non-.json extension', async () => {
    cleanupMocks();
    const interactiveMocks = setupCommandMocks({ isTTY: true });
    consoleOutput = interactiveMocks.consoleOutput;
    cleanupMocks = interactiveMocks.cleanup;

    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--output', join(tmpDir, 'contract.txt')])).resolves.toBe(
      0,
    );

    expect(consoleOutput.some((line) => line.toLowerCase().includes('.json'))).toBe(true);
  });

  it('emits soft warning when --output looks like a directory (trailing slash)', async () => {
    cleanupMocks();
    const interactiveMocks = setupCommandMocks({ isTTY: true });
    consoleOutput = interactiveMocks.consoleOutput;
    cleanupMocks = interactiveMocks.cleanup;

    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--output', join(tmpDir, 'out/')])).resolves.toBe(0);

    expect(consoleOutput.some((line) => line.toLowerCase().includes('directory'))).toBe(true);
  });

  it('emits soft warning when --output collides with a contract source input', async () => {
    cleanupMocks();
    const interactiveMocks = setupCommandMocks({ isTTY: true });
    consoleOutput = interactiveMocks.consoleOutput;
    cleanupMocks = interactiveMocks.cleanup;

    const sourceFile = join(tmpDir, 'contract.prisma');
    mocks.loadConfigMock.mockResolvedValue({
      ...configWithOutput(join(tmpDir, 'contract.json')),
      contract: {
        source: { load: vi.fn(), inputs: [sourceFile] },
        output: join(tmpDir, 'contract.json'),
      },
    });
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--output', sourceFile])).resolves.toBe(0);

    expect(consoleOutput.some((line) => line.toLowerCase().includes('collide'))).toBe(true);
  });

  it('does not forward outputOverride when --output is not passed', async () => {
    const outputPath = join(tmpDir, 'contract.json');
    mocks.loadConfigMock.mockResolvedValue(configWithOutput(outputPath));
    mocks.executeContractEmitMock.mockResolvedValue(emitResult());

    const command = createContractEmitCommand();
    await expect(executeCommand(command, ['--json'])).resolves.toBe(0);

    const call = mocks.executeContractEmitMock.mock.calls[0]?.[0] as { outputOverride?: string };
    expect(call?.outputOverride).toBeUndefined();
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
