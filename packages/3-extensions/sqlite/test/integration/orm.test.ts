import type { JsonValue } from '@prisma-next/adapter-sqlite/codec-types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { setupIntegrationTest } from './setup';

describe('integration: ORM on SQLite', () => {
  const { ormClient } = setupIntegrationTest();

  describe('findMany', () => {
    it('returns all rows', async () => {
      const db = ormClient();
      const users = await db.User.all();
      expect(users).toHaveLength(4);

      expectTypeOf(users[0]!).toEqualTypeOf<{
        id: number;
        name: string;
        email: string;
        invitedById: number | null;
      }>();
    });

    it('with filter', async () => {
      const db = ormClient();
      const users = await db.User.where((u) => u.id.eq(1)).all();
      expect(users).toHaveLength(1);
      expect(users[0]!.name).toBe('Alice');
    });

    it('with ordering', async () => {
      const db = ormClient();
      const users = await db.User.orderBy((u) => u.id.desc()).all();
      expect(users[0]!.id).toBe(4);
    });

    it('with take and skip', async () => {
      const db = ormClient();
      const users = await db.User.orderBy((u) => u.id.asc())
        .skip(1)
        .take(2)
        .all();
      expect(users).toHaveLength(2);
      expect(users[0]!.id).toBe(2);
    });
  });

  describe('findFirst', () => {
    it('returns first matching row', async () => {
      const db = ormClient();
      const user = await db.User.where((u) => u.id.eq(1)).first();
      expect(user).not.toBeNull();
      expect(user!.name).toBe('Alice');

      expectTypeOf(user).toEqualTypeOf<{
        id: number;
        name: string;
        email: string;
        invitedById: number | null;
      } | null>();
    });

    it('returns null when no match', async () => {
      const db = ormClient();
      const user = await db.User.where((u) => u.id.eq(9999)).first();
      expect(user).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a row and returns it', async () => {
      const db = ormClient();
      const user = await db.User.create({
        id: 200,
        name: 'Created',
        email: 'created@example.com',
      });
      expect(user.id).toBe(200);
      expect(user.name).toBe('Created');

      expectTypeOf(user).toEqualTypeOf<{
        id: number;
        name: string;
        email: string;
        invitedById: number | null;
      }>();

      await db.User.where((u) => u.id.eq(200)).deleteCount();
    });
  });

  describe('createAll', () => {
    it('creates multiple rows', async () => {
      const db = ormClient();
      const rows = await db.User.createAll([
        { id: 500, name: 'Batch1', email: 'batch1@example.com' },
        { id: 501, name: 'Batch2', email: 'batch2@example.com' },
      ]);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).toBe(500);
      expect(rows[1]!.id).toBe(501);

      await db.User.where((u) => u.id.gte(500)).deleteCount();
    });
  });

  describe('update', () => {
    it('updates and returns updated row', async () => {
      const db = ormClient();
      const updated = await db.User.where((u) => u.id.eq(2)).update({ name: 'Bob Updated' });
      expect(updated!.name).toBe('Bob Updated');

      await db.User.where((u) => u.id.eq(2)).update({ name: 'Bob' });
    });
  });

  describe('updateAll', () => {
    it('updates multiple rows and returns them', async () => {
      const db = ormClient();
      await db.User.create({ id: 600, name: 'UpdA', email: 'upda@example.com' });
      await db.User.create({ id: 601, name: 'UpdB', email: 'updb@example.com' });

      const updated = await db.User.where((u) => u.id.gte(600)).updateAll({ name: 'Updated' });
      expect(updated).toHaveLength(2);
      expect(updated[0]!.name).toBe('Updated');

      await db.User.where((u) => u.id.gte(600)).deleteCount();
    });
  });

  describe('delete', () => {
    it('deletes matching rows and returns count', async () => {
      const db = ormClient();
      await db.User.create({
        id: 300,
        name: 'ToDelete',
        email: 'delete@example.com',
      });
      const count = await db.User.where((u) => u.id.eq(300)).deleteCount();
      expect(count).toBe(1);

      expectTypeOf(count).toBeNumber();
    });

    it('deleteAll returns deleted rows', async () => {
      const db = ormClient();
      await db.User.create({ id: 700, name: 'DelA', email: 'dela@example.com' });
      await db.User.create({ id: 701, name: 'DelB', email: 'delb@example.com' });

      const deleted = await db.User.where((u) => u.id.gte(700)).deleteAll();
      expect(deleted).toHaveLength(2);
    });
  });

  describe('includeMany', () => {
    it('loads 1:N relation via json_group_array', async () => {
      const db = ormClient();
      const users = await db.User.where((u) => u.id.eq(1))
        .include('posts')
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]!.posts).toHaveLength(2);
    });
  });

  describe('codec round-trip through ORM', () => {
    // NOTE: The ORM does not currently populate projectionTypes on its query plans,
    // so codec decoding (e.g. INTEGER 0/1 → boolean) does not happen for ORM reads.
    // This is a pre-existing limitation that doesn't affect Postgres (whose wire types
    // already match JS types). Boolean/datetime codec round-trips are tested via
    // sql-builder-new which correctly populates projectionTypes.

    it('creates and reads typed rows', async () => {
      const db = ormClient();
      await db.TypedRow.create({
        id: 10,
        active: true,
        createdAt: new Date('2024-03-15T10:30:00.000Z'),
        metadata: { tags: ['a', 'b'], count: 42 },
        label: 'test',
      });

      const found = await db.TypedRow.where((r) => r.id.eq(10)).first();
      expect(found).not.toBeNull();
      expect(found!.id).toBe(10);
      expect(found!.label).toBe('test');

      expectTypeOf(found).toEqualTypeOf<{
        id: number;
        active: boolean;
        createdAt: Date;
        metadata: JsonValue | null;
        label: string;
      } | null>();

      await db.TypedRow.where((r) => r.id.eq(10)).deleteCount();
    });

    it('null JSON round-trips correctly', async () => {
      const db = ormClient();
      const created = await db.TypedRow.create({
        id: 12,
        active: true,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        label: 'no-meta',
      });
      expect(created.metadata).toBeNull();

      await db.TypedRow.where((r) => r.id.eq(12)).deleteCount();
    });
  });

  describe('upsert', () => {
    it('inserts when row does not exist', async () => {
      const db = ormClient();
      const result = await db.User.upsert({
        create: { id: 800, name: 'Upserted', email: 'upsert@example.com' },
        update: { name: 'Updated' },
      });
      expect(result.id).toBe(800);
      expect(result.name).toBe('Upserted');

      await db.User.where((u) => u.id.eq(800)).deleteCount();
    });

    it('updates when row already exists', async () => {
      const db = ormClient();
      await db.User.create({ id: 801, name: 'Original', email: 'orig@example.com' });

      const result = await db.User.upsert({
        create: { id: 801, name: 'CreateName', email: 'orig@example.com' },
        update: { name: 'UpsertUpdated' },
      });
      expect(result.id).toBe(801);
      expect(result.name).toBe('UpsertUpdated');

      await db.User.where((u) => u.id.eq(801)).deleteCount();
    });
  });
});
