import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { notOk, ok } from '@prisma-next/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { ControlProgressEvent } from '../../src/control-api/types';

function createMockDriver() {
  return {
    close: vi.fn(),
  } as unknown as ControlDriverInstance<'sql', 'postgres'>;
}

function createMockFamilyInstance(overrides?: {
  readMarker?: () => Promise<{ storageHash: string; profileHash?: string } | null>;
  introspect?: () => Promise<unknown>;
}) {
  return {
    familyId: 'sql',
    readMarker: overrides?.readMarker ?? (async () => null),
    introspect: overrides?.introspect ?? (async () => ({ tables: {}, extensions: [] })),
    validateContractIR: (ir: unknown) => ir as ContractIR,
  } as unknown as ControlFamilyInstance<'sql'>;
}

function createMockMigrations(overrides?: {
  planResult?: MigrationPlannerResult;
  runnerResult?: MigrationRunnerResult;
}) {
  const planResult: MigrationPlannerResult = overrides?.planResult ?? {
    kind: 'success',
    plan: {
      targetId: 'postgres',
      destination: { storageHash: 'sha256:new-hash', profileHash: 'sha256:new-profile' },
      operations: [
        {
          id: 'column.user.nickname',
          label: 'Add column nickname on user',
          operationClass: 'additive',
        },
      ],
    },
  };

  const runnerResult: MigrationRunnerResult =
    overrides?.runnerResult ?? ok({ operationsPlanned: 1, operationsExecuted: 1 });

  return {
    createPlanner: () => ({
      plan: vi.fn().mockReturnValue(planResult),
    }),
    createRunner: () => ({
      execute: vi.fn().mockResolvedValue(runnerResult),
    }),
  } as unknown as TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql'>>;
}

const dummyContractIR = { schemaVersion: '1', target: 'postgres' } as unknown as ContractIR;

describe('executeDbUpdate', () => {
  it('returns MARKER_REQUIRED when no marker exists', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({ readMarker: async () => null }),
      contractIR: dummyContractIR,
      mode: 'apply',
      migrations: createMockMigrations(),
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MARKER_REQUIRED');
      expect(result.failure.summary).toContain('signed');
    }
  });

  it('returns PLANNING_FAILED when planner reports conflicts', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({ storageHash: 'sha256:origin' }),
      }),
      contractIR: dummyContractIR,
      mode: 'plan',
      migrations: createMockMigrations({
        planResult: {
          kind: 'failure',
          conflicts: [
            {
              kind: 'typeMismatch',
              summary: 'Type mismatch',
            },
          ],
        },
      }),
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('PLANNING_FAILED');
      expect(result.failure.conflicts).toHaveLength(1);
      expect(result.failure.conflicts?.[0]).toMatchObject({ kind: 'typeMismatch' });
    }
  });

  it('returns plan result without executing runner in plan mode', async () => {
    const runnerExecute = vi.fn();
    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'sha256:dest', profileHash: 'sha256:dest-profile' },
            operations: [
              {
                id: 'column.user.nickname',
                label: 'Add column nickname on user',
                operationClass: 'additive',
              },
            ],
          },
        }),
      }),
      createRunner: () => ({
        execute: runnerExecute,
      }),
    } as unknown as TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql'>>;

    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({
          storageHash: 'sha256:origin',
          profileHash: 'sha256:origin-profile',
        }),
      }),
      contractIR: dummyContractIR,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('plan');
      expect(result.value.plan.operations).toHaveLength(1);
      expect(result.value.plan.sql).toEqual([]);
      expect(result.value.origin.storageHash).toBe('sha256:origin');
      expect(result.value.destination.storageHash).toBe('sha256:dest');
      expect(result.value.execution).toBeUndefined();
      expect(result.value.marker).toBeUndefined();
    }
    expect(runnerExecute).not.toHaveBeenCalled();
  });

  it('returns RUNNER_FAILED when runner rejects apply', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({ storageHash: 'sha256:origin' }),
      }),
      contractIR: dummyContractIR,
      mode: 'apply',
      migrations: createMockMigrations({
        runnerResult: notOk({
          code: 'ORIGIN_MISMATCH',
          summary: 'Origin mismatch',
          why: 'Marker drifted',
          meta: { drift: true },
        }),
      }),
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('RUNNER_FAILED');
      expect(result.failure.summary).toBe('Origin mismatch');
      expect(result.failure.why).toBe('Marker drifted');
      expect(result.failure.meta).toMatchObject({ drift: true });
    }
  });

  it('returns success with execution stats and marker in apply mode', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({
          storageHash: 'sha256:origin',
          profileHash: 'sha256:origin-profile',
        }),
      }),
      contractIR: dummyContractIR,
      mode: 'apply',
      migrations: createMockMigrations({
        runnerResult: ok({ operationsPlanned: 2, operationsExecuted: 2 }),
      }),
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('apply');
      expect(result.value.execution).toMatchObject({
        operationsPlanned: 2,
        operationsExecuted: 2,
      });
      expect(result.value.marker).toBeDefined();
      expect(result.value.marker?.storageHash).toBe('sha256:new-hash');
      expect(result.value.origin.storageHash).toBe('sha256:origin');
      expect(result.value.summary).toContain('Applied');
    }
  });

  it('returns success with 0 operations when database already matches contract', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({
          storageHash: 'sha256:current',
          profileHash: 'sha256:current-profile',
        }),
      }),
      contractIR: dummyContractIR,
      mode: 'apply',
      migrations: createMockMigrations({
        planResult: {
          kind: 'success',
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'sha256:current', profileHash: 'sha256:current-profile' },
            operations: [],
          },
        },
        runnerResult: ok({ operationsPlanned: 0, operationsExecuted: 0 }),
      }),
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('apply');
      expect(result.value.plan.operations).toHaveLength(0);
      expect(result.value.execution).toMatchObject({
        operationsPlanned: 0,
        operationsExecuted: 0,
      });
      expect(result.value.origin.storageHash).toBe('sha256:current');
      expect(result.value.destination.storageHash).toBe('sha256:current');
      expect(result.value.summary).toContain('Applied 0');
    }
  });

  it('returns plan with 0 operations when database already matches contract in plan mode', async () => {
    const runnerExecute = vi.fn();
    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'sha256:same', profileHash: 'sha256:same-profile' },
            operations: [],
          },
        }),
      }),
      createRunner: () => ({
        execute: runnerExecute,
      }),
    } as unknown as TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql'>>;

    const result = await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({
          storageHash: 'sha256:same',
          profileHash: 'sha256:same-profile',
        }),
      }),
      contractIR: dummyContractIR,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('plan');
      expect(result.value.plan.operations).toHaveLength(0);
      expect(result.value.summary).toContain('Planned 0');
    }
    expect(runnerExecute).not.toHaveBeenCalled();
  });

  it('allows additive, widening, and destructive operation classes', async () => {
    const planFn = vi.fn().mockReturnValue({
      kind: 'success',
      plan: {
        targetId: 'postgres',
        destination: { storageHash: 'sha256:dest' },
        operations: [],
      },
    });

    const migrations = {
      createPlanner: () => ({ plan: planFn }),
      createRunner: () => ({ execute: vi.fn() }),
    } as unknown as TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql'>>;

    await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({ storageHash: 'sha256:origin' }),
      }),
      contractIR: dummyContractIR,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
    });

    expect(planFn).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      }),
    );
  });

  it('attaches marker hashes as plan origin before runner execution', async () => {
    const runnerExecute = vi
      .fn()
      .mockResolvedValue(ok({ operationsPlanned: 1, operationsExecuted: 1 }));

    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'sha256:dest', profileHash: 'sha256:dest-profile' },
            operations: [
              {
                id: 'op1',
                label: 'Test op',
                operationClass: 'additive',
              },
            ],
          },
        }),
      }),
      createRunner: () => ({ execute: runnerExecute }),
    } as unknown as TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql'>>;

    await executeDbUpdate({
      driver: createMockDriver(),
      familyInstance: createMockFamilyInstance({
        readMarker: async () => ({
          storageHash: 'sha256:marker-origin',
          profileHash: 'sha256:marker-profile',
        }),
      }),
      contractIR: dummyContractIR,
      mode: 'apply',
      migrations,
      frameworkComponents: [],
    });

    expect(runnerExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          origin: {
            storageHash: 'sha256:marker-origin',
            profileHash: 'sha256:marker-profile',
          },
        }),
      }),
    );
  });

  describe('destructive changes gate', () => {
    function createDestructiveMigrations() {
      return createMockMigrations({
        planResult: {
          kind: 'success',
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'sha256:dest' },
            operations: [
              {
                id: 'dropColumn.user.nickname',
                label: 'Drop column nickname from user',
                operationClass: 'destructive',
              },
              {
                id: 'column.user.bio',
                label: 'Add column bio to user',
                operationClass: 'additive',
              },
            ],
          },
        },
      });
    }

    it('returns DESTRUCTIVE_CHANGES in apply mode without acceptDataLoss', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'apply',
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('DESTRUCTIVE_CHANGES');
        expect(result.failure.summary).toContain('destructive');
        expect(result.failure.meta).toMatchObject({
          destructiveOperations: [
            { id: 'dropColumn.user.nickname', label: 'Drop column nickname from user' },
          ],
        });
      }
    });

    it('proceeds to runner in apply mode with acceptDataLoss: true', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'apply',
        acceptDataLoss: true,
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('apply');
        expect(result.value.execution).toBeDefined();
      }
    });

    it('returns success in plan mode regardless of destructive operations', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'plan',
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('plan');
        expect(result.value.plan.operations).toHaveLength(2);
      }
    });
  });

  describe('progress events', () => {
    it('emits readMarker, introspect, plan spans in plan mode', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'plan',
        migrations: createMockMigrations(),
        frameworkComponents: [],
        onProgress: (event) => events.push(event),
      });

      const spanIds = events.map((e) => e.spanId);
      expect(spanIds).toContain('readMarker');
      expect(spanIds).toContain('introspect');
      expect(spanIds).toContain('plan');
      expect(spanIds).not.toContain('apply');

      for (const event of events) {
        expect(event.action).toBe('dbUpdate');
      }
    });

    it('emits apply and operation-level spans in apply mode', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'apply',
        migrations: createMockMigrations(),
        frameworkComponents: [],
        onProgress: (event) => events.push(event),
      });

      const spanIds = events.map((e) => e.spanId);
      expect(spanIds).toContain('apply');
      expect(spanIds).toContain('readMarker');
      expect(spanIds).toContain('introspect');
      expect(spanIds).toContain('plan');

      const applyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
      expect(applyEnd).toMatchObject({ outcome: 'ok' });
    });

    it('emits error outcome on readMarker span when marker is missing', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({ readMarker: async () => null }),
        contractIR: dummyContractIR,
        mode: 'apply',
        migrations: createMockMigrations(),
        frameworkComponents: [],
        onProgress: (event) => events.push(event),
      });

      const readMarkerEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'readMarker');
      expect(readMarkerEnd).toMatchObject({ outcome: 'error' });
    });

    it('emits error outcome on plan span when planning fails', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'plan',
        migrations: createMockMigrations({
          planResult: { kind: 'failure', conflicts: [] },
        }),
        frameworkComponents: [],
        onProgress: (event) => events.push(event),
      });

      const planEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'plan');
      expect(planEnd).toMatchObject({ outcome: 'error' });
    });

    it('emits error outcome on apply span when runner fails', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'apply',
        migrations: createMockMigrations({
          runnerResult: notOk({ code: 'RUNNER_ERROR', summary: 'Failed', why: 'Error' }),
        }),
        frameworkComponents: [],
        onProgress: (event) => events.push(event),
      });

      const applyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
      expect(applyEnd).toMatchObject({ outcome: 'error' });
    });

    it('does not throw when onProgress is omitted', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        familyInstance: createMockFamilyInstance({
          readMarker: async () => ({ storageHash: 'sha256:origin' }),
        }),
        contractIR: dummyContractIR,
        mode: 'plan',
        migrations: createMockMigrations(),
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
    });
  });
});
