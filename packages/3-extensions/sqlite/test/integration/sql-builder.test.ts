import type { JsonValue } from '@prisma-next/adapter-sqlite/codec-types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { collect, setupIntegrationTest } from './setup';

describe('integration: sql-builder-new on SQLite', () => {
  const { db } = setupIntegrationTest();

  describe('SELECT', () => {
    it('basic column projection', async () => {
      const rows = await collect(db().users.select('id', 'name').all());
      expect(rows).toHaveLength(4);
      expect(typeof rows[0]!.id).toBe('number');
      expect(typeof rows[0]!.name).toBe('string');

      expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; name: string }>();
    });

    it('WHERE filter', async () => {
      const rows = await collect(
        db()
          .users.select('id', 'name')
          .where((f, fns) => fns.eq(f.id, 1))
          .all(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe('Alice');
    });

    it('ORDER BY', async () => {
      const rows = await collect(
        db().users.select('id', 'name').orderBy('id', { direction: 'desc' }).all(),
      );
      expect(rows[0]!.id).toBe(4);
      expect(rows[3]!.id).toBe(1);
    });

    it('LIMIT and OFFSET', async () => {
      const rows = await collect(db().users.select('id').orderBy('id').limit(2).offset(1).all());
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).toBe(2);
      expect(rows[1]!.id).toBe(3);
    });

    it('callback record select', async () => {
      const rows = await collect(
        db()
          .users.select((f) => ({ myId: f.id, myName: f.name }))
          .all(),
      );
      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveProperty('myId');
      expect(rows[0]).toHaveProperty('myName');

      expectTypeOf(rows[0]!).toEqualTypeOf<{ myId: number; myName: string }>();
    });
  });

  describe('INSERT', () => {
    it('insert with RETURNING', async () => {
      const row = await db()
        .users.insert({ id: 100, name: 'Test', email: 'test@example.com' })
        .returning('id', 'name')
        .first();
      expect(row).toMatchObject({ id: 100, name: 'Test' });

      expectTypeOf(row).toEqualTypeOf<{ id: number; name: string } | null>();
    });
  });

  describe('UPDATE', () => {
    it('update with WHERE and RETURNING', async () => {
      const row = await db()
        .users.update({ name: 'Alice Updated' })
        .where((f, fns) => fns.eq(f.id, 1))
        .returning('id', 'name')
        .first();
      expect(row).toMatchObject({ id: 1, name: 'Alice Updated' });

      expectTypeOf(row).toEqualTypeOf<{ id: number; name: string } | null>();

      await db()
        .users.update({ name: 'Alice' })
        .where((f, fns) => fns.eq(f.id, 1))
        .first();
    });
  });

  describe('DELETE', () => {
    it('delete with WHERE and RETURNING', async () => {
      await db().users.insert({ id: 999, name: 'Temp', email: 'temp@example.com' }).first();
      const deleted = await db()
        .users.delete()
        .where((f, fns) => fns.eq(f.id, 999))
        .returning('id')
        .first();
      expect(deleted).toMatchObject({ id: 999 });

      expectTypeOf(deleted).toEqualTypeOf<{ id: number } | null>();
    });
  });

  describe('codec round-trip', () => {
    it('boolean survives insert and select', async () => {
      await db()
        .typed_rows.insert({
          id: 1,
          active: true,
          created_at: new Date('2024-01-01T00:00:00.000Z'),
          label: 'a',
        })
        .first();
      await db()
        .typed_rows.insert({
          id: 2,
          active: false,
          created_at: new Date('2024-06-15T12:00:00.000Z'),
          label: 'b',
        })
        .first();

      const rows = await collect(db().typed_rows.select('id', 'active').orderBy('id').all());
      expect(rows[0]!.active).toBe(true);
      expect(rows[1]!.active).toBe(false);

      expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; active: boolean }>();
    });

    it('datetime survives insert and select', async () => {
      const rows = await collect(db().typed_rows.select('id', 'created_at').orderBy('id').all());
      expect(rows[0]!.created_at).toBeInstanceOf(Date);
      expect((rows[0]!.created_at as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');

      expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; created_at: Date }>();
    });

    it('json survives insert and select', async () => {
      const jsonData = { nested: { key: 'value' }, list: [1, 2, 3] };
      await db()
        .typed_rows.insert({
          id: 3,
          active: true,
          created_at: new Date('2024-01-01T00:00:00.000Z'),
          metadata: jsonData,
          label: 'c',
        })
        .first();

      const rows = await collect(
        db()
          .typed_rows.select('id', 'metadata')
          .where((f, fns) => fns.eq(f.id, 3))
          .all(),
      );
      expect(rows[0]!.metadata).toEqual(jsonData);

      expectTypeOf(rows[0]!).toEqualTypeOf<{ id: number; metadata: JsonValue | null }>();
    });
  });

  describe('capability gating', () => {
    it('lateralJoin is not available (sql.lateral: false)', () => {
      const table = db().users;
      // @ts-expect-error lateralJoin is gated out for SQLite
      expect(() => table.lateralJoin('alias', () => null)).toThrow(
        'lateralJoin() requires capability sql.lateral',
      );
    });

    it('distinctOn is not available (no postgres.distinctOn)', () => {
      const query = db().users.select('id');
      // @ts-expect-error distinctOn is gated out for SQLite
      expect(() => query.distinctOn('id')).toThrow(
        'distinctOn() requires capability postgres.distinctOn',
      );
    });

    it('returning is available (sql.returning: true)', () => {
      expectTypeOf(
        db().users.insert({ id: 1, name: 'a', email: 'a@a.com' }).returning,
      ).not.toBeNever();
    });
  });
});
