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
    };
    const result = { rowCount: 5, latencyMs: 42, completed: true };

    await middleware.afterExecute!(plan, result, ctx);

    expect(onEvent).toHaveBeenCalledWith({
      phase: 'afterExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
      rowCount: 5,
      latencyMs: 42,
      completed: true,
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
    };

    await middleware.beforeExecute!(plan, ctx);

    expect(info).toHaveBeenCalledWith({
      phase: 'beforeExecute',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sha256:test',
    });
  });
});
