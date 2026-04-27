import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorRuntime } from '../../src/utils/cli-errors';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateContractEmitCommand =
  typeof import('../../src/commands/contract-emit')['createContractEmitCommand'];

const mocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const emitMock = vi.fn();
  const closeMock = vi.fn();
  const createControlClientMock = vi.fn(() => ({
    emit: emitMock,
    close: closeMock,
  }));
  const issueContractArtifactGenerationMock = vi.fn(() => 7);
  const publishContractArtifactPairSerializedMock = vi.fn();

  return {
    loadConfigMock,
    emitMock,
    closeMock,
    createControlClientMock,
    issueContractArtifactGenerationMock,
    publishContractArtifactPairSerializedMock,
  };
});

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClientMock,
}));

vi.mock('../../src/utils/publish-contract-artifact-pair-serialized', () => ({
  issueContractArtifactGeneration: mocks.issueContractArtifactGenerationMock,
  publishContractArtifactPairSerialized: mocks.publishContractArtifactPairSerializedMock,
}));

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
    mocks.emitMock.mockReset();
    mocks.closeMock.mockReset();
    mocks.createControlClientMock.mockClear();
    mocks.issueContractArtifactGenerationMock.mockClear();
    mocks.publishContractArtifactPairSerializedMock.mockReset();
    mocks.closeMock.mockResolvedValue(undefined);
  }, timeouts.typeScriptCompilation);

  afterEach(async () => {
    cleanupMocks();
    if (tmpDir.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
    vi.clearAllMocks();
  });

  it('returns an error envelope when publication is superseded', async () => {
    const outputPath = join(tmpDir, 'contract.json');

    mocks.loadConfigMock.mockResolvedValue({
      family: { familyId: 'sql' },
      target: { targetId: 'postgres' },
      adapter: {},
      extensionPacks: [],
      contract: {
        source: { load: vi.fn() },
        output: outputPath,
      },
    });
    mocks.emitMock.mockResolvedValue({
      ok: true,
      value: {
        storageHash: 'storage-hash',
        profileHash: 'profile-hash',
        contractJson: '{"generation":"next"}',
        contractDts: "export type Generation = 'next';\n",
      },
    });
    mocks.publishContractArtifactPairSerializedMock.mockResolvedValue('superseded');

    const command = createContractEmitCommand();

    await expect(executeCommand(command, ['--json'])).rejects.toBeDefined();

    const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
    expect(jsonLine).toBeDefined();
    const envelope = JSON.parse(jsonLine!) as { code: string; why: string };
    expect(envelope.code).toBe(
      errorRuntime('Contract artifacts were superseded before publication', {
        why: 'A newer emit claimed the same output path before this command could publish its artifacts.',
        fix: 'Avoid overlapping emits for the same output path, or cancel the older emit before starting a newer one.',
      }).toEnvelope().code,
    );
    expect(envelope.why).toContain('newer emit claimed the same output path');
  });
});
