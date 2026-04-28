import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { diffMongoSchemas } from '../src/core/schema-diff';

const emptyIR = new MongoSchemaIR([]);

function ir(collections: Record<string, MongoSchemaCollection>): MongoSchemaIR {
  return new MongoSchemaIR(Object.values(collections));
}

function coll(
  name: string,
  opts?: {
    indexes?: MongoSchemaIndex[];
    validator?: MongoSchemaValidator;
    options?: MongoSchemaCollectionOptions;
  },
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: opts?.indexes ?? [],
    ...(opts?.validator ? { validator: opts.validator } : {}),
    ...(opts?.options ? { options: opts.options } : {}),
  });
}

function idx(
  keys: Array<{ field: string; direction: 1 | -1 }>,
  opts?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number },
): MongoSchemaIndex {
  return new MongoSchemaIndex({ keys, ...opts });
}

function validator(
  jsonSchema: Record<string, unknown>,
  level: 'strict' | 'moderate' = 'strict',
  action: 'error' | 'warn' = 'error',
): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema,
    validationLevel: level,
    validationAction: action,
  });
}

describe('diffMongoSchemas', () => {
  describe('empty schemas', () => {
    it('returns pass for two empty schemas', () => {
      const result = diffMongoSchemas(emptyIR, emptyIR, false);
      expect(result.root.status).toBe('pass');
      expect(result.issues).toEqual([]);
      expect(result.counts.fail).toBe(0);
      expect(result.counts.warn).toBe(0);
    });
  });

  describe('collections', () => {
    it('returns pass when collections match', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.root.status).toBe('pass');
      expect(result.counts.fail).toBe(0);
    });

    it('fails on missing collection', () => {
      const live = emptyIR;
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.root.status).toBe('fail');
      expect(result.counts.fail).toBe(1);
      expect(result.issues).toEqual([
        expect.objectContaining({ kind: 'missing_table', table: 'users' }),
      ]);
      const node = result.root.children![0]!;
      expect(node.code).toBe('MISSING_COLLECTION');
    });

    it('warns on extra collection in non-strict mode', () => {
      const live = ir({ users: coll('users') });
      const expected = emptyIR;
      const result = diffMongoSchemas(live, expected, false);

      expect(result.root.status).toBe('warn');
      expect(result.counts.warn).toBe(1);
      expect(result.counts.fail).toBe(0);
      const node = result.root.children![0]!;
      expect(node.status).toBe('warn');
      expect(node.code).toBe('EXTRA_COLLECTION');
    });

    it('fails on extra collection in strict mode', () => {
      const live = ir({ users: coll('users') });
      const expected = emptyIR;
      const result = diffMongoSchemas(live, expected, true);

      expect(result.root.status).toBe('fail');
      expect(result.counts.fail).toBe(1);
      const node = result.root.children![0]!;
      expect(node.status).toBe('fail');
      expect(node.code).toBe('EXTRA_COLLECTION');
    });
  });

  describe('indexes', () => {
    it('returns pass when indexes match', () => {
      const schema = ir({
        users: coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.counts.fail).toBe(0);
      expect(result.counts.warn).toBe(0);
    });

    it('fails on missing index', () => {
      const live = ir({ users: coll('users') });
      const expected = ir({
        users: coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
      expect(result.issues).toEqual([
        expect.objectContaining({ kind: 'index_mismatch', table: 'users' }),
      ]);
    });

    it('warns on extra index in non-strict mode', () => {
      const live = ir({
        users: coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.warn).toBe(1);
      expect(result.counts.fail).toBe(0);
    });

    it('fails on extra index in strict mode', () => {
      const live = ir({
        users: coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemas(live, expected, true);

      expect(result.counts.fail).toBe(1);
    });
  });

  describe('validators', () => {
    const schema1 = { bsonType: 'object', required: ['name'] };
    const schema2 = { bsonType: 'object', required: ['email'] };

    it('returns pass when both have no validator', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.counts.fail).toBe(0);
    });

    it('returns pass when validators match', () => {
      const schema = ir({ users: coll('users', { validator: validator(schema1) }) });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.counts.fail).toBe(0);
    });

    it('fails on missing validator', () => {
      const live = ir({ users: coll('users') });
      const expected = ir({ users: coll('users', { validator: validator(schema1) }) });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
      expect(result.issues).toEqual([
        expect.objectContaining({ kind: 'type_missing', table: 'users' }),
      ]);
    });

    it('warns on extra validator in non-strict mode', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.warn).toBe(1);
      expect(result.counts.fail).toBe(0);
    });

    it('fails on extra validator in strict mode', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemas(live, expected, true);

      expect(result.counts.fail).toBe(1);
    });

    it('fails on schema mismatch', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users', { validator: validator(schema2) }) });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
      expect(result.issues).toEqual([
        expect.objectContaining({ kind: 'type_mismatch', table: 'users' }),
      ]);
    });

    it('fails when validationLevel differs', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1, 'moderate') }) });
      const expected = ir({ users: coll('users', { validator: validator(schema1, 'strict') }) });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
    });

    it('fails when validationAction differs', () => {
      const live = ir({
        users: coll('users', { validator: validator(schema1, 'strict', 'warn') }),
      });
      const expected = ir({
        users: coll('users', { validator: validator(schema1, 'strict', 'error') }),
      });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
    });
  });

  describe('options', () => {
    const cappedOpts = new MongoSchemaCollectionOptions({ capped: { size: 1048576 } });
    const differentOpts = new MongoSchemaCollectionOptions({ capped: { size: 2097152 } });

    it('returns pass when both have no options', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.counts.fail).toBe(0);
    });

    it('returns pass when options match', () => {
      const schema = ir({ logs: coll('logs', { options: cappedOpts }) });
      const result = diffMongoSchemas(schema, schema, false);
      expect(result.counts.fail).toBe(0);
    });

    it('warns on extra options in non-strict mode', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs') });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.warn).toBe(1);
      expect(result.counts.fail).toBe(0);
    });

    it('fails on extra options in strict mode', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs') });
      const result = diffMongoSchemas(live, expected, true);

      expect(result.counts.fail).toBe(1);
    });

    it('fails on options mismatch', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs', { options: differentOpts }) });
      const result = diffMongoSchemas(live, expected, false);

      expect(result.counts.fail).toBe(1);
      expect(result.issues).toEqual([
        expect.objectContaining({ kind: 'type_mismatch', table: 'logs' }),
      ]);
    });
  });

  describe('index lookup-key composition', () => {
    // Locks in the truthy branches of `buildIndexLookupKey` for the optional
    // index fields so that two indexes with identical sparse/TTL/partial-filter/
    // wildcard-projection settings match by their composed lookup key.
    it('matches indexes that share sparse, TTL, partial filter and wildcard projection', () => {
      const richIndex = new MongoSchemaIndex({
        keys: [{ field: 'createdAt', direction: 1 }],
        unique: true,
        sparse: true,
        expireAfterSeconds: 3600,
        partialFilterExpression: { archived: false },
        wildcardProjection: { 'meta.$**': 1 },
      });
      const schema = ir({ events: coll('events', { indexes: [richIndex] }) });

      const result = diffMongoSchemas(schema, schema, true);

      expect(result.counts.fail).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it('treats indexes that differ only in sparse/TTL/partial/wildcard as distinct', () => {
      const live = ir({
        events: coll('events', {
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'createdAt', direction: 1 }],
              sparse: true,
              expireAfterSeconds: 60,
              partialFilterExpression: { archived: false },
              wildcardProjection: { 'meta.$**': 1 },
            }),
          ],
        }),
      });
      const expected = ir({
        events: coll('events', {
          indexes: [new MongoSchemaIndex({ keys: [{ field: 'createdAt', direction: 1 }] })],
        }),
      });

      const result = diffMongoSchemas(live, expected, true);

      // Different lookup keys → expected index is missing and live index is
      // extra. Both reach `fail` under strict mode.
      expect(result.counts.fail).toBeGreaterThanOrEqual(1);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'index_mismatch', table: 'events' }),
          expect.objectContaining({ kind: 'extra_index', table: 'events' }),
        ]),
      );
    });
  });
});
