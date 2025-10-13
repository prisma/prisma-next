import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lint, GuardrailError } from '../src/plugins/lint';
import { Runtime, createRuntime } from '../src/runtime';
import { DatabaseConnection } from '../src/connection';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';

describe('Lint Plugin', () => {
  let mockDriver: DatabaseConnection;
  let mockSchema: Schema;

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
            email: { type: 'text', nullable: false, unique: true },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };
  });

  describe('no-select-star rule', () => {
    it('throws error for SELECT * queries', async () => {
      const planWithStar: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: true,
        },
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: [] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-select-star': 'error' } })],
      });

      await expect(runtime.execute(planWithStar)).rejects.toThrow(GuardrailError);
      await expect(runtime.execute(planWithStar)).rejects.toThrow(
        '[no-select-star] SELECT * is disallowed. Explicitly list columns instead.',
      );
    });

    it('allows explicit column selection', async () => {
      const planWithColumns: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
        },
        sql: 'SELECT "id" AS "id" FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-select-star': 'error' } })],
      });

      await expect(runtime.execute(planWithColumns)).resolves.toEqual([{ id: 1, name: 'test' }]);
    });

    it('respects warn level', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const planWithStar: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: true,
        },
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: [] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-select-star': 'warn' } })],
      });

      await runtime.execute(planWithStar);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[no-select-star] SELECT * is disallowed. Explicitly list columns instead.',
      );

      consoleSpy.mockRestore();
    });
  });

  describe('mutation-requires-where rule', () => {
    it('is currently disabled (QueryAST only supports SELECT)', async () => {
      const updatePlan: Plan = {
        ast: {
          type: 'update' as any,
          from: 'user',
          contractHash: 'test-hash',
        },
        sql: 'UPDATE "user" SET "name" = $1',
        params: ['new name'],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: [] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'mutation-requires-where': 'error' } })],
      });

      // The rule is currently disabled, so this should not throw
      await expect(runtime.execute(updatePlan)).resolves.toBeDefined();
    });

    it('will be enabled when UPDATE/DELETE are added to QueryAST', async () => {
      // This test documents the future behavior
      expect(true).toBe(true);
    });
  });

  describe('no-missing-limit rule', () => {
    it('warns for unbounded SELECT', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const unboundedPlan: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          // No WHERE, no LIMIT
        },
        sql: 'SELECT "id" AS "id" FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-missing-limit': 'warn' } })],
      });

      await runtime.execute(unboundedPlan);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[no-missing-limit] Unbounded SELECT without WHERE or LIMIT may return too many rows.',
      );

      consoleSpy.mockRestore();
    });

    it('does not warn for SELECT with WHERE', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const boundedPlan: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          where: {
            type: 'where',
            condition: { type: 'eq', field: 'id', value: 1 } as any,
          },
        },
        sql: 'SELECT "id" AS "id" FROM "user" WHERE "id" = $1',
        params: [1],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-missing-limit': 'warn' } })],
      });

      await runtime.execute(boundedPlan);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('no-unindexed-column-in-where rule', () => {
    it('warns for equality on non-indexed column', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const unindexedPlan: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          where: {
            type: 'where',
            condition: { type: 'eq', field: 'name', value: 'test' } as any,
          },
        },
        sql: 'SELECT "id" AS "id" FROM "user" WHERE "name" = $1',
        params: ['test'],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-unindexed-column-in-where': 'warn' } })],
      });

      await runtime.execute(unindexedPlan);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[no-unindexed-column-in-where] WHERE clause uses non-indexed column 'name' which may cause performance issues.",
      );

      consoleSpy.mockRestore();
    });

    it('does not warn for equality on primary key', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const pkPlan: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          where: {
            type: 'where',
            condition: { type: 'eq', field: 'id', value: 1 } as any,
          },
        },
        sql: 'SELECT "id" AS "id" FROM "user" WHERE "id" = $1',
        params: [1],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-unindexed-column-in-where': 'warn' } })],
      });

      await runtime.execute(pkPlan);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('does not warn for equality on unique column', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const uniquePlan: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          where: {
            type: 'where',
            condition: { type: 'eq', field: 'email', value: 'test@example.com' } as any,
          },
        },
        sql: 'SELECT "id" AS "id" FROM "user" WHERE "email" = $1',
        params: ['test@example.com'],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-unindexed-column-in-where': 'warn' } })],
      });

      await runtime.execute(uniquePlan);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('rule configuration', () => {
    it('respects off level', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const planWithStar: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: true,
        },
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: [] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [lint({ rules: { 'no-select-star': 'off' } })],
      });

      await runtime.execute(planWithStar);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('handles multiple rules with different levels', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Use a query that triggers no-missing-limit warning but not no-select-star error
      const planWithLimit: Plan = {
        ast: {
          type: 'select',
          from: 'user',
          contractHash: 'test-hash',
          projectStar: false,
          select: {
            type: 'select',
            fields: {
              id: { table: 'user', name: 'id', __contractHash: 'test-hash' } as any,
            },
          },
          // No WHERE, no LIMIT - triggers no-missing-limit warning
        },
        sql: 'SELECT "id" AS "id" FROM "user"',
        params: [],
        meta: {
          contractHash: 'test-hash',
          target: 'postgres',
          refs: { tables: ['user'], columns: ['user.id'] },
        },
      };

      const runtime = createRuntime({
        ir: mockSchema,
        driver: mockDriver,
        plugins: [
          lint({
            rules: {
              'no-select-star': 'error',
              'no-missing-limit': 'warn',
            },
          }),
        ],
      });

      await runtime.execute(planWithLimit);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[no-missing-limit] Unbounded SELECT without WHERE or LIMIT may return too many rows.',
      );

      consoleSpy.mockRestore();
    });
  });
});
