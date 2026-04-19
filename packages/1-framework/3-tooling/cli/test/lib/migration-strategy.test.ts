import type { TargetMigrationsCapability } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { migrationStrategy } from '../../src/lib/migration-strategy';

function makeCapability(
  overrides: Partial<TargetMigrationsCapability>,
): TargetMigrationsCapability {
  return {
    createPlanner: () => {
      throw new Error('not used');
    },
    createRunner: () => {
      throw new Error('not used');
    },
    contractToSchema: () => {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('migrationStrategy', () => {
  it("returns 'descriptor' when resolveDescriptors is registered", () => {
    const capability = makeCapability({
      resolveDescriptors: () => [],
    });

    expect(migrationStrategy(capability, 'postgres')).toBe('descriptor');
  });

  it("returns 'class-based' when only emit is registered", () => {
    const capability = makeCapability({
      emit: async () => [],
    });

    expect(migrationStrategy(capability, 'mongo')).toBe('class-based');
  });

  it("prefers 'descriptor' when both hooks are registered", () => {
    const capability = makeCapability({
      resolveDescriptors: () => [],
      emit: async () => [],
    });

    expect(migrationStrategy(capability, 'hybrid')).toBe('descriptor');
  });

  it('throws errorTargetHasIncompleteMigrationCapabilities when neither hook is registered', () => {
    const capability = makeCapability({});

    expect(() => migrationStrategy(capability, 'broken')).toThrow(
      expect.objectContaining({
        code: '2011',
        meta: expect.objectContaining({ targetId: 'broken' }),
      }),
    );
  });
});
