import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { executeDbInit } from '../../src/control-api/operations/db-init';
import type { ControlProgressEvent } from '../../src/control-api/types';

describe('executeDbInit progress emission', () => {
  it('emits expected span events in plan mode', async () => {
    const events: ControlProgressEvent[] = [];

    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      validateContractIR: () => ({}) as ContractIR,
    } as unknown as ControlFamilyInstance<string>;

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          plan: {
            targetId: 'postgres',
            destination: { coreHash: 'test-hash' },
            operations: [],
          },
        }),
      }),
      createRunner: () => ({}),
    } as unknown as TargetMigrationsCapability<string, string, ControlFamilyInstance<string>>;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    await executeDbInit({
      driver: mockDriver,
      familyInstance: mockFamilyInstance,
      contractIR: {} as ContractIR,
      mode: 'plan',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
      onProgress: (event) => {
        events.push(event);
      },
    });

    // Should emit introspect, plan, and checkMarker spans
    expect(events.length).toBeGreaterThan(0);

    const spanStarts = events.filter((e) => e.kind === 'spanStart');
    const spanEnds = events.filter((e) => e.kind === 'spanEnd');

    // Should have matching start/end pairs
    expect(spanStarts.length).toBeGreaterThan(0);
    expect(spanEnds.length).toBe(spanStarts.length);

    // Should include introspect and plan spans
    const introspectSpan = spanStarts.find((e) => e.spanId === 'introspect');
    const planSpan = spanStarts.find((e) => e.spanId === 'plan');
    const checkMarkerSpan = spanStarts.find((e) => e.spanId === 'checkMarker');

    expect(introspectSpan).toBeDefined();
    expect(planSpan).toBeDefined();
    expect(checkMarkerSpan).toBeDefined();

    // Should not emit apply span in plan mode
    const applySpan = spanStarts.find((e) => e.spanId === 'apply');
    expect(applySpan).toBeUndefined();
  });

  it('emits no events when onProgress is omitted', async () => {
    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      validateContractIR: () => ({}) as ContractIR,
    } as unknown as ControlFamilyInstance<string>;

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          plan: {
            targetId: 'postgres',
            destination: { coreHash: 'test-hash' },
            operations: [],
          },
        }),
      }),
      createRunner: () => ({}),
    } as unknown as TargetMigrationsCapability<string, string, ControlFamilyInstance<string>>;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    // Should not throw when onProgress is omitted
    const result = await executeDbInit({
      driver: mockDriver,
      familyInstance: mockFamilyInstance,
      contractIR: {} as ContractIR,
      mode: 'plan',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
    });

    expect(result.ok).toBe(true);
  });
});
