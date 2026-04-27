import type { PlanMeta } from '@prisma-next/contract/types';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { computeSqlIdentityKey } from '../src/identity-key';

function makeMeta(overrides?: Partial<PlanMeta>): PlanMeta {
  return {
    target: 'postgres',
    storageHash: 'sha256:test',
    lane: 'dsl',
    paramDescriptors: [],
    ...overrides,
  };
}

function makeExec(overrides?: {
  sql?: string;
  params?: readonly unknown[];
  meta?: Partial<PlanMeta>;
}): SqlExecutionPlan {
  return {
    sql: overrides?.sql ?? 'select 1',
    params: overrides?.params ?? [],
    meta: makeMeta(overrides?.meta),
  };
}

describe('computeSqlIdentityKey', () => {
  describe('stability', () => {
    it('returns the same key for identical plans', () => {
      const a = makeExec({ sql: 'select * from users where id = $1', params: [42] });
      const b = makeExec({ sql: 'select * from users where id = $1', params: [42] });
      expect(computeSqlIdentityKey(a)).toBe(computeSqlIdentityKey(b));
    });

    it('returns the same key across repeated invocations', () => {
      const exec = makeExec({ sql: 'select 1', params: [1, 'x'] });
      const first = computeSqlIdentityKey(exec);
      const second = computeSqlIdentityKey(exec);
      const third = computeSqlIdentityKey(exec);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('is insensitive to object key insertion order in params', () => {
      const a = makeExec({
        sql: 'insert into users (data) values ($1)',
        params: [{ name: 'Alice', age: 30 }],
      });
      const b = makeExec({
        sql: 'insert into users (data) values ($1)',
        params: [{ age: 30, name: 'Alice' }],
      });
      expect(computeSqlIdentityKey(a)).toBe(computeSqlIdentityKey(b));
    });

    it('is insensitive to nested object key order in params', () => {
      const a = makeExec({
        sql: 'select * from users where filter = $1',
        params: [{ outer: { a: 1, b: 2 }, after: true }],
      });
      const b = makeExec({
        sql: 'select * from users where filter = $1',
        params: [{ after: true, outer: { b: 2, a: 1 } }],
      });
      expect(computeSqlIdentityKey(a)).toBe(computeSqlIdentityKey(b));
    });
  });

  describe('discrimination', () => {
    it('discriminates on differing storageHash with same SQL and params', () => {
      const a = makeExec({ sql: 'select 1', params: [], meta: { storageHash: 'sha256:v1' } });
      const b = makeExec({ sql: 'select 1', params: [], meta: { storageHash: 'sha256:v2' } });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates on differing SQL with same storageHash and params', () => {
      const a = makeExec({ sql: 'select * from users', params: [] });
      const b = makeExec({ sql: 'select * from posts', params: [] });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates on differing param values with same SQL and storageHash', () => {
      const a = makeExec({ sql: 'select * from users where id = $1', params: [1] });
      const b = makeExec({ sql: 'select * from users where id = $1', params: [2] });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates on differing param order (positional params are order-significant)', () => {
      const a = makeExec({ sql: 'select * from t where a = $1 and b = $2', params: [1, 2] });
      const b = makeExec({ sql: 'select * from t where a = $1 and b = $2', params: [2, 1] });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates BigInt params from same-valued numeric params', () => {
      const a = makeExec({ sql: 'select * from t where id = $1', params: [1] });
      const b = makeExec({ sql: 'select * from t where id = $1', params: [1n] });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates null param from undefined param', () => {
      const a = makeExec({ sql: 'select * from t where x = $1', params: [null] });
      const b = makeExec({ sql: 'select * from t where x = $1', params: [undefined] });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates Date params at differing instants', () => {
      const a = makeExec({
        sql: 'select * from events where t = $1',
        params: [new Date('2026-01-01T00:00:00.000Z')],
      });
      const b = makeExec({
        sql: 'select * from events where t = $1',
        params: [new Date('2026-01-02T00:00:00.000Z')],
      });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });

    it('discriminates Buffer params with differing bytes', () => {
      const a = makeExec({
        sql: 'select * from blobs where data = $1',
        params: [new Uint8Array([0x01, 0x02])],
      });
      const b = makeExec({
        sql: 'select * from blobs where data = $1',
        params: [new Uint8Array([0x01, 0x03])],
      });
      expect(computeSqlIdentityKey(a)).not.toBe(computeSqlIdentityKey(b));
    });
  });

  describe('shape', () => {
    it('returns a fixed-size hashIdentity digest', () => {
      const exec = makeExec({
        sql: 'select 1',
        params: [42],
        meta: { storageHash: 'sha256:abc' },
      });
      const key = computeSqlIdentityKey(exec);
      expect(key).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });

    it('does not embed the raw SQL or params in its output (opacity)', () => {
      const sensitiveSql = 'select * from users where token = $1';
      const sensitiveParam = 'super-secret-token-1234567890';
      const exec = makeExec({ sql: sensitiveSql, params: [sensitiveParam] });
      const key = computeSqlIdentityKey(exec);
      expect(key).not.toContain(sensitiveSql);
      expect(key).not.toContain(sensitiveParam);
    });

    it('produces a fixed-size key regardless of payload size', () => {
      const small = makeExec({ sql: 'select 1', params: [] });
      const large = makeExec({
        sql: 'select * from t where data = $1',
        params: ['x'.repeat(1_000_000)],
      });
      expect(computeSqlIdentityKey(small).length).toBe(computeSqlIdentityKey(large).length);
    });

    it('returns the same key for two identical empty-params plans', () => {
      const a = makeExec({ sql: 'select 1', params: [] });
      const b = makeExec({ sql: 'select 1', params: [] });
      expect(computeSqlIdentityKey(a)).toBe(computeSqlIdentityKey(b));
    });
  });
});
