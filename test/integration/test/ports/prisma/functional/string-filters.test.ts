import { and, not } from '@prisma-next/sql-orm-client';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/string-filters/generated/contract';
import contractJson from '../../_fixtures/string-filters/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/string-filters
// (postgres matrix entry only; mongo-only features skipped).
//
// Filter-surface gap: prisma-next ORM exposes `like` (case-sensitive SQL LIKE)
// but no dedicated startsWith/endsWith/contains/mode:insensitive methods.
// We implement the three Prisma string filters via `like`:
//   startsWith(prefix) → like(`${prefix}%`)
//   endsWith(suffix)   → like(`%${suffix}`)
//   contains(sub)      → like(`%${sub}%`)
//
// `mode: 'insensitive'` maps to SQL ILIKE — exposed on textual fields as
// `.ilike(pattern)` (see adapter-postgres `ilike` operation).

const SEED = [
  { value: 'foo bar baz' },
  { value: 'foo' },
  { value: 'baz' },
  { value: 'bar' },
  { value: '' },
  { value: 'completely different' },
];

function withStringFilters(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll(SEED);
    await fn(ctx);
  });
}

describe('ports/prisma/functional/string-filters', () => {
  it(
    'startsWith matches prefix',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('foo%'))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(2);
        expect(results.map((r) => r.value)).toEqual(['foo', 'foo bar baz']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'startsWith with no match',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('xyz%')).all();
        expect(results.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'startsWith with empty string matches all',
    () =>
      withStringFilters(async ({ db }) => {
        // startsWith('') → like('%') matches everything
        const results = await db.public.TestModel.where((m) => m.value.like('%')).all();
        expect(results.length).toBe(6);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'endsWith matches suffix',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('%baz'))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(2);
        expect(results.map((r) => r.value)).toEqual(['baz', 'foo bar baz']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'endsWith with no match',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('%xyz')).all();
        expect(results.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'endsWith with empty string matches all',
    () =>
      withStringFilters(async ({ db }) => {
        // endsWith('') → like('%') matches everything
        const results = await db.public.TestModel.where((m) => m.value.like('%')).all();
        expect(results.length).toBe(6);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'contains matches substring',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('%bar%'))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(2);
        expect(results.map((r) => r.value)).toEqual(['bar', 'foo bar baz']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'contains with no match',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => m.value.like('%xyz%')).all();
        expect(results.length).toBe(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'contains with empty string matches all',
    () =>
      withStringFilters(async ({ db }) => {
        // contains('') → like('%%') matches everything
        const results = await db.public.TestModel.where((m) => m.value.like('%%')).all();
        expect(results.length).toBe(6);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'combined startsWith + endsWith',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) =>
          and(m.value.like('foo%'), m.value.like('%baz')),
        )
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(1);
        expect(results[0]?.value).toBe('foo bar baz');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'combined startsWith + contains',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) =>
          and(m.value.like('foo%'), m.value.like('%bar%')),
        )
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(1);
        expect(results[0]?.value).toBe('foo bar baz');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'combined contains + endsWith',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) =>
          and(m.value.like('%bar%'), m.value.like('%baz')),
        )
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(1);
        expect(results[0]?.value).toBe('foo bar baz');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'NOT startsWith',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => not(m.value.like('foo%')))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(4);
        expect(results.map((r) => r.value)).toEqual(['', 'bar', 'baz', 'completely different']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'NOT contains',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => not(m.value.like('%bar%')))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(4);
        expect(results.map((r) => r.value)).toEqual(['', 'baz', 'completely different', 'foo']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'NOT endsWith',
    () =>
      withStringFilters(async ({ db }) => {
        const results = await db.public.TestModel.where((m) => not(m.value.like('%baz')))
          .orderBy((m) => m.value.asc())
          .all();
        expect(results.length).toBe(4);
        expect(results.map((r) => r.value)).toEqual(['', 'bar', 'completely different', 'foo']);
      }),
    timeouts.spinUpPpgDev,
  );

  // Upstream seeds FOO BAR BAZ + Foo once in beforeAll for the insensitive suite;
  // here each test seeds its own isolated db so we seed those rows per-test.
  it(
    'mode:insensitive contains case-insensitive',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { value: 'FOO BAR BAZ' },
          { value: 'bar' },
          { value: 'foo bar baz' },
        ]);
        const results = await db.public.TestModel.where((m) => m.value.ilike('%bar%')).all();
        expect(results.map((r) => r.value).sort()).toEqual(['FOO BAR BAZ', 'bar', 'foo bar baz']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'mode:insensitive startsWith case-insensitive',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { value: 'FOO BAR BAZ' },
          { value: 'Foo' },
          { value: 'foo' },
          { value: 'foo bar baz' },
        ]);
        const results = await db.public.TestModel.where((m) => m.value.ilike('foo%')).all();
        expect(results.map((r) => r.value).sort()).toEqual([
          'FOO BAR BAZ',
          'Foo',
          'foo',
          'foo bar baz',
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'mode:insensitive endsWith case-insensitive',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.createAll([
          { value: 'FOO BAR BAZ' },
          { value: 'baz' },
          { value: 'foo bar baz' },
        ]);
        const results = await db.public.TestModel.where((m) => m.value.ilike('%baz')).all();
        expect(results.map((r) => r.value).sort()).toEqual(['FOO BAR BAZ', 'baz', 'foo bar baz']);
      }),
    timeouts.spinUpPpgDev,
  );
});
