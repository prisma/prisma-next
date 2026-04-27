import type { PlanMeta } from '@prisma-next/contract/types';
import { describe, expect, it, vi } from 'vitest';
import { createTelemetryMiddleware } from '../src/telemetry-middleware';

describe('telemetry middleware', () => {
  const plan = {
    meta: {
      target: 'postgres',
      storageHash: 'sha256:test',
      lane: 'sql',
      paramDescriptors: [],
    } satisfies PlanMeta,
  };

  it('has no familyId (family-agnostic)', () => {
    const middleware = createTelemetryMiddleware({ onEvent: vi.fn() });
    expect(middleware.familyId).toBeUndefined();
  });

  it('emits a "beforeExecute" event with plan metadata', async () => {
    const onEvent = vi.fn();
    const middleware = createTelemetryMiddleware({ onEvent });
    const ctx = {
      contract: {},
      mode: 'strict' as const,
      now: Date.now,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      identityKey: () => 'mock-key',
    };

    await middleware.beforeExecute!(plan, ctx);

    expect(onEvent).toHaveBeenCalledWith({
      phase: 'beforeExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
    });
  });

  it('emits an "afterExecute" event with plan metadata, row count, latency, and completion', async () => {
    const onEvent = vi.fn();
    const middleware = createTelemetryMiddleware({ onEvent });
    const ctx = {
      contract: {},
      mode: 'strict' as const,
      now: Date.now,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      identityKey: () => 'mock-key',
    };
    const result = {
      rowCount: 5,
      latencyMs: 42,
      completed: true,
      source: 'driver' as const,
    };

    await middleware.afterExecute!(plan, result, ctx);

    expect(onEvent).toHaveBeenCalledWith({
      phase: 'afterExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
      rowCount: 5,
      latencyMs: 42,
      completed: true,
      source: 'driver',
    });
  });

  it('round-trips source: "middleware" on intercepted afterExecute events', async () => {
    const onEvent = vi.fn();
    const middleware = createTelemetryMiddleware({ onEvent });
    const ctx = {
      contract: {},
      mode: 'strict' as const,
      now: Date.now,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      identityKey: () => 'mock-key',
    };
    const result = {
      rowCount: 3,
      latencyMs: 1,
      completed: true,
      source: 'middleware' as const,
    };

    await middleware.afterExecute!(plan, result, ctx);

    expect(onEvent).toHaveBeenCalledWith({
      phase: 'afterExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
      rowCount: 3,
      latencyMs: 1,
      completed: true,
      source: 'middleware',
    });
  });

  it('defaults to logging via ctx.log.info when no onEvent provided', async () => {
    const middleware = createTelemetryMiddleware();
    const info = vi.fn();
    const ctx = {
      contract: {},
      mode: 'strict' as const,
      now: Date.now,
      log: { info, warn: vi.fn(), error: vi.fn() },
      identityKey: () => 'mock-key',
    };

    await middleware.beforeExecute!(plan, ctx);

    expect(info).toHaveBeenCalledWith({
      phase: 'beforeExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
    });
  });

  it('swallows onEvent errors and logs a warning instead', async () => {
    const onEvent = vi.fn(() => {
      throw new Error('sink failure');
    });
    const middleware = createTelemetryMiddleware({ onEvent });
    const warn = vi.fn();
    const ctx = {
      contract: {},
      mode: 'strict' as const,
      now: Date.now,
      log: { info: vi.fn(), warn, error: vi.fn() },
      identityKey: () => 'mock-key',
    };

    await expect(middleware.beforeExecute!(plan, ctx)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatchObject({ message: 'telemetry sink error' });
  });
});
