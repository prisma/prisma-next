import {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorUnfilledPlaceholder,
} from '@prisma-next/errors/migration';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationEmitResult } from '../../src/commands/migration-emit';
import { errorTargetMigrationNotSupported } from '../../src/utils/cli-errors';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

type CreateMigrationEmitCommand =
  typeof import('../../src/commands/migration-emit')['createMigrationEmitCommand'];

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  emitMigrationMock: vi.fn(),
  assertFrameworkComponentsCompatibleMock: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock('../../src/lib/migration-emit', () => ({
  emitMigration: mocks.emitMigrationMock,
}));

vi.mock('../../src/utils/framework-components', () => ({
  assertFrameworkComponentsCompatible: mocks.assertFrameworkComponentsCompatibleMock,
}));

function mockMigrationCapableConfig(): void {
  mocks.loadConfigMock.mockResolvedValue({
    family: { familyId: 'mongo' },
    target: {
      id: 'mongo',
      familyId: 'mongo',
      targetId: 'mongo',
      kind: 'target',
      migrations: { emit: vi.fn() },
    },
    adapter: {
      kind: 'adapter',
      familyId: 'mongo',
      targetId: 'mongo',
    },
  });
}

describe('migration emit command', () => {
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void = () => {};
  let createMigrationEmitCommand: CreateMigrationEmitCommand;

  beforeEach(async () => {
    vi.resetModules();
    ({ createMigrationEmitCommand } = await import('../../src/commands/migration-emit'));

    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    consoleErrors = commandMocks.consoleErrors;
    cleanupMocks = commandMocks.cleanup;

    mocks.loadConfigMock.mockReset();
    mocks.emitMigrationMock.mockReset();
    mocks.assertFrameworkComponentsCompatibleMock.mockReset();
    mocks.assertFrameworkComponentsCompatibleMock.mockReturnValue([]);
  }, timeouts.typeScriptCompilation);

  afterEach(() => {
    cleanupMocks();
    vi.clearAllMocks();
  });

  describe('success', () => {
    it('emits JSON with { ok, dir, migrationId, summary } shape when --json is set', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockResolvedValue({
        operations: [],
        migrationId: 'sha256:abc123',
      });

      const command = createMigrationEmitCommand();
      const exitCode = await executeCommand(command, [
        '--dir',
        'migrations/20260101_test',
        '--json',
      ]);

      expect(exitCode).toBe(0);
      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!) as MigrationEmitResult;
      expect(parsed).toEqual({
        ok: true,
        dir: 'migrations/20260101_test',
        migrationId: 'sha256:abc123',
        summary: 'Emitted ops.json and attested migrationId: sha256:abc123',
      });
    });

    it('dispatches to emitMigration with the resolved framework components', async () => {
      mockMigrationCapableConfig();
      const components = [{ kind: 'target', familyId: 'mongo', targetId: 'mongo' }];
      mocks.assertFrameworkComponentsCompatibleMock.mockReturnValue(components);
      mocks.emitMigrationMock.mockResolvedValue({
        operations: [],
        migrationId: 'sha256:abc123',
      });

      const command = createMigrationEmitCommand();
      await executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']);

      expect(mocks.emitMigrationMock).toHaveBeenCalledWith(
        'migrations/20260101_test',
        expect.objectContaining({
          targetId: 'mongo',
          frameworkComponents: components,
        }),
      );
    });
  });

  describe('error propagation', () => {
    it('propagates PN-MIG-2001 when emitMigration throws an unfilled-placeholder error', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockRejectedValue(
        errorUnfilledPlaceholder('backfill-product-status:run'),
      );

      const command = createMigrationEmitCommand();
      await expect(
        executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']),
      ).rejects.toBeDefined();

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as {
        ok: false;
        code: string;
        domain: string;
        meta: { slot: string };
      };
      expect(envelope).toMatchObject({
        ok: false,
        code: 'PN-MIG-2001',
        domain: 'MIG',
        meta: { slot: 'backfill-product-status:run' },
      });
    });

    it('propagates other class-flow emit errors (e.g. invalid default export) structurally', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockRejectedValue(
        errorMigrationInvalidDefaultExport('migrations/20260101_test', 'undefined'),
      );

      const command = createMigrationEmitCommand();
      await expect(
        executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']),
      ).rejects.toBeDefined();

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as { code: string; domain: string };
      expect(envelope.domain).toBe('MIG');
      expect(envelope.code).toBe('PN-MIG-2003');
    });

    it('propagates PN-MIG-2002 when migration.ts is missing', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockRejectedValue(
        errorMigrationFileMissing('migrations/20260101_test'),
      );

      const command = createMigrationEmitCommand();
      await expect(
        executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']),
      ).rejects.toBeDefined();

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as {
        ok: false;
        code: string;
        domain: string;
        meta: { dir: string };
      };
      expect(envelope).toMatchObject({
        ok: false,
        code: 'PN-MIG-2002',
        domain: 'MIG',
        meta: { dir: 'migrations/20260101_test' },
      });
    });

    it('emits a CLI-domain envelope when the configured target does not support migrations', async () => {
      mocks.loadConfigMock.mockResolvedValue({
        family: { familyId: 'mongo' },
        target: { id: 'mongo', familyId: 'mongo', targetId: 'mongo', kind: 'target' },
        adapter: { kind: 'adapter', familyId: 'mongo', targetId: 'mongo' },
      });

      const command = createMigrationEmitCommand();
      await expect(
        executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']),
      ).rejects.toBeDefined();

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as { code: string; domain: string };
      expect(envelope.domain).toBe('CLI');
      expect(envelope.code).toBe(errorTargetMigrationNotSupported().toEnvelope().code);
      expect(mocks.emitMigrationMock).not.toHaveBeenCalled();
    });

    it('wraps non-structured thrown errors through the errorUnexpected envelope', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockRejectedValue(new Error('boom'));

      const command = createMigrationEmitCommand();
      await expect(
        executeCommand(command, ['--dir', 'migrations/20260101_test', '--json']),
      ).rejects.toBeDefined();

      const jsonLine = consoleOutput.find((line) => line.trimStart().startsWith('{'));
      expect(jsonLine).toBeDefined();
      const envelope = JSON.parse(jsonLine!) as { code: string; domain: string };
      expect(envelope.domain).toBe('CLI');
      expect(envelope.code).toBe('PN-CLI-4999');
    });
  });

  describe('human-readable mode', () => {
    it('prints the styled header and success summary when --json is absent', async () => {
      mockMigrationCapableConfig();
      mocks.emitMigrationMock.mockResolvedValue({
        operations: [],
        migrationId: 'sha256:abc123',
      });

      const command = createMigrationEmitCommand();
      const exitCode = await executeCommand(command, ['--dir', 'migrations/20260101_test']);

      expect(exitCode).toBe(0);
      const combined = consoleErrors.join('\n');
      expect(combined).toContain('migration emit');
      expect(combined).toContain('migrations/20260101_test');
      expect(consoleOutput.some((line) => line.includes('sha256:abc123'))).toBe(true);
    });
  });
});
