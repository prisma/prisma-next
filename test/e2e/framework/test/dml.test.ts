import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('DML E2E Tests', { timeout: 30000 }, () => {
  it('inserts, updates, and deletes a user', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, client }) => {
      // Insert
      await db.user.insert({ email: 'e2e@example.com' }).first();

      const inserted = await db.user
        .select('id', 'email', 'created_at', 'update_at')
        .where((f, fns) => fns.eq(f.email, 'e2e@example.com'))
        .first();

      expect(inserted).toMatchObject({
        id: expect.any(Number),
        email: 'e2e@example.com',
        created_at: expect.any(String),
        update_at: null,
      });

      const userId = inserted!.id;

      // Update
      await db.user
        .update({ email: 'updated-e2e@example.com' })
        .where((f, fns) => fns.eq(f.id, userId))
        .first();

      const updated = await db.user
        .select('id', 'email')
        .where((f, fns) => fns.eq(f.id, userId))
        .first();

      expect(updated).toMatchObject({
        id: userId,
        email: 'updated-e2e@example.com',
      });

      // Delete
      await db.user
        .delete()
        .where((f, fns) => fns.eq(f.id, userId))
        .first();

      // Verify deleted
      const selectResult = await client.query('SELECT * FROM "user" WHERE id = $1', [userId]);
      expect(selectResult.rows.length).toBe(0);
    });
  });
});

describe('DML E2E Tests - UUIDv7 client-generated IDs', { timeout: 30000 }, () => {
  const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('auto-generates a valid UUIDv7 id on insert', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
      await db.event.insert({ name: 'uuidv7-test-event' }).first();

      const row = await db.event
        .select('id', 'name', 'created_at', 'scheduled_at')
        .where((f, fns) => fns.eq(f.name, 'uuidv7-test-event'))
        .first();

      expect(row).toMatchObject({
        id: expect.stringMatching(UUIDV7_REGEX),
        name: 'uuidv7-test-event',
        created_at: expect.any(String),
        scheduled_at: '2024-01-15T10:30:00.000Z',
      });
    });
  });

  it('allows overriding the auto-generated id', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
      const overrideId = '019470ab-9a66-7000-8000-000000000001';

      await db.event.insert({ id: overrideId, name: 'override-event' }).first();

      const row = await db.event
        .select('id', 'name')
        .where((f, fns) => fns.eq(f.id, overrideId))
        .first();

      expect(row).toMatchObject({
        id: overrideId,
        name: 'override-event',
      });
    });
  });

  it('updates and deletes by UUIDv7 id', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, client }) => {
      // Insert (auto-generated id)
      await db.event.insert({ name: 'to-be-updated' }).first();

      const inserted = await db.event
        .select('id', 'name')
        .where((f, fns) => fns.eq(f.name, 'to-be-updated'))
        .first();

      const eventId = inserted!.id;
      expect(eventId).toMatch(UUIDV7_REGEX);

      // Update
      await db.event
        .update({ name: 'updated-event' })
        .where((f, fns) => fns.eq(f.id, eventId))
        .first();

      const updated = await db.event
        .select('id', 'name')
        .where((f, fns) => fns.eq(f.id, eventId))
        .first();

      expect(updated).toMatchObject({
        id: eventId,
        name: 'updated-event',
      });

      // Delete
      await db.event
        .delete()
        .where((f, fns) => fns.eq(f.id, eventId))
        .first();

      // Verify deleted
      const selectResult = await client.query('SELECT * FROM "event" WHERE id = $1', [eventId]);
      expect(selectResult.rows.length).toBe(0);
    });
  });

  it('applies literal defaults for every supported type', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
      await db.literal_defaults.insert({}).first();

      const row = await db.literal_defaults
        .select('id', 'label', 'score', 'rating', 'active', 'big_count', 'metadata', 'tags')
        .first();

      expect(row).not.toBeNull();
      expect(row!.id).toEqual(expect.any(Number));
      expect(row!.label).toBe('draft');
      expect(row!.score).toBe(0);
      expect(row!.rating).toBeCloseTo(3.14);
      expect(row!.active).toBe(true);
      expect(row!.big_count).toBe('9007199254740993');
      expect(row!.metadata).toEqual({ key: 'default' });
      expect(row!.tags).toEqual(['alpha', 'beta']);
    });
  });

  it('supports typed jsonb/json values in insert and select clauses', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db }) => {
      const profile = {
        displayName: 'e2e',
        tags: ['typed', 'json'],
        active: true,
      } as const;
      const meta = {
        source: 'dml-test',
        rank: 10,
        verified: true,
      } as const;

      await db.user.insert({ email: 'json@example.com', profile }).first();

      const userRow = await db.user
        .select('id', 'profile')
        .where((f, fns) => fns.eq(f.email, 'json@example.com'))
        .first();

      expect(userRow).toMatchObject({ profile });

      await db.post
        .insert({
          userId: userRow!.id,
          title: 'Typed JSON post',
          published: true,
          meta,
        })
        .first();

      const postRow = await db.post
        .select('id', 'meta')
        .where((f, fns) => fns.eq(f.title, 'Typed JSON post'))
        .first();

      expect(postRow).toMatchObject({ meta });
    });
  });
});
