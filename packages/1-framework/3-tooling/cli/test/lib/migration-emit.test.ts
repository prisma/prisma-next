import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasMigrationTs: vi.fn(),
  evaluateMigrationTs: vi.fn(),
  attestMigration: vi.fn(),
  readMigrationPackage: vi.fn(),
  writeMigrationOps: vi.fn(),
}));

vi.mock('@prisma-next/migration-tools/migration-ts', () => ({
  hasMigrationTs: mocks.hasMigrationTs,
  evaluateMigrationTs: mocks.evaluateMigrationTs,
}));

vi.mock('@prisma-next/migration-tools/attestation', () => ({
  attestMigration: mocks.attestMigration,
}));

vi.mock('@prisma-next/migration-tools/io', () => ({
  readMigrationPackage: mocks.readMigrationPackage,
  writeMigrationOps: mocks.writeMigrationOps,
}));

type EmitMigration = typeof import('../../src/lib/migration-emit')['emitMigration'];

const DIR = 'migrations/20260101_test';

const sampleOps: readonly MigrationPlanOperation[] = [
  { id: 'table.user.create', label: 'Create table "user"', operationClass: 'additive' },
];

function makeCtx(overrides?: Record<string, unknown>): {
  targetId: string;
  migrations: Record<string, unknown>;
  frameworkComponents: readonly unknown[];
} {
  return {
    targetId: 'mongo',
    migrations: {},
    frameworkComponents: [],
    ...overrides,
  };
}

describe('emitMigration dispatcher', () => {
  let emitMigration: EmitMigration;

  beforeEach(async () => {
    vi.resetModules();
    mocks.hasMigrationTs.mockReset();
    mocks.evaluateMigrationTs.mockReset();
    mocks.attestMigration.mockReset();
    mocks.readMigrationPackage.mockReset();
    mocks.writeMigrationOps.mockReset();

    ({ emitMigration } = await import('../../src/lib/migration-emit'));
  });

  it('throws errorMigrationFileMissing when hasMigrationTs returns false', async () => {
    mocks.hasMigrationTs.mockResolvedValue(false);

    let thrown: unknown;
    try {
      await emitMigration(DIR, makeCtx() as unknown as Parameters<EmitMigration>[1]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: '2002',
      message: 'migration.ts not found',
    });
  });

  it('routes to descriptor flow when resolveDescriptors is present', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);
    const resolveDescriptors = vi.fn().mockReturnValue(sampleOps);
    mocks.evaluateMigrationTs.mockResolvedValue([{ kind: 'createTable' }]);
    mocks.readMigrationPackage.mockResolvedValue({
      manifest: { fromContract: null, toContract: {} },
      ops: [],
    });
    mocks.writeMigrationOps.mockResolvedValue(undefined);
    mocks.attestMigration.mockResolvedValue('sha256:desc-id');

    const result = await emitMigration(
      DIR,
      makeCtx({ migrations: { resolveDescriptors } }) as unknown as Parameters<EmitMigration>[1],
    );

    expect(resolveDescriptors).toHaveBeenCalledWith(
      [{ kind: 'createTable' }],
      expect.objectContaining({ fromContract: null, toContract: {} }),
    );
    expect(mocks.writeMigrationOps).toHaveBeenCalledWith(DIR, sampleOps);
    expect(mocks.attestMigration).toHaveBeenCalledWith(DIR);
    expect(result).toEqual({ operations: sampleOps, migrationId: 'sha256:desc-id' });
  });

  it('routes to class flow when emit is present and resolveDescriptors is absent', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);
    const emit = vi.fn().mockResolvedValue(sampleOps);
    mocks.attestMigration.mockResolvedValue('sha256:class-id');

    const components = [{ kind: 'target', familyId: 'mongo', targetId: 'mongo' }];
    const result = await emitMigration(
      DIR,
      makeCtx({
        migrations: { emit },
        frameworkComponents: components,
      }) as unknown as Parameters<EmitMigration>[1],
    );

    expect(emit).toHaveBeenCalledWith({ dir: DIR, frameworkComponents: components });
    expect(mocks.attestMigration).toHaveBeenCalledWith(DIR);
    expect(result).toEqual({ operations: sampleOps, migrationId: 'sha256:class-id' });
  });

  it('prefers descriptor flow when both resolveDescriptors and emit are present', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);
    const resolveDescriptors = vi.fn().mockReturnValue(sampleOps);
    const emit = vi.fn();
    mocks.evaluateMigrationTs.mockResolvedValue([]);
    mocks.readMigrationPackage.mockResolvedValue({
      manifest: { fromContract: null, toContract: {} },
      ops: [],
    });
    mocks.writeMigrationOps.mockResolvedValue(undefined);
    mocks.attestMigration.mockResolvedValue('sha256:desc-wins');

    await emitMigration(
      DIR,
      makeCtx({
        migrations: { resolveDescriptors, emit },
      }) as unknown as Parameters<EmitMigration>[1],
    );

    expect(resolveDescriptors).toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('throws errorTargetHasIncompleteMigrationCapabilities when neither capability is present', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);

    let thrown: unknown;
    try {
      await emitMigration(
        DIR,
        makeCtx({ targetId: 'test-target' }) as unknown as Parameters<EmitMigration>[1],
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: '2011',
      message: 'Target migrations capability is incomplete',
    });
    expect((thrown as Error & { why: string }).why).toContain(
      'implements neither `resolveDescriptors`',
    );
  });

  it('calls attestMigration exactly once after emit returns in class flow', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);
    const callOrder: string[] = [];
    const emit = vi.fn().mockImplementation(async () => {
      callOrder.push('emit');
      return sampleOps;
    });
    mocks.attestMigration.mockImplementation(async () => {
      callOrder.push('attestMigration');
      return 'sha256:ordered';
    });

    await emitMigration(
      DIR,
      makeCtx({ migrations: { emit } }) as unknown as Parameters<EmitMigration>[1],
    );

    expect(callOrder).toEqual(['emit', 'attestMigration']);
    expect(mocks.attestMigration).toHaveBeenCalledTimes(1);
  });
});
