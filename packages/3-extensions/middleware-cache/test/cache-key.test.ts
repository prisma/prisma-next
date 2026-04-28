import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import type { CachedEntry, CacheStore } from '../src/cache-store';

interface MockExec extends ExecutionPlan {
  readonly statement: string;
}

const baseMeta: PlanMeta = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'sha256:test',
  lane: 'orm',
  paramDescriptors: [],
};

function makeExec(statement: string, annotations?: Record<string, unknown>): MockExec {
  return Object.freeze({
    statement,
    meta: annotations ? { ...baseMeta, annotations } : baseMeta,
  });
}

function makeCtx(overrides?: Partial<RuntimeMiddlewareContext>): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    identityKey: (exec) => `id:${(exec as MockExec).statement}`,
    scope: 'runtime',
    ...overrides,
  };
}

function spyStore(): CacheStore & {
  readonly getSpy: ReturnType<typeof vi.fn>;
  readonly setSpy: ReturnType<typeof vi.fn>;
  readonly inner: Map<string, CachedEntry>;
} {
  const inner = new Map<string, CachedEntry>();
  const getSpy = vi.fn(async (key: string) => inner.get(key));
  const setSpy = vi.fn(async (key: string, entry: CachedEntry, _ttlMs: number) => {
    inner.set(key, entry);
  });
  return { get: getSpy, set: setSpy, getSpy, setSpy, inner };
}

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('cache key resolution', () => {
  describe('default path: ctx.identityKey(exec)', () => {
    it('uses the identityKey return value as the cache map key (no rehashing)', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation.apply({ ttl: 60_000 }),
      });
      const ctx = makeCtx();

      // Miss → store.get and store.set both called with the identityKey.
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.getSpy).toHaveBeenCalledWith('id:select 1');
      expect(store.setSpy).toHaveBeenCalledWith('id:select 1', expect.anything(), 60_000);
    });

    it('invokes ctx.identityKey when no per-query key annotation is supplied', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation.apply({ ttl: 60_000 }),
      });
      const identityKey = vi.fn((e: ExecutionPlan) => `derived:${(e as MockExec).statement}`);
      const ctx = makeCtx({ identityKey });

      await mw.intercept!(exec, ctx);

      expect(identityKey).toHaveBeenCalledTimes(1);
      expect(identityKey).toHaveBeenCalledWith(exec);
      expect(store.getSpy).toHaveBeenCalledWith('derived:select 1');
    });

    it('produces distinct cache entries for two execs with distinct identityKey returns', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store, clock: () => 0 });
      const execA = makeExec('A', {
        cache: cacheAnnotation.apply({ ttl: 60_000 }),
      });
      const execB = makeExec('B', {
        cache: cacheAnnotation.apply({ ttl: 60_000 }),
      });
      const ctx = makeCtx();

      // Miss + commit for A.
      await mw.intercept!(execA, ctx);
      await mw.onRow!({ from: 'A' }, execA, ctx);
      await mw.afterExecute!(
        execA,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      // Miss + commit for B.
      await mw.intercept!(execB, ctx);
      await mw.onRow!({ from: 'B' }, execB, ctx);
      await mw.afterExecute!(
        execB,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.inner.size).toBe(2);
      expect(store.inner.get('id:A')?.rows).toEqual([{ from: 'A' }]);
      expect(store.inner.get('id:B')?.rows).toEqual([{ from: 'B' }]);
    });
  });

  describe('per-query override: cacheAnnotation.apply({ key })', () => {
    it('uses the user-supplied key in place of ctx.identityKey', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation.apply({ ttl: 60_000, key: 'custom-key' }),
      });
      const ctx = makeCtx();

      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.getSpy).toHaveBeenCalledWith('custom-key');
      expect(store.setSpy).toHaveBeenCalledWith('custom-key', expect.anything(), 60_000);
    });

    it('does not invoke ctx.identityKey when an override key is supplied', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation.apply({ ttl: 60_000, key: 'custom-key' }),
      });
      const identityKey = vi.fn(() => 'should-not-be-used');
      const ctx = makeCtx({ identityKey });

      await mw.intercept!(exec, ctx);

      expect(identityKey).not.toHaveBeenCalled();
    });

    it('stores user-supplied keys verbatim (no rehashing)', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      // A long, structured user key — verify the middleware does not
      // mangle, hash, or otherwise transform it.
      const userKey = 'tenant=acme|user=alice|page=42';
      const exec = makeExec('select 1', {
        cache: cacheAnnotation.apply({ ttl: 60_000, key: userKey }),
      });
      const ctx = makeCtx();

      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.inner.has(userKey)).toBe(true);
    });

    it('produces a hit using the user-supplied key when previously committed under it', async () => {
      const store = spyStore();
      store.inner.set('shared-key', {
        rows: [{ id: 'pre-cached' }],
        storedAt: 0,
      });

      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select anything', {
        cache: cacheAnnotation.apply({ ttl: 60_000, key: 'shared-key' }),
      });
      const ctx = makeCtx();

      const result = await mw.intercept!(exec, ctx);
      expect(result).toBeDefined();
      expect(await drain(result!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
        { id: 'pre-cached' },
      ]);
    });
  });

  describe('cross-family parity', () => {
    it('works with a Mongo-style identityKey return value (no SQL fields read)', async () => {
      // The cache middleware must not read exec.sql, exec.command, or any
      // family-specific field. Use a "Mongo-shaped" mock plan and a
      // Mongo-style identityKey to demonstrate the package is genuinely
      // family-agnostic.
      interface MongoLikeExec extends ExecutionPlan {
        readonly command: { readonly kind: string; readonly filter: unknown };
      }

      const store = spyStore();
      const mw = createCacheMiddleware({ store });

      const exec: MongoLikeExec = Object.freeze({
        command: { kind: 'find', filter: { active: true } },
        meta: {
          ...baseMeta,
          target: 'mongo',
          targetFamily: 'mongo',
          annotations: {
            cache: cacheAnnotation.apply({ ttl: 60_000 }),
          },
        },
      });

      const ctx = makeCtx({
        identityKey: () => 'mongo:users:find:{active:true}',
      });

      // Miss + commit.
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ _id: 'a', active: true }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      // Hit on the second call.
      const second = await mw.intercept!(exec, ctx);
      expect(second).toBeDefined();
      expect(await drain(second!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
        { _id: 'a', active: true },
      ]);
      expect(store.inner.has('mongo:users:find:{active:true}')).toBe(true);
    });

    it('two distinct identityKey returns produce two distinct cache entries', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store, clock: () => 0 });
      const exec = makeExec('shared statement', {
        cache: cacheAnnotation.apply({ ttl: 60_000 }),
      });

      // Same exec object but two different ctx.identityKey returns —
      // simulating two calls where the family runtime computed different
      // canonical keys (e.g. a parameter changed but the AST/command is
      // structurally identical at this view).
      const ctxA = makeCtx({ identityKey: () => 'key-A' });
      const ctxB = makeCtx({ identityKey: () => 'key-B' });

      // Commit under key-A.
      await mw.intercept!(exec, ctxA);
      await mw.onRow!({ from: 'A' }, exec, ctxA);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctxA,
      );

      // Commit under key-B.
      await mw.intercept!(exec, ctxB);
      await mw.onRow!({ from: 'B' }, exec, ctxB);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctxB,
      );

      expect(store.inner.size).toBe(2);
      expect(store.inner.get('key-A')?.rows).toEqual([{ from: 'A' }]);
      expect(store.inner.get('key-B')?.rows).toEqual([{ from: 'B' }]);
    });
  });
});
