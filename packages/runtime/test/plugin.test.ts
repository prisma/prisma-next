import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Runtime, createRuntime } from '../src/runtime';
import { DatabaseConnection } from '../src/connection';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';
import { RuntimePlugin } from '../src/plugin';

describe('Plugin Infrastructure', () => {
  let mockDriver: DatabaseConnection;
  let mockSchema: Schema;
  let mockPlan: Plan;

  beforeEach(() => {
    mockDriver = {
      execute: vi.fn().mockResolvedValue([{ id: 1, name: 'test' }]),
    } as any;

    mockSchema = {
      target: 'postgres',
      contractHash: 'test-hash',
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false, pk: true },
            name: { type: 'text', nullable: false },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };

    mockPlan = {
      ast: {
        type: 'select',
        from: 'user',
        contractHash: 'test-hash',
        projectStar: false,
        select: {
          type: 'select',
          fields: {
            id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            name: { table: 'user', name: 'name', __contractHash: 'test-hash' } as any,
          },
        },
      },
      sql: 'SELECT "id" AS "id", "name" AS "name" FROM "user"',
      params: [],
      meta: {
        contractHash: 'test-hash',
        target: 'postgres',
        refs: {
          tables: ['user'],
          columns: ['user.id', 'user.name'],
        },
      },
    };
  });

  it('executes plugins in registration order', async () => {
    const executionOrder: string[] = [];

    const plugin1: RuntimePlugin = {
      beforeExecute: vi.fn().mockImplementation(() => executionOrder.push('plugin1-before')),
      afterExecute: vi.fn().mockImplementation(() => executionOrder.push('plugin1-after')),
    };

    const plugin2: RuntimePlugin = {
      beforeExecute: vi.fn().mockImplementation(() => executionOrder.push('plugin2-before')),
      afterExecute: vi.fn().mockImplementation(() => executionOrder.push('plugin2-after')),
    };

    const runtime = createRuntime({ ir: mockSchema, driver: mockDriver });
    runtime.use(plugin1).use(plugin2);

    await runtime.execute(mockPlan);

    expect(executionOrder).toEqual([
      'plugin1-before',
      'plugin2-before',
      'plugin1-after',
      'plugin2-after',
    ]);
  });

  it('handles beforeExecute errors', async () => {
    const errorPlugin: RuntimePlugin = {
      beforeExecute: vi.fn().mockRejectedValue(new Error('Plugin error')),
    };

    const runtime = createRuntime({ ir: mockSchema, driver: mockDriver });
    runtime.use(errorPlugin);

    await expect(runtime.execute(mockPlan)).rejects.toThrow('Plugin error');
    expect(mockDriver.execute).not.toHaveBeenCalled();
  });

  it('calls onError hooks when execution fails', async () => {
    const error = new Error('Database error');
    mockDriver.execute = vi.fn().mockRejectedValue(error);

    const errorPlugin: RuntimePlugin = {
      onError: vi.fn(),
    };

    const runtime = createRuntime({ ir: mockSchema, driver: mockDriver });
    runtime.use(errorPlugin);

    await expect(runtime.execute(mockPlan)).rejects.toThrow('Database error');
    expect(errorPlugin.onError).toHaveBeenCalledWith({
      plan: mockPlan,
      error,
      ir: mockSchema,
    });
  });

  it('provides correct metrics to afterExecute hooks', async () => {
    const metricsPlugin: RuntimePlugin = {
      afterExecute: vi.fn(),
    };

    const runtime = createRuntime({ ir: mockSchema, driver: mockDriver });
    runtime.use(metricsPlugin);

    await runtime.execute(mockPlan);

    expect(metricsPlugin.afterExecute).toHaveBeenCalledWith({
      plan: mockPlan,
      result: { rows: [{ id: 1, name: 'test' }], rowCount: 1 },
      metrics: expect.objectContaining({
        durationMs: expect.any(Number),
        rowCount: 1,
      }),
      ir: mockSchema,
    });
  });

  it('supports factory-time plugin registration', async () => {
    const plugin: RuntimePlugin = {
      beforeExecute: vi.fn(),
      afterExecute: vi.fn(),
    };

    const runtime = createRuntime({
      ir: mockSchema,
      driver: mockDriver,
      plugins: [plugin],
    });

    await runtime.execute(mockPlan);

    expect(plugin.beforeExecute).toHaveBeenCalled();
    expect(plugin.afterExecute).toHaveBeenCalled();
  });

  it('handles multiple plugins with mixed hook implementations', async () => {
    const plugin1: RuntimePlugin = {
      beforeExecute: vi.fn(),
      afterExecute: vi.fn(),
    };

    const plugin2: RuntimePlugin = {
      beforeExecute: vi.fn(),
      afterExecute: undefined,
    };

    const plugin3: RuntimePlugin = {
      beforeExecute: undefined,
      afterExecute: vi.fn(),
    };

    const runtime = createRuntime({ ir: mockSchema, driver: mockDriver });
    runtime.use(plugin1).use(plugin2).use(plugin3);

    await runtime.execute(mockPlan);

    expect(plugin1.beforeExecute).toHaveBeenCalled();
    expect(plugin2.beforeExecute).toHaveBeenCalled();
    expect(plugin3.beforeExecute).toBeUndefined();

    expect(plugin1.afterExecute).toHaveBeenCalled();
    expect(plugin2.afterExecute).toBeUndefined();
    expect(plugin3.afterExecute).toHaveBeenCalled();
  });
});
