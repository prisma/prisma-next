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
      readMarker: async () => null,
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

  it('emits nested operation spans in apply mode', async () => {
    const events: ControlProgressEvent[] = [];

    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      validateContractIR: () => ({}) as ContractIR,
      readMarker: async () => null,
    } as unknown as ControlFamilyInstance<string>;

    const mockOperations = [
      { id: 'op-1', label: 'Create table users', operationClass: 'additive' },
      { id: 'op-2', label: 'Create index idx_users_email', operationClass: 'additive' },
    ];

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          plan: {
            targetId: 'postgres',
            destination: { coreHash: 'test-hash' },
            operations: mockOperations,
          },
        }),
      }),
      createRunner: () => ({
        execute: async (opts: {
          callbacks?: {
            onOperationStart?: (op: { id: string }) => void;
            onOperationComplete?: (op: { id: string }) => void;
          };
        }) => {
          // Simulate running operations with callbacks
          for (const op of mockOperations) {
            opts.callbacks?.onOperationStart?.(op);
            opts.callbacks?.onOperationComplete?.(op);
          }
          return {
            ok: true as const,
            value: { operationsPlanned: 2, operationsExecuted: 2 },
          };
        },
      }),
    } as unknown as TargetMigrationsCapability<string, string, ControlFamilyInstance<string>>;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    await executeDbInit({
      driver: mockDriver,
      familyInstance: mockFamilyInstance,
      contractIR: {} as ContractIR,
      mode: 'apply',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
      onProgress: (event) => {
        events.push(event);
      },
    });

    // Should have apply span
    const applySpanStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(applySpanStart).toBeDefined();

    // Should have nested operation spans with parentSpanId = 'apply'
    const nestedSpanStarts = events.filter(
      (e) => e.kind === 'spanStart' && 'parentSpanId' in e && e.parentSpanId === 'apply',
    );
    expect(nestedSpanStarts.length).toBe(2);

    // Operation spans should have correct IDs
    expect(nestedSpanStarts[0]).toMatchObject({
      spanId: 'operation:op-1',
      label: 'Create table users',
    });
    expect(nestedSpanStarts[1]).toMatchObject({
      spanId: 'operation:op-2',
      label: 'Create index idx_users_email',
    });
  });

  it('emits no events when onProgress is omitted', async () => {
    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      validateContractIR: () => ({}) as ContractIR,
      readMarker: async () => null,
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
