import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasMigrationTs: vi.fn(),
  attestMigration: vi.fn(),
}));

vi.mock('@prisma-next/migration-tools/migration-ts', () => ({
  hasMigrationTs: mocks.hasMigrationTs,
}));

vi.mock('@prisma-next/migration-tools/attestation', () => ({
  attestMigration: mocks.attestMigration,
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
    mocks.attestMigration.mockReset();

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

  it("delegates to the target's emit capability", async () => {
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

  it('throws errorTargetMigrationNotSupported when emit is not implemented', async () => {
    mocks.hasMigrationTs.mockResolvedValue(true);

    await expect(
      emitMigration(
        DIR,
        makeCtx({ targetId: 'test-target' }) as unknown as Parameters<EmitMigration>[1],
      ),
    ).rejects.toMatchObject({
      why: expect.stringContaining('does not implement the `emit` migrations capability'),
    });
  });

  it('calls attestMigration exactly once after emit returns', async () => {
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
