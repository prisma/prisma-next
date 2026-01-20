import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import { describe, expect, it } from 'vitest';
import type {
  SqlRuntimeAdapterInstance,
  SqlRuntimeDriverInstance,
} from '../src/core/runtime-instance';
import sqlFamilyRuntime from '../src/exports/runtime';

describe('@prisma-next/family-sql/runtime entrypoint', () => {
  it('exports a descriptor with familyId sql', () => {
    expect(sqlFamilyRuntime.familyId).toBe('sql');
    expect(sqlFamilyRuntime.kind).toBe('family');
    expect(sqlFamilyRuntime.id).toBe('sql');
  });

  it('does not expose createRuntime', () => {
    const instance = sqlFamilyRuntime.create({
      target: {
        kind: 'target',
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      } as RuntimeTargetDescriptor<'sql', 'postgres'>,
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create: () => ({}) as SqlRuntimeAdapterInstance<'postgres'>,
      } as RuntimeAdapterDescriptor<'sql', 'postgres', SqlRuntimeAdapterInstance<'postgres'>>,
      driver: {
        kind: 'driver',
        id: 'postgres',
        version: '0.0.1',
        familyId: 'sql',
        targetId: 'postgres',
        create: () => ({}) as SqlRuntimeDriverInstance<'postgres'>,
      } as RuntimeDriverDescriptor<'sql', 'postgres', SqlRuntimeDriverInstance<'postgres'>>,
      extensionPacks: [],
    });

    expect(instance.familyId).toBe('sql');
    expect(instance).not.toHaveProperty('createRuntime');
  });
});
