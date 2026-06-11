import { MongoCollection } from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from '../src/core/mongo-target-database';

describe('MongoTargetDatabase entries (open dictionary)', () => {
  describe('exact-shape serialization', () => {
    it('JSON.stringify emits only id and entries (kind is non-enumerable)', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      const parsed = JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
      expect(parsed['id']).toBe('app_db');
    });

    it('kind is not enumerable but still accessible', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      expect(db.kind).toBe('database');
      const descriptor = Object.getOwnPropertyDescriptor(db, 'kind');
      expect(descriptor?.enumerable).toBe(false);
    });

    it('entries.collection appears in JSON output', () => {
      const db = new MongoTargetDatabase({
        id: 'app_db',
        entries: { collection: { users: {} } },
      });
      const parsed = JSON.parse(JSON.stringify(db)) as {
        entries: { collection: Record<string, unknown> };
      };
      expect(parsed.entries).toEqual({ collection: { users: expect.any(Object) } });
    });
  });

  describe('freeze discipline', () => {
    it('inner collection map is frozen', () => {
      const db = new MongoTargetDatabase({
        id: 'app_db',
        entries: { collection: { users: {} } },
      });
      expect(Object.isFrozen(db.entries['collection'])).toBe(true);
    });

    it('outer entries object is frozen', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      expect(Object.isFrozen(db.entries)).toBe(true);
    });

    it('database node is frozen', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      expect(Object.isFrozen(db)).toBe(true);
    });
  });

  describe('collection getter', () => {
    it('collection getter returns the same map as entries[collection]', () => {
      const db = new MongoTargetDatabase({
        id: 'app_db',
        entries: { collection: { users: {} } },
      });
      expect(db.collection).toBe(db.entries['collection']);
    });

    it('collection getter is non-enumerable', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      expect(Object.keys(db)).not.toContain('collection');
    });

    it('collection getter returns MongoCollection instances', () => {
      const db = new MongoTargetDatabase({
        id: 'app_db',
        entries: { collection: { users: {} } },
      });
      expect(db.collection['users']).toBeInstanceOf(MongoCollection);
    });
  });

  describe('constructor dispatch by entries key', () => {
    it('normalises plain inputs into MongoCollection instances under collection key', () => {
      const db = new MongoTargetDatabase({
        id: 'app_db',
        entries: { collection: { users: {} } },
      });
      expect(db.entries['collection']?.['users']).toBeInstanceOf(MongoCollection);
    });

    it('collection map is always present even when entries is omitted', () => {
      const db = new MongoTargetDatabase({ id: 'app_db' });
      expect(db.entries['collection']).toBeDefined();
      expect(db.entries['collection']).toEqual({});
    });
  });

  describe('unknown-key rejection', () => {
    it('throws naming the kind when entries contains an unknown key', () => {
      expect(
        () =>
          new MongoTargetDatabase({
            id: 'app_db',
            entries: { bogus: {} } as never,
          }),
      ).toThrow(/unknown entity kind/);
    });

    it('error message includes the offending kind name', () => {
      expect(
        () =>
          new MongoTargetDatabase({
            id: 'app_db',
            entries: { bogus: {} } as never,
          }),
      ).toThrow(/bogus/);
    });
  });

  describe('MongoTargetUnboundDatabase singleton', () => {
    it('collection map is frozen and empty', () => {
      expect(MongoTargetUnboundDatabase.instance.entries['collection']).toEqual({});
      expect(Object.isFrozen(MongoTargetUnboundDatabase.instance.entries['collection'])).toBe(true);
    });

    it('kind is non-enumerable on the singleton', () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        MongoTargetUnboundDatabase.instance,
        'kind',
      );
      expect(descriptor?.enumerable).toBe(false);
    });

    it('JSON.stringify of singleton emits only id and entries', () => {
      const parsed = JSON.parse(JSON.stringify(MongoTargetUnboundDatabase.instance)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
    });
  });
});
