import { describe, expect, it } from 'vitest';
import { indexesEquivalent } from '../src/index-equivalence';
import { MongoSchemaCollection } from '../src/schema-collection';
import { MongoSchemaIndex } from '../src/schema-index';
import type { MongoSchemaVisitor } from '../src/visitor';

describe('MongoSchemaIndex', () => {
  it('constructs with required fields', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(index.kind).toBe('index');
    expect(index.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(index.unique).toBe(false);
    expect(index.sparse).toBeUndefined();
    expect(index.expireAfterSeconds).toBeUndefined();
    expect(index.partialFilterExpression).toBeUndefined();
  });

  it('constructs with all options', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      unique: true,
      sparse: true,
      expireAfterSeconds: 3600,
      partialFilterExpression: { active: { $eq: true } },
    });
    expect(index.unique).toBe(true);
    expect(index.sparse).toBe(true);
    expect(index.expireAfterSeconds).toBe(3600);
    expect(index.partialFilterExpression).toEqual({ active: { $eq: true } });
  });

  it('is frozen after construction', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(() => {
      (index as Record<string, unknown>)['unique'] = true;
    }).toThrow();
  });

  it('dispatches via visitor', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const visitor: MongoSchemaVisitor<string> = {
      collection: () => 'collection',
      index: (node) => `index:${node.keys[0]!.field}`,
    };
    expect(index.accept(visitor)).toBe('index:email');
  });
});

describe('MongoSchemaCollection', () => {
  it('constructs with name only', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    expect(coll.kind).toBe('collection');
    expect(coll.name).toBe('users');
    expect(coll.indexes).toEqual([]);
  });

  it('constructs with indexes', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const coll = new MongoSchemaCollection({
      name: 'users',
      indexes: [index],
    });
    expect(coll.indexes).toHaveLength(1);
    expect(coll.indexes[0]).toBe(index);
  });

  it('is frozen after construction', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    expect(() => {
      (coll as Record<string, unknown>)['name'] = 'other';
    }).toThrow();
  });

  it('dispatches via visitor', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    const visitor: MongoSchemaVisitor<string> = {
      collection: (node) => `collection:${node.name}`,
      index: () => 'index',
    };
    expect(coll.accept(visitor)).toBe('collection:users');
  });
});

describe('indexesEquivalent', () => {
  it('returns true for identical indexes', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    expect(indexesEquivalent(a, b)).toBe(true);
  });

  it('returns false for different keys', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different directions', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: -1 }],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different key order in compound index', () => {
    const a = new MongoSchemaIndex({
      keys: [
        { field: 'a', direction: 1 },
        { field: 'b', direction: 1 },
      ],
    });
    const b = new MongoSchemaIndex({
      keys: [
        { field: 'b', direction: 1 },
        { field: 'a', direction: 1 },
      ],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different key counts', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'a', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [
        { field: 'a', direction: 1 },
        { field: 'b', direction: 1 },
      ],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different unique', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different sparse', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      sparse: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different expireAfterSeconds', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'ts', direction: 1 }],
      expireAfterSeconds: 3600,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'ts', direction: 1 }],
      expireAfterSeconds: 7200,
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('returns false for different partialFilterExpression', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { active: true },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { active: false },
    });
    expect(indexesEquivalent(a, b)).toBe(false);
  });

  it('treats undefined and absent partialFilterExpression as equivalent', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      partialFilterExpression: undefined,
    });
    expect(indexesEquivalent(a, b)).toBe(true);
  });

  it('compares nested partialFilterExpression deeply', () => {
    const filter = { $and: [{ status: 'active' }, { age: { $gte: 18 } }] };
    const a = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: filter,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { ...filter },
    });
    expect(indexesEquivalent(a, b)).toBe(true);
  });
});
