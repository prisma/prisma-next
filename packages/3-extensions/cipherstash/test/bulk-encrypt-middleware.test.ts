/**
 * Bulk-encrypt middleware behaviour.
 *
 * Drives `bulkEncryptMiddleware(sdk).beforeExecute(plan, ctx, params)`
 * against an instrumented mock `CipherstashSdk` and asserts:
 *
 *   - One `bulkEncrypt` call per `(table, column)` group; N envelopes
 *     in the same column collapse into a single SDK round-trip.
 *   - `(table, column)` is derived from the lowered `InsertAst` /
 *     `UpdateAst` via the middleware's AST walk and stamped onto each
 *     envelope handle before grouping. A pre-stamped routing context
 *     (write-once-wins) is preserved.
 *   - The SDK-returned ciphertext is stamped onto every envelope
 *     handle via `setHandleCiphertext`; codec.encode then reads it
 *     on the wire.
 *   - `ctx.signal` is forwarded by identity to the SDK so downstream
 *     cancellation observes the same `AbortSignal`.
 *   - The handle's `plaintext` slot is **retained** post-encrypt —
 *     `envelope.decrypt()` returns the cached plaintext synchronously
 *     without consulting the SDK.
 *
 * Plus the no-op shape (no cipherstash params → no SDK call) and the
 * SDK-shape error path (wrong number of ciphertexts → diagnostic).
 */

import type { Contract, PlanMeta } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type ColumnRef,
  InsertAst,
  ParamRef,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { createSqlParamRefMutator } from '@prisma-next/sql-relational-core/middleware';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlMiddlewareContext } from '@prisma-next/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedString, setHandleRoutingKey } from '../src/execution/envelope';
import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../src/execution/sdk';
import { CIPHERSTASH_STRING_CODEC_ID } from '../src/extension-metadata/constants';
import { bulkEncryptMiddleware } from '../src/middleware/bulk-encrypt';

const baseMeta: PlanMeta = {
  target: 'postgres',
  storageHash: 'sha256:test',
  lane: 'dsl',
};

function createCtx(overrides?: Partial<SqlMiddlewareContext>): SqlMiddlewareContext {
  return {
    contract: {} as Contract<SqlStorage>,
    mode: 'strict' as const,
    now: () => Date.now(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    contentHash: async () => 'mock-hash',
    ...overrides,
  };
}

interface CounterSdk extends CipherstashSdk {
  readonly bulkEncryptCalls: CipherstashBulkEncryptArgs[];
  readonly bulkDecryptCalls: CipherstashBulkDecryptArgs[];
  readonly singleDecryptCalls: CipherstashSingleDecryptArgs[];
}

function makeCounterSdk(options?: {
  encryptImpl?: (args: CipherstashBulkEncryptArgs) => ReadonlyArray<unknown>;
}): CounterSdk {
  const bulkEncryptCalls: CipherstashBulkEncryptArgs[] = [];
  const bulkDecryptCalls: CipherstashBulkDecryptArgs[] = [];
  const singleDecryptCalls: CipherstashSingleDecryptArgs[] = [];
  const encryptImpl =
    options?.encryptImpl ??
    ((args: CipherstashBulkEncryptArgs) =>
      args.values.map(
        (plaintext) => `cipher:${args.routingKey.table}.${args.routingKey.column}:${plaintext}`,
      ));
  return {
    bulkEncryptCalls,
    bulkDecryptCalls,
    singleDecryptCalls,
    decrypt(args) {
      singleDecryptCalls.push(args);
      return Promise.resolve(`single:${String(args.ciphertext)}`);
    },
    bulkEncrypt(args) {
      bulkEncryptCalls.push(args);
      return Promise.resolve(encryptImpl(args));
    },
    bulkDecrypt(args) {
      bulkDecryptCalls.push(args);
      return Promise.resolve(args.ciphertexts.map((c) => `bulk-decrypt:${String(c)}`));
    },
  };
}

function buildInsertPlan(
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): SqlExecutionPlan {
  const params: unknown[] = [];
  const astRows = rows.map((row) => {
    const out: Record<string, ParamRef> = {};
    for (const [column, value] of Object.entries(row)) {
      const ref = ParamRef.of(value, { codecId: CIPHERSTASH_STRING_CODEC_ID });
      out[column] = ref;
      params.push(value);
    }
    return out;
  });
  const ast = new InsertAst(TableSource.named(table), astRows);
  return {
    sql: `INSERT INTO "${table}" (...) VALUES (...)`,
    params,
    meta: { ...baseMeta },
    ast,
  } as SqlExecutionPlan;
}

function buildUpdatePlan(table: string, set: Record<string, unknown>): SqlExecutionPlan {
  const params: unknown[] = [];
  const astSet: Record<string, ParamRef | ColumnRef> = {};
  for (const [column, value] of Object.entries(set)) {
    const ref = ParamRef.of(value, { codecId: CIPHERSTASH_STRING_CODEC_ID });
    astSet[column] = ref;
    params.push(value);
  }
  const ast = new UpdateAst(TableSource.named(table), astSet);
  return {
    sql: `UPDATE "${table}" SET ...`,
    params,
    meta: { ...baseMeta },
    ast,
  } as SqlExecutionPlan;
}

describe('bulkEncryptMiddleware', () => {
  describe('one bulkEncrypt call per (table, column) group', () => {
    it('issues exactly one bulkEncrypt call when 10 rows insert into one column', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelopes = Array.from({ length: 10 }, (_, i) =>
        EncryptedString.from(`alice${i}@example.com`),
      );
      const plan = buildInsertPlan(
        'user',
        envelopes.map((e) => ({ email: e })),
      );
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls).toHaveLength(1);
      expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({ table: 'user', column: 'email' });
      expect(sdk.bulkEncryptCalls[0]?.values).toEqual(
        envelopes.map((_, i) => `alice${i}@example.com`),
      );
    });

    it('partitions targets across (table, column) groups: one bulkEncrypt per group', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const e1 = EncryptedString.from('a@x.com');
      const e2 = EncryptedString.from('b@x.com');
      const e3 = EncryptedString.from('alice');
      const plan = buildInsertPlan('user', [
        { email: e1, username: e3 },
        { email: e2, username: EncryptedString.from('bob') },
      ]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls).toHaveLength(2);
      const byColumn = new Map(sdk.bulkEncryptCalls.map((c) => [c.routingKey.column, c]));
      expect(byColumn.get('email')?.values).toEqual(['a@x.com', 'b@x.com']);
      expect(byColumn.get('username')?.values).toEqual(['alice', 'bob']);
    });
  });

  describe('ciphertext is stamped onto each envelope handle', () => {
    it('populates handle.ciphertext with the SDK-returned wire value', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(envelope.expose().ciphertext).toBe('cipher:user.email:alice@example.com');
    });
  });

  describe('ctx.signal is forwarded by identity to the SDK', () => {
    it('passes ctx.signal to bulkEncrypt by reference', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);
      const controller = new AbortController();

      await middleware.beforeExecute?.(plan, createCtx({ signal: controller.signal }), params);

      expect(sdk.bulkEncryptCalls).toHaveLength(1);
      expect(sdk.bulkEncryptCalls[0]?.signal).toBe(controller.signal);
    });

    it('omits signal when ctx.signal is undefined', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls).toHaveLength(1);
      expect(sdk.bulkEncryptCalls[0]?.signal).toBeUndefined();
    });
  });

  describe('plaintext slot is retained post-encrypt', () => {
    it('decrypt() returns plaintext synchronously without consulting the SDK', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);
      const plaintext = await envelope.decrypt();

      expect(plaintext).toBe('alice@example.com');
      expect(sdk.singleDecryptCalls).toEqual([]);
      expect(sdk.bulkDecryptCalls).toEqual([]);
    });

    it('keeps handle.plaintext populated after middleware returns', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(envelope.expose().plaintext).toBe('alice@example.com');
    });
  });

  describe('routing key is derived from envelope handle (table, column)', () => {
    it('stamps (table, column) from InsertAst before grouping', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(envelope.expose().table).toBe('user');
      expect(envelope.expose().column).toBe('email');
    });

    it('stamps (table, column) from UpdateAst before grouping', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      const plan = buildUpdatePlan('admin', { email: envelope });
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls).toHaveLength(1);
      expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({
        table: 'admin',
        column: 'email',
      });
    });

    it('rejects re-binding a pre-stamped envelope to a different routing target', async () => {
      // Reusing an envelope already bound to one (table, column) routing
      // target inside a bulk-encrypt plan that lowers to a different
      // target is a programming error: `setHandleRoutingKey` throws on a
      // conflicting reassignment so the envelope cannot silently retain
      // a stale binding and route to the wrong bulk-encrypt batch.
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      setHandleRoutingKey(envelope, 'admin', 'email');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await expect(middleware.beforeExecute?.(plan, createCtx(), params)).rejects.toThrow(
        /routing-key table conflict/,
      );
      expect(sdk.bulkEncryptCalls).toHaveLength(0);
    });

    it('re-stamping with the same routing target is a no-op', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const envelope = EncryptedString.from('alice@example.com');
      setHandleRoutingKey(envelope, 'user', 'email');
      const plan = buildInsertPlan('user', [{ email: envelope }]);
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({
        table: 'user',
        column: 'email',
      });
    });
  });

  describe('no-op cases', () => {
    it('does not call bulkEncrypt when the plan has no cipherstash params', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const ast = new InsertAst(TableSource.named('user'), [{ id: ParamRef.of(1) }]);
      const plan = {
        sql: 'INSERT INTO "user" (id) VALUES ($1)',
        params: [1],
        meta: { ...baseMeta },
        ast,
      } as SqlExecutionPlan;
      const params = createSqlParamRefMutator(plan);

      await middleware.beforeExecute?.(plan, createCtx(), params);

      expect(sdk.bulkEncryptCalls).toEqual([]);
    });

    it('skips when params is undefined', async () => {
      const sdk = makeCounterSdk();
      const middleware = bulkEncryptMiddleware(sdk);
      const plan = {
        sql: 'SELECT 1',
        params: [],
        meta: { ...baseMeta },
      } as unknown as SqlExecutionPlan;

      await middleware.beforeExecute?.(plan, createCtx());

      expect(sdk.bulkEncryptCalls).toEqual([]);
    });
  });

  describe('error paths', () => {
    it('throws when the SDK returns the wrong number of ciphertexts', async () => {
      const sdk = makeCounterSdk({ encryptImpl: () => ['only-one'] });
      const middleware = bulkEncryptMiddleware(sdk);
      const plan = buildInsertPlan('user', [
        { email: EncryptedString.from('a@x') },
        { email: EncryptedString.from('b@y') },
      ]);
      const params = createSqlParamRefMutator(plan);

      await expect(middleware.beforeExecute?.(plan, createCtx(), params)).rejects.toThrow(
        /1 ciphertexts.*2 were requested/,
      );
    });
  });
});

describe('bulkEncryptMiddleware — name + family identity', () => {
  it('declares the SQL family + a stable middleware name', () => {
    const middleware = bulkEncryptMiddleware(makeCounterSdk());
    expect(middleware.familyId).toBe('sql');
    expect(middleware.name).toBe('cipherstash.bulk-encrypt');
  });
});
