import type { Contract, PlanMeta } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { runBeforeCompileChain } from '../src/middleware/before-compile-chain';
import type {
  DraftPlan,
  SqlMiddleware,
  SqlMiddlewareContext,
} from '../src/middleware/sql-middleware';

function createContext(): SqlMiddlewareContext & {
  log: { debug: ReturnType<typeof vi.fn> };
} {
  const debug = vi.fn();
  return {
    contract: {} as Contract<SqlStorage>,
    mode: 'strict' as const,
    now: () => 0,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug,
    },
  };
}

const meta: PlanMeta = {
  target: 'postgres',
  storageHash: 'sha256:test',
  lane: 'dsl',
  paramDescriptors: [],
};

function createDraft(): DraftPlan {
  const users = TableSource.named('users');
  return {
    ast: SelectAst.from(users).withProjection([]),
    meta,
  };
}

describe('runBeforeCompileChain', () => {
  it(
    'returns the initial draft unchanged when no middleware rewrites',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'noop',
        familyId: 'sql',
        async beforeCompile() {
          return undefined;
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result).toBe(draft);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'treats a returned draft with same ast reference as passthrough',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'sameRef',
        familyId: 'sql',
        async beforeCompile(d) {
          return { ...d };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.ast).toBe(draft.ast);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'replaces the current draft when a middleware returns a new ast ref',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const addWhere = BinaryExpr.eq(ColumnRef.of('users', 'deleted_at'), LiteralExpr.of(null));
      const mw: SqlMiddleware = {
        name: 'softDelete',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(addWhere) };
        },
      };

      const result = await runBeforeCompileChain([mw], draft, ctx);

      expect(result.ast).not.toBe(draft.ast);
      expect(result.ast.kind).toBe('select');
      expect((result.ast as SelectAst).where).toBe(addWhere);
    },
    timeouts.default,
  );

  it(
    'chains rewrites in registration order',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const order: string[] = [];

      const predA = BinaryExpr.eq(ColumnRef.of('users', 'a'), LiteralExpr.of(1));
      const predB = BinaryExpr.eq(ColumnRef.of('users', 'b'), LiteralExpr.of(2));

      const mwA: SqlMiddleware = {
        name: 'addA',
        familyId: 'sql',
        async beforeCompile(d) {
          order.push('A');
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(predA) };
        },
      };
      const mwB: SqlMiddleware = {
        name: 'addB',
        familyId: 'sql',
        async beforeCompile(d) {
          order.push('B');
          if (d.ast.kind !== 'select') return;
          const current = d.ast.where;
          const combined = current ? AndExpr.of([current, predB]) : predB;
          return { ...d, ast: d.ast.withWhere(combined) };
        },
      };

      const result = await runBeforeCompileChain([mwA, mwB], draft, ctx);

      expect(order).toEqual(['A', 'B']);
      expect(result.ast.kind).toBe('select');
      const where = (result.ast as SelectAst).where;
      expect(where?.kind).toBe('and');
    },
    timeouts.default,
  );

  it(
    'emits a debug log event per rewrite with middleware name and lane',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const pred = BinaryExpr.eq(ColumnRef.of('users', 'a'), LiteralExpr.of(1));
      const mw: SqlMiddleware = {
        name: 'rewriteOne',
        familyId: 'sql',
        async beforeCompile(d) {
          if (d.ast.kind !== 'select') return;
          return { ...d, ast: d.ast.withWhere(pred) };
        },
      };

      await runBeforeCompileChain([mw, mw], draft, ctx);

      expect(ctx.log.debug).toHaveBeenCalledTimes(2);
      expect(ctx.log.debug).toHaveBeenCalledWith({
        event: 'middleware.rewrite',
        middleware: 'rewriteOne',
        lane: 'dsl',
      });
    },
    timeouts.default,
  );

  it(
    'skips middleware without beforeCompile',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const observerOnly: SqlMiddleware = {
        name: 'observer',
        familyId: 'sql',
        async beforeExecute() {},
      };

      const result = await runBeforeCompileChain([observerOnly], draft, ctx);

      expect(result).toBe(draft);
      expect(ctx.log.debug).not.toHaveBeenCalled();
    },
    timeouts.default,
  );

  it(
    'propagates errors thrown inside beforeCompile',
    async () => {
      const draft = createDraft();
      const ctx = createContext();
      const mw: SqlMiddleware = {
        name: 'thrower',
        familyId: 'sql',
        async beforeCompile() {
          throw new Error('boom');
        },
      };

      await expect(runBeforeCompileChain([mw], draft, ctx)).rejects.toThrow('boom');
    },
    timeouts.default,
  );
});
